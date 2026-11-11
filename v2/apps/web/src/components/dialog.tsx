"use client";

/**
 * Dijalog — jedan obrazac za sve dijaloge (fokus ulazi, `Escape` zatvara, fokus se vraća).
 *
 * Obrazac (U, katalog): zaglavlje s naslovom i **X za izlazak**, tijelo koje se skrola
 * **bez vidljivog scrollbar-a**, i podnožje (`footer`) u kojem stoje akcije — uvijek na
 * istom mjestu, i kad je sadržaj dug. Zašto komponenta: ista pravila su se do sada
 * ponavljala u svakom dijalogu; kad se u jednom zaborave, tastatura ostane van dijaloga
 * ili fokus padne na `<body>` — a to je upravo ono što a11y provjera primijeti prvo.
 *
 * Fokus se vraća na `returnFocusTo` (element koji je dijalog otvorio), a ne na
 * `document.activeElement` u trenutku zatvaranja — taj element često više ne postoji.
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
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Akcije u podnožju (npr. Otkaži / Sačuvaj). Stoje i kad tijelo skrola. */
  footer?: ReactNode;
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
