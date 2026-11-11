"use client";

/**
 * U1 — preklopi i meniji: Dialog/ConfirmDialog (oko postojećeg Dialog primitiva),
 * Tabs i RowActions (jedna vidljiva akcija + „⋯“ meni, kao u referenci).
 */
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Button } from "./primitives";
import { Textarea } from "./controls";

export { Dialog };

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  busy,
  reason,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /**
   * Opciono obavezno polje razloga (R4a-2, odobrena dopuna): potvrda je zaključana
   * dok razlog nema bar `minLength` znakova. Ko vidi razlog piše u `label`/`hint`
   * pozivajućeg ekrana — komponenta ne odlučuje o vidljivosti.
   */
  reason?: { value: string; onChange: (value: string) => void; minLength: number; label: string; hint?: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const reasonInvalid = reason !== undefined && reason.value.trim().length < reason.minLength;
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={(
        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Odustani
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy || reasonInvalid}>
            {busy ? "Radim…" : confirmLabel}
          </Button>
        </div>
      )}
    >
      <p>{text}</p>
      {reason ? (
        <Textarea
          label={reason.label}
          hint={reason.hint}
          rows={3}
          value={reason.value}
          onChange={(event) => reason.onChange(event.target.value)}
        />
      ) : null}
    </Dialog>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  label: string;
}) {
  return (
    <div className="gx-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === active}
          className={`gx-tab${tab.key === active ? " gx-tab--active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type RowAction = { key: string; label: string; danger?: boolean; onSelect: (returnTo?: HTMLElement | null) => void };

export function RowActions({ actions, label }: { actions: RowAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        // Fokus se vraća na „⋯“ koje je meni otvorilo — ne na <body>.
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);
  if (actions.length === 0) return null;
  const [primary, ...rest] = actions;
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
      <Button variant="quiet" onClick={(event) => primary!.onSelect(event.currentTarget)}>
        {primary!.label}
      </Button>
      {rest.length > 0 ? (
        <div style={{ position: "relative" }} ref={ref}>
          <Button variant="quiet" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
            ⋯
          </Button>
          {open ? (
            <div role="menu" aria-label={label} className="gx-menu" style={{ top: "calc(100% + 8px)", right: 0 }}>
              {rest.map((action) => (
                <button
                  key={action.key}
                  role="menuitem"
                  type="button"
                  className="gx-menu-item"
                  style={action.danger ? { color: "var(--danger)" } : undefined}
                  onClick={() => {
                    setOpen(false);
                    // Fokus/cilj je „⋯“ okidač, ne stavka menija (ona nestaje).
                    action.onSelect(ref.current?.querySelector<HTMLElement>("button") ?? null);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
