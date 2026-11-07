/**
 * Mali set primitiva za R1a — NE dizajn sistem (dva smjera su Faza 2).
 *
 * Sve boje idu kroz CSS varijable, sve mjere kroz gustinu (`density.css`), pa se isti
 * raspored ponaša gusto u uredu i udobno na terenu.
 */
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
      style={{ padding: "var(--card-pad)" }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint ? <span className="text-sm text-[var(--color-text-muted)]">{hint}</span> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  type = "button",
  fullWidthOnMobile = false,
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  type?: "button" | "submit";
  fullWidthOnMobile?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] border-2 px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55";
  const variants = {
    primary:
      "bg-[var(--color-brand)] text-[var(--color-text-inverse)] border-transparent hover:bg-[var(--color-brand-hover)]",
    secondary:
      "bg-[var(--color-surface)] text-[var(--color-brand)] border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]",
    quiet:
      "bg-transparent text-[var(--color-text)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]",
    danger:
      "bg-[var(--color-surface)] text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
  } as const;
  return (
    <button
      type={type}
      // `className` se DODAJE, ne zamjenjuje: bez ovoga bi svaki poziv sa klasom
      // (npr. `whitespace-nowrap`) izbacio osnovne klase i dugme bi ostalo bez ivice.
      className={`${base} ${variants[variant]} ${fullWidthOnMobile ? "gx-primary-full" : ""} ${className}`.trim()}
      style={{ minHeight: "var(--control-height)" }}
      {...rest}
    >
      {children}
    </button>
  );
}

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
    <div className="mb-3 grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${htmlFor}-hint`} className="text-[13px] text-[var(--color-text-muted)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Ivica polja je `border-strong` (3,76:1) — `border` je 1,39:1 i ne prolazi WCAG 1.4.11. */
export const inputClass =
  "w-full rounded-[10px] border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-[var(--body-size)] text-[var(--color-text)]";

export function Alert({
  tone,
  children,
  role = "status",
}: {
  tone: "error" | "success" | "warning" | "info";
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const tones = {
    error: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning-text)]",
    info: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
  } as const;
  return (
    <p role={role} className={`rounded-[10px] px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Pill({ tone, children }: { tone: "brand" | "accent" | "danger" | "success" | "quiet"; children: ReactNode }) {
  const tones = {
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
    accent: "bg-[var(--color-accent)] text-[var(--color-text)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    quiet: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
  } as const;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Prazno stanje mora reći šta je prazno i šta se može dalje, ne samo „nema podataka“. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border-strong)] p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-2">
      <span className="sr-only">Učitavanje…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[10px] bg-[var(--color-surface-muted)]"
          style={{ height: "var(--row-height)" }}
        />
      ))}
    </div>
  );
}
