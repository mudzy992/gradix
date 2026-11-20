"use client";

import Link from "next/link";
import { useRef, useEffect, useState } from "react";
import { ROLE_BS, initialsOf } from "./shell-user";
import type { ThemeChoice } from "./shell-theme";

export function ShellUserMenu({
  displayName,
  email,
  roles,
  choice,
  applySystem,
}: {
  displayName: string;
  email: string;
  roles: string[];
  choice: ThemeChoice;
  applySystem: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="gx-avatar gx-avatar--lg"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Korisnički meni: ${displayName}`}
        onClick={() => setOpen((value) => !value)}
      >
        {initialsOf(displayName)}
      </button>
      {open ? (
        <div role="menu" aria-label="Korisnički meni" className="gx-menu" style={{ top: "calc(100% + 8px)" }}>
          <div style={{ padding: "4px 12px 8px" }}>
            <p style={{ fontWeight: 700 }}>{displayName}</p>
            <p className="gx-mono" style={{ color: "var(--muted)" }}>
              {email}
            </p>
            <p style={{ fontSize: "var(--text-label)", color: "var(--muted)" }}>
              {roles.map((role) => ROLE_BS[role] ?? role).join(", ")}
            </p>
          </div>
          <Link role="menuitem" href="/lozinka/promjena" className="gx-menu-item">
            Promijeni lozinku
          </Link>
          {choice !== "system" ? (
            <button role="menuitem" type="button" className="gx-menu-item" onClick={applySystem}>
              Tema prati sistem
            </button>
          ) : null}
          <form action="/api/auth/logout" method="post">
            <button role="menuitem" type="submit" className="gx-menu-item">
              Odjavi se
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
