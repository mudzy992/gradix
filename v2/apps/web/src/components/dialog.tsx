"use client";

/**
 * Dijalog — jedan obrazac za sve dijaloge (fokus ulazi, `Escape` zatvara, fokus se vraća).
 *
 * Početni fokus ide SAMO jednom na mount. `onClose` / `returnFocusTo` idu preko ref-a
 * da re-render roditelja (npr. tipkanje u kontrolisanom polju) ne bi ponovo fokusirao
 * prvo polje — bug Partneri/Tenderi (2026-11-20).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/index";

export function Dialog({
  title,
  hint,
  children,
  footer,
  returnFocusTo,
  onClose,
  wide = false,
  trapFocus = false,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  wide?: boolean;
  trapFocus?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusToRef = useRef(returnFocusTo);
  onCloseRef.current = onClose;
  returnFocusToRef.current = returnFocusTo;

  useEffect(() => {
    const target = firstField.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [href]",
    );
    (target ?? panel.current)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (trapFocus && event.key === "Tab" && panel.current) {
        const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter(element => !element.closest('[hidden], [aria-hidden="true"]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first || !last) { event.preventDefault(); panel.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusToRef.current?.focus?.();
    };
  }, []);

  return (
    <div className="gx-overlay" role="presentation">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gx-dialog-title"
        tabIndex={-1}
        className="gx-dialog"
        style={wide ? { maxWidth: 880 } : undefined}
      >
        <div className="gx-dialog__header">
          <div>
            <h2 id="gx-dialog-title" className="gx-dialog__title">
              {title}
            </h2>
            {hint ? <p className="gx-dialog__hint">{hint}</p> : null}
          </div>
          <button type="button" className="gx-icon-btn" aria-label="Zatvori" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div ref={firstField} className="gx-dialog__body">
          {children}
        </div>
        {footer ? <div className="gx-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
