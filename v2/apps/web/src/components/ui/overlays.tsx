"use client";

/**
 * U1 — preklopi i meniji: Dialog/ConfirmDialog (oko postojećeg Dialog primitiva),
 * Tabs i RowActions (jedna vidljiva akcija + „⋯“ meni, kao u referenci).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { Button } from "./primitives";
import { Textarea } from "./controls";
import { FloatingMenu } from "./floating-menu";

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
  id,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  label: string;
  /** Isti id proslijediti svakom pripadajućem TabPanelu. */
  id?: string;
}) {
  return (
    <div className="gx-tabs" role="tablist" aria-label={label} onKeyDown={(event) => {
      const current=tabs.findIndex(tab=>tab.key===active);
      let next=current;
      if(event.key === "ArrowRight") next=(current+1)%tabs.length;
      else if(event.key === "ArrowLeft") next=(current-1+tabs.length)%tabs.length;
      else if(event.key === "Home") next=0;
      else if(event.key === "End") next=tabs.length-1;
      else return;
      if (!tabs[next]) return;
      event.preventDefault();onChange(tabs[next]!.key);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={id ? `${id}-${tab.key}-tab` : undefined}
          aria-controls={id ? `${id}-${tab.key}-panel` : undefined}
          tabIndex={tab.key === active ? 0 : -1}
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

/** Jedinstveni unutrašnji razmak i veza panela s pripadajućim tabom. */
export function TabPanel({groupId, tabKey, active, children}: {groupId:string;tabKey:string;active:boolean;children:ReactNode}) {
  return <section role="tabpanel" id={`${groupId}-${tabKey}-panel`} aria-labelledby={`${groupId}-${tabKey}-tab`} hidden={!active} className="gx-tab-panel">{children}</section>;
}

export type RowAction = { key: string; label: string; danger?: boolean; onSelect: (returnTo?: HTMLElement | null) => void };

export function RowActions({ actions, label }: { actions: RowAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".gx-menu--floating")) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  if (actions.length === 0) return null;
  const [primary, ...rest] = actions;
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
      <Button variant="quiet" onClick={(event) => primary!.onSelect(event.currentTarget)}>
        {primary!.label}
      </Button>
      {rest.length > 0 ? (
        <div ref={ref}>
          <Button
            variant="quiet"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={label}
            onClick={(event) => {
              setAnchor(event.currentTarget);
              setOpen((value) => !value);
            }}
          >
            ⋯
          </Button>
          <FloatingMenu open={open} anchor={anchor} label={label}>
            {rest.map((action) => (
              <button
                key={action.key}
                role="menuitem"
                type="button"
                className="gx-menu-item"
                style={action.danger ? { color: "var(--danger)" } : undefined}
                onClick={() => {
                  setOpen(false);
                  action.onSelect(ref.current?.querySelector<HTMLElement>("button") ?? null);
                }}
              >
                {action.label}
              </button>
            ))}
          </FloatingMenu>
        </div>
      ) : null}
    </div>
  );
}
