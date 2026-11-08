"use client";

/**
 * Dijalog — jedan obrazac za sve dijaloge (fokus ulazi, `Escape` zatvara, fokus se vraća).
 *
 * Zašto komponenta: ista tri pravila su se do sada ponavljala u svakom dijalogu. Kad se u
 * jednom zaborave, tastatura ostane van dijaloga ili fokus padne na `<body>` — a to je upravo
 * ono što a11y provjera (i korisnik) primijeti prvo.
 *
 * Fokus se vraća na `returnFocusTo` (element koji je dijalog otvorio), a ne na
 * `document.activeElement` u trenutku zatvaranja — taj element često više ne postoji.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  title,
  hint,
  children,
  returnFocusTo,
  onClose,
  wide = false,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Prvo fokusira polje ako ga ima; ako dijalog nema polja (npr. potvrda), fokus ide na panel,
    // pa `Tab` kreće od prve kontrole unutar dijaloga umjesto sa strane.
    const target = firstField.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [href]",
    );
    (target ?? panel.current)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusTo?.focus?.();
    };
  }, [onClose, returnFocusTo]);

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
        <h2 id="gx-dialog-title" className="gx-dialog__title">
          {title}
        </h2>
        {hint ? <p className="gx-dialog__hint">{hint}</p> : null}
        <div ref={firstField}>{children}</div>
      </div>
    </div>
  );
}
