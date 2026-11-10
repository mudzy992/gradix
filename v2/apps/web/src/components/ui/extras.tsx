"use client";

/**
 * U katalog proširenje — komponente koje ekranima realno trebaju, a nisu kontrole ni
 * tabela: Avatar, Badge, Breadcrumbs, Link, Accordion, Stepper, QuantityStepper,
 * FileUpload, FigureImage, ActionCard, SpeedDial, Toast i Backdrop (gx-overlay).
 * Isti inventar postoji i na mobilnom (apps/mobile/src/ui) gdje platforma to dozvoljava.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Card, Icon, IconButton } from "./index";

export function Avatar({ name, size = "md", imageUrl }: { name: string; size?: "sm" | "md" | "lg"; imageUrl?: string }) {
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  if (imageUrl) {
    // Slika profila: alt je prazan jer ime stoji pored (dekorativna zamjena inicijala).
    return <img className={`gx-avatar gx-avatar--${size}`} src={imageUrl} alt="" style={{ objectFit: "cover" }} />;
  }
  return (
    <span aria-hidden="true" className={`gx-avatar${size !== "md" ? ` gx-avatar--${size}` : ""}`}>
      {initials}
    </span>
  );
}

export function Badge({ children, tone = "primary" }: { children: ReactNode; tone?: "primary" | "danger" | "quiet" }) {
  return <span className={`gx-badge${tone !== "primary" ? ` gx-badge--${tone}` : ""}`}>{children}</span>;
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Putanja" className="gx-crumbs">
      {items.map((item, index) => (
        <span key={item.label} style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          {item.href && index < items.length - 1 ? <a href={item.href}>{item.label}</a> : <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="gx-link" href={href}>
      {children}
    </a>
  );
}

export function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="gx-accordion">
      <button type="button" className="gx-accordion__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="gx-accordion__chev" data-open={open} aria-hidden="true">
          <Icon name="chevron" />
        </span>
      </button>
      {open ? <div className="gx-accordion__body">{children}</div> : null}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="gx-stepper" aria-label="Koraci">
      {steps.map((step, index) => (
        <li key={step} className="gx-step" data-state={index < current ? "done" : index === current ? "current" : "todo"} aria-current={index === current ? "step" : undefined}>
          <span className="gx-step__dot" aria-hidden="true">
            {index < current ? "✓" : index + 1}
          </span>
          {step}
          {index < steps.length - 1 ? <span aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function QuantityStepper({ label, value, onChange, min = 0, max = 999 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="gx-qty">
      <IconButton icon="minus" label={`Smanji: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
      <span className="gx-qty__value" role="status" aria-label={`${label}: ${value}`}>
        {value}
      </span>
      <IconButton icon="plus" label={`Povećaj: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
    </div>
  );
}

export function FileUpload({ label, hint, accept, onFiles }: { label: string; hint?: string; accept?: string; onFiles: (files: File[]) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label
        className="gx-upload"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = [...e.dataTransfer.files];
          setNames(files.map((f) => f.name));
          onFiles(files);
        }}
      >
        <Icon name="upload" />
        <strong>{label}</strong>
        {hint ? <span className="gx-page-sub">{hint}</span> : null}
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple
          aria-label={label}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            setNames(files.map((f) => f.name));
            onFiles(files);
          }}
        />
      </label>
      {names.length > 0 ? (
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FigureImage({ src, alt, caption, ratio = "16/9" }: { src: string; alt: string; caption?: string; ratio?: string }) {
  return (
    <figure className="gx-figure">
      <img src={src} alt={alt} style={{ aspectRatio: ratio, objectFit: "cover" }} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function ActionCard({ title, hint, onClick }: { title: string; hint?: string; onClick: () => void }) {
  return (
    <Card>
      <button type="button" className="gx-action-card gx-linkbtn" onClick={onClick}>
        <strong>{title}</strong>
        {hint ? <span className="gx-page-sub">{hint}</span> : null}
      </button>
    </Card>
  );
}

export function SpeedDial({ label, actions }: { label: string; actions: { key: string; label: string; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gx-speeddial">
      {open ? (
        <div className="gx-speeddial__actions">
          {actions.map((action) => (
            <Button
              key={action.key}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      <button type="button" className="gx-speeddial__fab" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "×" : "+"}
      </button>
    </div>
  );
}

export type ToastItem = { id: number; tone: "success" | "error" | "warning" | "info"; title: string; text?: string };

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem["tone"], title: string, text?: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, title, text }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="gx-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`gx-toast${toast.tone === "error" ? " gx-toast--error" : toast.tone === "warning" ? " gx-toast--warning" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>
          <Icon name={toast.tone === "error" || toast.tone === "warning" ? "warn" : "info"} />
          <div style={{ flex: 1 }}>
            <strong>{toast.title}</strong>
            {toast.text ? <p className="gx-page-sub">{toast.text}</p> : null}
          </div>
          <IconButton icon="close" label="Zatvori obavijest" onClick={() => onDismiss(toast.id)} />
        </div>
      ))}
    </div>
  );
}
