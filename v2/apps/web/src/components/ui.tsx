/**
 * Primitivi dizajn sistema v1 (R1c) — industrijski, oštar, gust.
 *
 * Pravila koja ovi primitivi sprovode (i koja test čuva):
 *  - radijus 2 px (`--radius`), dijalog 4 px (`--radius-dialog`) — nigdje `rounded-full`,
 *  - linije 1 px; bez sjena i gradijenata,
 *  - nijedna boja nije hardkodirana: sve ide kroz `var(--color-*)`,
 *  - cifre u tabelama su tabularne, šifre i ID-ovi idu u mono,
 *  - `#140A9A` samo za primarnu akciju i aktivnu stavku; `#FFC82F` samo bedž/fokus/naglasak.
 */
import type { ReactNode } from "react";

/** Panel = 1 px linija + 2 px radijus. Nema sjene: dubinu nosi linija, ne sjena. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`gx-panel ${className}`} style={{ padding: "var(--card-pad)" }}>
      {children}
    </div>
  );
}

/** Naslov sekcije: gusto, sa tankom linijom ispod kad ima radnju desno. */
export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight">{children}</h2>
        {hint ? <span className="text-[13px] text-[var(--color-text-muted)]">{hint}</span> : null}
      </div>
      {action}
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
    "gx-btn inline-flex items-center justify-center gap-2 border px-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55";
  const variants = {
    primary:
      "bg-[var(--color-brand)] text-[var(--color-text-inverse)] border-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]",
    secondary:
      "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]",
    quiet:
      "bg-transparent text-[var(--color-text)] border-transparent hover:bg-[var(--color-surface-muted)]",
    danger:
      "bg-[var(--color-surface)] text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
  } as const;
  return (
    <button
      type={type}
      // `className` se DODAJE, ne zamjenjuje: bez ovoga bi svaki poziv sa klasom izbacio
      // osnovne klase (ista greška je već jednom popravljena u R1a).
      className={`${base} ${variants[variant]} ${fullWidthOnMobile ? "gx-primary-full" : ""} ${className}`.trim()}
      style={{ minHeight: "var(--control-height)", borderRadius: "var(--radius)" }}
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
    <div className="mb-3 grid gap-1">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${htmlFor}-hint`} className="text-[12px] text-[var(--color-text-muted)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Ivica polja je `border-strong` (3,76:1) — `border` je 1,39:1 i ne prolazi WCAG 1.4.11. */
export const inputClass = "gx-input";

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
    error: "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning-text)] border-[var(--color-warning-text)]",
    info: "bg-[var(--color-brand-soft)] text-[var(--color-brand)] border-[var(--color-brand)]",
  } as const;
  return (
    <p
      role={role}
      className={`border-l-2 px-3 py-1.5 text-[13px] ${tones[tone]}`}
      style={{ borderRadius: "var(--radius)" }}
    >
      {children}
    </p>
  );
}

/**
 * Bedž. Nije pilula: 2 px radijus, 1 px linija, mono za šifre kad se proslijedi `mono`.
 * `#FFC82F` se koristi samo kao podloga (`accent`) — nikad kao tekst.
 */
export function Pill({
  tone,
  mono = false,
  children,
}: {
  tone: "brand" | "accent" | "danger" | "success" | "quiet";
  mono?: boolean;
  children: ReactNode;
}) {
  const tones = {
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)] border-[var(--color-brand)]",
    accent: "bg-[var(--color-accent)] text-[var(--color-text)] border-[var(--color-text)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]",
    quiet: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border-[var(--color-border-strong)]",
  } as const;
  return (
    <span
      className={`inline-block whitespace-nowrap border px-1.5 text-[11px] font-bold uppercase tracking-wide ${tones[tone]} ${mono ? "gx-mono" : ""}`}
      style={{ borderRadius: "var(--radius)", paddingTop: 1, paddingBottom: 1 }}
    >
      {children}
    </span>
  );
}

/** Prazno stanje mora reći šta je prazno i šta se može dalje, ne samo „nema podataka“. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div
      className="border border-dashed border-[var(--color-border-strong)] p-6 text-center"
      style={{ borderRadius: "var(--radius)" }}
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-1">
      <span className="sr-only">Učitavanje…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse bg-[var(--color-surface-muted)]"
          style={{ height: "var(--row-height)", borderRadius: "var(--radius)" }}
        />
      ))}
    </div>
  );
}

/** Mono za šifre, ID-ove i ključeve — ista klasa kao u okviru. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`gx-mono ${className}`.trim()}>{children}</span>;
}
