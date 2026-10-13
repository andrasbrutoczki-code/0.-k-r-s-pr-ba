"use client";

import { useActionState, useState } from "react";
import { studentLoginAction, type LoginFormState } from "@/app/belepes/actions";
import { formatCode } from "@/lib/auth/code";
import { Button, Field, Input, Notice } from "@/components/ui";

/**
 * Név + belépőkód űrlap. A belépéskor és a lejárat előtti megújításkor is
 * ez jelenik meg; megújításnál a név rögzített (rejtett mezőben megy).
 */
export function StudentLoginForm({
  lockedName,
  submitLabel = "Belépés",
}: {
  lockedName?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    studentLoginAction,
    {},
  );
  const [code, setCode] = useState("");

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {lockedName ? (
        <input type="hidden" name="name" value={lockedName} />
      ) : (
        <Field label="Neved" htmlFor="name" hint="Ahogy a tanárod felvett, ékezet nélkül is jó.">
          <Input
            id="name"
            name="name"
            autoComplete="username"
            autoCapitalize="words"
            required
            maxLength={40}
            defaultValue={state.name}
          />
        </Field>
      )}

      <Field label="Belépőkód" htmlFor="code" hint="8 karakter, a kötőjelet nem kell beírni.">
        <Input
          id="code"
          name="code"
          className="login-code text-center"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
          inputMode="text"
          placeholder="ABCD-EFGH"
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </Field>

      {state.error ? (
        <div id="login-error">
          <Notice tone="error">{state.error}</Notice>
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Belépés…" : submitLabel}
      </Button>
    </form>
  );
}
