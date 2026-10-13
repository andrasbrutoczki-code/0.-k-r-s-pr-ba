/**
 * Kis, saját UI-primitívek. Szándékosan nincs külön komponenskönyvtár:
 * néhány elemre van szükség, és így a stílus egy helyen, átláthatóan él.
 * Érintésre méretezve: minden interaktív elem legalább 48 px magas.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink/90 disabled:bg-ink/50",
  secondary: "bg-sheet text-ink border border-ink/40 hover:bg-ink-soft",
  danger: "bg-sheet text-redpen border border-redpen/40 hover:bg-redpen-soft",
  quiet: "text-ink underline-offset-4 hover:underline",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 font-bold transition-colors disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`block min-h-12 w-full rounded-md border border-rule bg-sheet px-3 text-graphite placeholder:text-muted/70 focus:border-ink ${className}`}
      {...props}
    />
  );
}

/** Címke + mező + opcionális súgó, egymás alatt. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-bold">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

type NoticeTone = "info" | "error" | "success" | "warning";

const noticeTones: Record<NoticeTone, string> = {
  info: "border-ink/30 bg-ink-soft text-ink",
  error: "border-redpen/40 bg-redpen-soft text-redpen",
  success: "border-ok/40 bg-ok-soft text-ok",
  warning: "border-margin bg-redpen-soft text-graphite",
};

/** Helyben megjelenő üzenet. A hibák role="alert"-tel olvasódnak fel. */
export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 ${noticeTones[tone]}`}
    >
      {children}
    </div>
  );
}
