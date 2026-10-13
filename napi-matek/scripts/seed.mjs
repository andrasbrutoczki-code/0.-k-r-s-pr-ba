#!/usr/bin/env node
/**
 * Seed: 1 tanár + 3 tanuló (az 5 mintafeladat a 2. lépésben kerül ide).
 *
 * Futtatás:  npm run seed      (a .env.local-ból olvas)
 *
 * Idempotens: ha a tanár vagy egy tanuló már létezik, kihagyja. A tanulók
 * kódját csak létrehozáskor írja ki – később a tanári felületen generálható új.
 * Titkos kulccsal fut (az RLS-t megkerüli), ezért csak a saját gépeden futtasd.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Hiányzó környezeti változó: ${name} (lásd .env.example)`);
    process.exit(1);
  }
  return value;
}

const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STUDENTS = ["Anna", "Bence", "Csenge"];

async function findUserByEmail(email) {
  // Kis felhasználószámnál egy oldal elég (perPage: 1000).
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function seedTeacher() {
  const email = need("SEED_TEACHER_EMAIL");
  const password = need("SEED_TEACHER_PASSWORD");
  if (password.length < 12) {
    console.error("A SEED_TEACHER_PASSWORD legyen legalább 12 karakter.");
    process.exit(1);
  }

  let user = await findUserByEmail(email);
  if (user) {
    console.log(`Tanár már létezik: ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "teacher" },
    });
    if (error) throw error;
    user = data.user;
    console.log(`Tanár létrehozva: ${email}`);
  }

  const { error } = await admin
    .from("app_users")
    .upsert({ user_id: user.id, role: "teacher" }, { onConflict: "user_id" });
  if (error) throw error;
}

async function seedStudents() {
  const { data: existing, error } = await admin.from("students").select("display_name");
  if (error) throw error;
  const taken = new Set(existing.map((s) => s.display_name.toLowerCase()));

  for (const name of SEED_STUDENTS) {
    if (taken.has(name.toLowerCase())) {
      console.log(`Tanuló már létezik: ${name}`);
      continue;
    }
    const { data, error: authError } = await admin.auth.admin.createUser({
      email: `s-${randomUUID()}@students.invalid`,
      email_confirm: true,
      app_metadata: { role: "student" },
    });
    if (authError) throw authError;

    const { data: code, error: rpcError } = await admin.rpc("service_create_student", {
      p_user_id: data.user.id,
      p_display_name: name,
    });
    if (rpcError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw rpcError;
    }
    console.log(`Tanuló létrehozva: ${name.padEnd(8)} kód: ${code.slice(0, 4)}-${code.slice(4)}`);
  }
}

try {
  await seedTeacher();
  await seedStudents();
  console.log("Kész.");
} catch (err) {
  console.error("Seed hiba:", err.message ?? err);
  process.exit(1);
}
