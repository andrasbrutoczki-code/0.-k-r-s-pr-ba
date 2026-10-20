"use client";

import { useActionState, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { deleteWorksheetAction } from "../actions";

/** Munkalap törlése oldalba épített megerősítéssel. */
export function DeleteWorksheet({ worksheetId, assignmentCount }: { worksheetId: string; assignmentCount: number }) {
  const [result, action, pending] = useActionState(deleteWorksheetAction, null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
        Munkalap törlése
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-md border-2 border-redpen/50 bg-redpen-soft p-3">
      <input type="hidden" name="id" value={worksheetId} />
      {assignmentCount > 0 ? (
        <p className="text-sm">
          Ez a munkalap {assignmentCount}× ki van osztva. Törléskor a kiosztások visszavonódnak: a még el nem
          kezdett feladatok eltűnnek a tanulóktól. Amit a tanuló már beadott, elkezdett vagy amihez üzenetet írt,
          megmarad (az Ellenőrzésben és a statisztikában is).
        </p>
      ) : (
        <p className="text-sm">Biztosan törlöd? Ez nem vonható vissza.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Törlés…" : "Igen, törlöm"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
          Mégse
        </Button>
      </div>
      {result && !result.ok ? <Notice tone="error">{result.message}</Notice> : null}
    </form>
  );
}
