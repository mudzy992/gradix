/**
 * Primitivi dizajn sistema — prema `docs/design/DESIGN.md` i `reference.html`.
 *
 * Pravila koja ovi primitivi sprovode (i koja test čuva):
 *  - nijedna boja nije hardkodirana: sve ide kroz semantičke tokene (`var(--panel)`, `--text`…),
 *  - oblik iz reference: ploča 18, kartica 16, polje 12, dugme i chip PILULA,
 *  - dugme 40 px, polje 42 px, meta ≥ 44 px (na telefonu primarna akcija puna širina),
 *  - cifre, šifre i vrijeme idu u mono sa tabularnim ciframa,
 *  - stanje se nikad ne prenosi samo bojom: chip ima tačku I tekst.
 */
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ ikone */

/**
 * Ikone su inline SVG (18 px, 1,7 px linija) — isti set kao `reference.html`, bez ikonske
 * biblioteke. `stroke="currentColor"` znači da boju nasljeđuju od teksta, pa ih tema prati.
 */
const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  folder: <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </>
  ),
  warn: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
    >
      {ICONS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ ploče */

/** Ploča: 1 px linija, 16 px radijus, 24 px ispune. Sjena je samo u svijetloj temi. */
export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`gx-card ${className}`.trim()} id={id}>
      {children}
    </section>
  );
}

/** Naslov sekcije 16/700; `hint` je tihi tekst pored, `action` ide desno. */
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
    <div className="gx-section-head">
      <div className="gx-section-head__text">
        <h2 className="gx-section-title">{children}</h2>
        {hint ? <span className="gx-section-hint">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ dugmad */

/**
 * Dugme: 40 px pilula. `primary` je jedina jasna akcija na ekranu (brend na svijetlom,
 * akcent na tamnom — token `--primary` to rješava sam).
 */
export function Button({
  children,
  variant = "secondary",
  type = "button",
  fullWidthOnMobile = false,
  icon,
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  type?: "button" | "submit";
  fullWidthOnMobile?: boolean;
  icon?: IconName;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      // `className` se DODAJE, ne zamjenjuje: bez ovoga bi svaki poziv sa klasom izbacio
      // osnovne klase.
      className={`gx-btn gx-btn--${variant} ${fullWidthOnMobile ? "gx-btn--full-mobile" : ""} ${className}`.trim()}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

/** Okruglo dugme samo sa ikonom (tema, meni). Ime je OBAVEZNO — ikona nije tekst. */
export function IconButton({
  icon,
  label,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`gx-icon-btn ${className}`.trim()} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/* ------------------------------------------------------------------ polja */

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
    <div className="gx-field">
      <label htmlFor={htmlFor} className="gx-field__label">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${htmlFor}-hint`} className="gx-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const inputClass = "gx-input";

/**
 * Segmentirani izbor („Cijela firma / Samo svoje“): pilula sa tri dijela, `aria-pressed` nosi
 * stanje — ne izgled. Tastatura radi jer su to dugmad, ne `div`-ovi.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="gx-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ poruke */

/** Poruka: obojena podloga, ikona, tekst. `role` je `alert` samo kad greška prekida radnju. */
export function Alert({
  tone,
  children,
  role = "status",
}: {
  tone: "error" | "success" | "warning" | "info";
  children: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div role={role} className={`gx-note gx-note--${tone}`}>
      <Icon name={tone === "error" || tone === "warning" ? "warn" : "info"} />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ chip */

/**
 * Chip sa tačkom. Stanje NIKAD nije samo boja: tačka + tekst („Radi“, „Zastoj“, „Na servisu“).
 * `tone="full"` = puna tačka (radi), `"hot"` = žuta (zastoj), `"hollow"` = prazna (servis).
 */
export function Chip({
  tone = "full",
  children,
  className = "",
}: {
  tone?: "full" | "hot" | "hollow";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`gx-chip ${className}`.trim()}>
      <i aria-hidden="true" className={`gx-chip__dot gx-chip__dot--${tone}`} />
      {children}
    </span>
  );
}

/** Mono za šifre, ID-ove i brojeve — tabularno, da kolone stoje. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`gx-mono ${className}`.trim()}>{children}</span>;
}

/* ------------------------------------------------------------- stanja */

/** Prazno stanje: šta je prazno i šta se može dalje. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="gx-empty">
      <p className="gx-empty__title">{title}</p>
      <p className="gx-empty__text">{description}</p>
      {action ? <div className="gx-empty__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="gx-skeleton">
      <span className="sr-only">Učitavanje…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="gx-skeleton__row" />
      ))}
    </div>
  );
}
