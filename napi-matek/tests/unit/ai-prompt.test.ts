import { describe, expect, it } from "vitest";
import {
  buildContent,
  choiceVerdict,
  parseToolInput,
  sniffImageType,
  type ReviewInput,
} from "../../supabase/functions/ai-review/prompt.ts";
import { extractCorrectChoice, parseChoice } from "../../src/lib/task-types.ts";

const base: ReviewInput = {
  task: {
    title: "Szakaszok",
    body_md: "Hány szakasz? (A) 12 (B) 15",
    task_type: "teszt",
    topic: "Kombinatorika",
    solution_md: "Helyes válasz: (B) 15.",
    correct_choice: "B",
  },
  submission: { version: 1, choice: "C", answer_text: "Mert 6·5." },
  thread: [],
};

function allText(input: ReviewInput): string {
  return buildContent(input, { figure: null, submission: [] })
    .map((b) => (b.type === "text" ? b.text : "[kép]"))
    .join("\n");
}

describe("tesztválasz összevetése", () => {
  it("helyes, hibás, ismeretlen", () => {
    expect(choiceVerdict("b", "B")).toBe("correct");
    expect(choiceVerdict("C", "B")).toBe("wrong");
    expect(choiceVerdict("C", null)).toBe("unknown");
    expect(choiceVerdict(null, "B")).toBe("unknown");
  });

  it("a helyes betű kiolvasása az útmutatóból és beírt formából", () => {
    expect(extractCorrectChoice("Helyes válasz: (C) 13,5 cm.")).toBe("C");
    expect(extractCorrectChoice("helyes valasz (d)")).toBe("D");
    expect(extractCorrectChoice("A válasz 15.")).toBeNull();
    expect(parseChoice("(b)")).toBe("B");
    expect(parseChoice(" A ")).toBe("A");
    expect(parseChoice("AB")).toBeNull();
    expect(parseChoice("G")).toBeNull();
  });
});

describe("kérés összeállítása", () => {
  it("tesztnél közli a rendszer döntését, a diák szövegét elhatárolja", () => {
    const text = allText(base);
    expect(text).toContain("A választás HIBÁS");
    expect(text).toContain("<diak_szovege>\nMert 6·5.\n</diak_szovege>");
    expect(text).toContain("Helyes válasz: (B) 15.");
  });

  it("helyes válasz nélkül az AI-tól kéri a döntést", () => {
    const text = allText({ ...base, task: { ...base.task, correct_choice: null } });
    expect(text).toContain("ai_correct_choice");
  });

  it("a tanuló neve nem kerül a kérésbe, az üzenetszál szerepcímkét kap", () => {
    const text = allText({
      ...base,
      submission: { ...base.submission, version: 2 },
      thread: [
        { from: "Tanár", body: "Nézd meg a b) részt." },
        { from: "Tanuló", body: "Kijavítottam." },
      ],
    });
    expect(text).toContain("2. beadott változata");
    expect(text).toContain("Tanár: Nézd meg a b) részt.");
    expect(text).toContain("Tanuló: Kijavítottam.");
  });

  it("a fotók sorszámmal, a képblokkok előtt", () => {
    const img = { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg", data: "x" } };
    const blocks = buildContent(
      { ...base, task: { ...base.task, task_type: "kifejtos" } },
      { figure: null, submission: [img, img] },
    );
    const i = blocks.findIndex((b) => b.type === "text" && b.text === "2. fotó:");
    expect(i).toBeGreaterThan(0);
    expect(blocks[i + 1]).toBe(img);
  });
});

describe("AI-válasz ellenőrzése", () => {
  it("érvényes válaszból normalizált eredmény", () => {
    const result = parseToolInput({
      verdict: "needs_revision",
      confidence: "medium",
      summary: "Jó ötlet, rossz képlet.",
      issues: [{ severity: "hiba", location: "indoklás", description: "Ismétlés nélküli kombináció kell." }, "szemét"],
      feedback_md: "Gondold át: számít a sorrend?",
      ai_correct_choice: "(b)",
    });
    expect(result?.verdict).toBe("needs_revision");
    expect(result?.issues).toHaveLength(1);
    expect(result?.ai_correct_choice).toBe("B");
  });

  it("hiányzó döntés vagy visszajelzés esetén elutasít", () => {
    expect(parseToolInput({ verdict: "accepted" })).toBeNull();
    expect(parseToolInput({ verdict: "talán", feedback_md: "x" })).toBeNull();
    expect(parseToolInput(null)).toBeNull();
  });

  it("ismeretlen bizonyosság → alacsony", () => {
    expect(parseToolInput({ verdict: "unsure", confidence: "?", feedback_md: "x" })?.confidence).toBe("low");
  });
});

describe("képtípus felismerése", () => {
  it("JPEG, PNG, ismeretlen", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});
