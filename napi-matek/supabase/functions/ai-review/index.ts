/**
 * AI-ellenőrző asszisztens (Supabase Edge Function).
 *
 * Miért itt és nem a Next.js szerveren? Az ingyenes Netlify-csomag 10 mp után
 * megszakítja a kérést, egy képes elemzés pedig ennél tovább tarthat. Az Edge
 * Function a Supabase-nél fut (bőven elég időkerettel), és a tanár saját
 * bejelentkezésével, RLS alatt olvas: titkos kulcs nem kell hozzá.
 *
 * Bemenet:  POST { student_task_id }  (Authorization: a tanár munkamenete)
 * Kimenet:  { review: { id, created_at, model, result } }  vagy  { error, message }
 *
 * Titkok (Supabase → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY  – kötelező
 *   AI_REVIEW_MODEL    – nem kötelező, alapból claude-sonnet-5-5
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import {
  buildContent,
  parseToolInput,
  sniffImageType,
  SYSTEM_PROMPT,
  TOOL_DEFINITION,
  TOOL_NAME,
  type ImageBlock,
  type ReviewInput,
} from "./prompt.ts";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // a Claude API képenkénti korlátja
/** Egy beadott változatra legfeljebb ennyi javaslat kérhető (költségvédelem). */
const MAX_REVIEWS_PER_SUBMISSION = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function fail(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

function publishableKey(): string {
  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // régi formátum: alább a SUPABASE_ANON_KEY
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

type SupabaseClient = ReturnType<typeof createClient>;

async function loadImage(client: SupabaseClient, bucket: string, path: string): Promise<ImageBlock | null> {
  const { data } = await client.storage.from(bucket).download(path);
  if (!data || data.size > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mediaType = sniffImageType(bytes);
  if (!mediaType) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType, data: encodeBase64(bytes) } };
}

interface Row {
  student_id: string;
  students: { ai_consent: boolean } | null;
  tasks: {
    title: string;
    body_md: string;
    task_type: "teszt" | "rovid" | "kifejtos";
    figure_path: string | null;
    topics: { name: string } | null;
    task_solutions: { solution_md: string; correct_choice: string | null } | { solution_md: string; correct_choice: string | null }[] | null;
  } | null;
  submissions: {
    id: string;
    version: number;
    submitted_at: string | null;
    choice: string | null;
    answer_text: string | null;
    submission_images: { storage_path: string; position: number }[];
  }[];
  messages: { author_id: string; body_md: string; created_at: string }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method", "Csak POST.", 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return fail(
      "not_configured",
      "Az AI-asszisztens még nincs beállítva: a Supabase-ben add meg az ANTHROPIC_API_KEY titkot.",
      503,
    );
  }

  // A tanár nevében, RLS alatt: amit ő nem láthat, azt a függvény sem.
  const client = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isTeacher } = await client.rpc("is_teacher");
  if (isTeacher !== true) return fail("forbidden", "Ehhez tanári bejelentkezés kell.", 403);

  let studentTaskId = "";
  try {
    studentTaskId = String((await req.json()).student_task_id ?? "");
  } catch {
    // üres vagy hibás törzs: alább elutasítjuk
  }
  if (!/^[0-9a-f-]{36}$/i.test(studentTaskId)) return fail("bad_request", "Hiányzó feladatazonosító.", 400);

  const { data, error } = await client
    .from("student_tasks")
    .select(
      `student_id, students(ai_consent),
       tasks(title, body_md, task_type, figure_path, topics(name), task_solutions(solution_md, correct_choice)),
       submissions(id, version, submitted_at, choice, answer_text, submission_images(storage_path, position)),
       messages(author_id, body_md, created_at)`,
    )
    .eq("id", studentTaskId)
    .maybeSingle();
  const row = data as unknown as Row | null;
  if (error || !row?.tasks) return fail("not_found", "A feladat nem található.", 404);
  if (!row.students?.ai_consent) {
    return fail("no_consent", "Ennél a tanulónál nincs szülői hozzájárulás az AI-asszisztenshez.", 403);
  }

  const latest = row.submissions.filter((s) => s.submitted_at).sort((a, b) => b.version - a.version)[0];
  if (!latest) return fail("nothing_submitted", "Ehhez a feladathoz még nincs beadás.", 400);

  const { count } = await client
    .from("ai_reviews")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", latest.id);
  if ((count ?? 0) >= MAX_REVIEWS_PER_SUBMISSION) {
    return fail(
      "limit",
      `Ehhez a beadáshoz már ${MAX_REVIEWS_PER_SUBMISSION} javaslatot kértél. Új beadásnál újra kérhetsz.`,
      429,
    );
  }

  const task = row.tasks;
  const solution = Array.isArray(task.task_solutions) ? task.task_solutions[0] : task.task_solutions;
  const input: ReviewInput = {
    task: {
      title: task.title,
      body_md: task.body_md,
      task_type: task.task_type,
      topic: task.topics?.name ?? null,
      solution_md: solution?.solution_md ?? null,
      correct_choice: solution?.correct_choice ?? null,
    },
    submission: { version: latest.version, choice: latest.choice, answer_text: latest.answer_text },
    thread: [...row.messages]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ from: m.author_id === row.student_id ? ("Tanuló" as const) : ("Tanár" as const), body: m.body_md })),
  };

  const paths = [...latest.submission_images].sort((a, b) => a.position - b.position).slice(0, MAX_IMAGES);
  const [figure, ...photos] = await Promise.all([
    task.figure_path ? loadImage(client, "task-figures", task.figure_path) : Promise.resolve(null),
    ...paths.map((p) => loadImage(client, "submissions", p.storage_path)),
  ]);
  const submissionImages = photos.filter((p): p is ImageBlock => p !== null);
  if (task.task_type === "kifejtos" && paths.length > 0 && submissionImages.length === 0) {
    return fail("images", "A beadott fotók nem olvashatók be.", 502);
  }

  const model = Deno.env.get("AI_REVIEW_MODEL") || DEFAULT_MODEL;
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: [TOOL_DEFINITION],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildContent(input, { figure, submission: submissionImages }) }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return fail("ai_unreachable", "Az AI-szolgáltatás nem válaszolt. Próbáld újra később.", 504);
  }

  if (!response.ok) {
    const detail = await response.text();
    console.error("Claude API hiba", response.status, detail.slice(0, 500));
    const message =
      response.status === 401
        ? "Az ANTHROPIC_API_KEY érvénytelen."
        : response.status === 429 || response.status === 529
          ? "Az AI-szolgáltatás most túlterhelt. Próbáld újra egy perc múlva."
          : response.status === 400 && detail.includes("credit")
            ? "Elfogyott az API-egyenleg a Claude Console-ban."
            : "Az AI-elemzés nem sikerült. Próbáld újra.";
    return fail("ai_error", message, 502);
  }

  const body = (await response.json()) as {
    content: { type: string; name?: string; input?: unknown }[];
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const toolUse = body.content.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
  const result = parseToolInput(toolUse?.input);
  if (!result) {
    console.error("Értelmezhetetlen AI-válasz", body.stop_reason);
    return fail("ai_invalid", "Az AI válasza hiányos volt. Próbáld újra.", 502);
  }

  const { data: saved, error: saveError } = await client
    .from("ai_reviews")
    .insert({
      student_task_id: studentTaskId,
      submission_id: latest.id,
      model,
      result,
      input_tokens: body.usage?.input_tokens ?? null,
      output_tokens: body.usage?.output_tokens ?? null,
    })
    .select("id, created_at, model, result")
    .single();
  if (saveError || !saved) return fail("save", "A javaslat mentése nem sikerült.", 500);

  return json({ review: saved });
});
