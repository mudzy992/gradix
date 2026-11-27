"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FloatingMenu } from "./ui/floating-menu";
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
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".gx-menu--floating")) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
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
      <FloatingMenu open={open} anchor={buttonRef.current} label="Korisnički meni">
        <div style={{ padding: "4px 12px 8px" }}>
          <p style={{ fontWeight: 700 }}>{displayName}</p>
          <p className="gx-mono" style={{ color: "var(--muted)" }}>
            {email}
          </p>
          <p style={{ fontSize: "var(--text-label)", color: "var(--muted)" }}>
            {roles.map((role) => ROLE_BS[role] ?? role).join(", ")}
          </p>
        </div>
        <Link role="menuitem" href="/ured/profil" className="gx-menu-item" onClick={() => setOpen(false)}>
          Moj profil i sigurnost
        </Link>
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
      </FloatingMenu>
    </div>
  );
}
