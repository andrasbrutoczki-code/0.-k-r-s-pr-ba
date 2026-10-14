"use client";

import { useEffect } from "react";
import { markThreadReadAction } from "./actions";

/** A feladatoldal megnyitásakor olvasottnak jelöli a tanár üzeneteit (böngészőből, nem rendereléskor). */
export function MarkRead({ studentTaskId }: { studentTaskId: string }) {
  useEffect(() => {
    void markThreadReadAction(studentTaskId);
  }, [studentTaskId]);
  return null;
}
