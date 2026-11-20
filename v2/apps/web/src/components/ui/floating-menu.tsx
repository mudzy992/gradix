"use client";

/**
 * Meni van skrol-ploče (portal na body + position:fixed).
 * Potrebno jer .gx-page / .gx-main imaju overflow i siječu absolute menije u tabelama.
 */
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MENU_MIN_WIDTH = 224;
const EDGE = 8;
const GAP = 8;

export function FloatingMenu({
  open,
  anchor,
  label,
  children,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  label: string;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setStyle(null);
      return;
    }
    function place() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(MENU_MIN_WIDTH, rect.width);
      let left = rect.right - width;
      left = Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE);
      const spaceBelow = window.innerHeight - rect.bottom - EDGE;
      const openUp = spaceBelow < 180 && rect.top > spaceBelow;
      setStyle(
        openUp
          ? {
              position: "fixed",
              top: rect.top - GAP,
              left,
              right: "auto",
              minWidth: width,
              zIndex: 60,
              transform: "translateY(-100%)",
              maxHeight: Math.max(120, rect.top - EDGE * 2),
              overflowY: "auto",
            }
          : {
              position: "fixed",
              top: rect.bottom + GAP,
              left,
              right: "auto",
              minWidth: width,
              zIndex: 60,
              maxHeight: Math.max(120, spaceBelow),
              overflowY: "auto",
            },
      );
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, anchor]);

  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <div role="menu" aria-label={label} className="gx-menu gx-menu--floating" style={style}>
      {children}
    </div>,
    document.body,
  );
}
