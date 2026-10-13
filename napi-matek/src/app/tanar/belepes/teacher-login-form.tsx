"use client";

import { useActionState } from "react";
import { teacherLoginAction, type TeacherLoginState } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function TeacherLoginForm() {
  const [state, formAction, pending] = useActionState<TeacherLoginState, FormData>(
    teacherLoginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <Field label="E-mail-cím" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
        />
      </Field>
      <Field label="Jelszó" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Belépés…" : "Belépés"}
      </Button>
    </form>
  );
}
