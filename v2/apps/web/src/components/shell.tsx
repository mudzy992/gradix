"use client";

/**
 * Okvir aplikacije — prema `docs/design/reference.html`: sidebar na pozadini, jedna velika
 * ploča sa gornjom trakom (pretraga `Ctrl K`, tema, korisnik).
 *
 * Zašto klijentska komponenta: drawer na telefonu, `Ctrl+K` i tema su stanje u pregledniku.
 * Podaci (korisnik, dozvole, navigacija) dolaze kao props sa servera — okvir ne zna ništa o
 * bazi i ne pravi nijedan zahtjev koji stranica već nije napravila.
 *
 * Tastatura:
 *  - sidebar: `↑`/`↓` po stavkama, `Home`/`End`, `Enter` prati link,
 *  - `Ctrl+K` (i `Cmd+K`) otvara pretragu, `↑`/`↓` biraju, `Enter` vodi, `Esc` zatvara,
 *  - `Esc` zatvara drawer i vraća fokus na dugme koje ga je otvorilo,
 *  - „Preskoči na sadržaj“ je prvi fokusabilni element.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Icon } from "./ui/index";
import { startSessionWatch } from "./session-watch";
import { useTheme } from "./shell-theme";
import { ROLE_BS, initialsOf } from "./shell-user";
import { CommandPalette } from "./shell-palette";
import type { NavItem } from "./shell-types";

export { initialsOf };

export type { NavItem } from "./shell-types";
export type NavGroup = { label: string; items: NavItem[] };
export type ShellUser = { displayName: string; email: string; companyName: string; roles: string[] };

export default function Shell({
  groups,
  user,
  children,
}: {
  groups: NavGroup[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { choice, resolved, apply } = useTheme();

  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  /**
   * Sesija u drugom tabu / istek / opoziv (A2): čuvar je u session-watch.ts —
   * odjavljuje samo na 401, nikad na mrežnu grešku.
   */
  useEffect(
    () => startSessionWatch({ onUnauthorized: () => window.location.assign("/login") }),
    [],
  );

  // Zatvori drawer i meni pri promjeni stranice — na telefonu bi inače ostali preko sadržaja.
  useEffect(() => {
    setDrawerOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  const allItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const current = allItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // `Ctrl+K` / `Cmd+K` je globalan: radi i kad fokus nije na okviru.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  /**
   * Korisnički meni se zatvara na `Esc` i na klik van njega.
   *
   * Zašto globalno, a ne `onKeyDown` na meniju: fokus poslije klika na dugme ostaje na dugmetu,
   * pa `Esc` nikad ne bi stigao do menija. Bez ovoga meni „visi“ i prekriva sadržaj.
   */
  useEffect(() => {
    if (!userMenuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
        menuButton.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [userMenuOpen]);

  /** Strelicama kroz sidebar — isti redoslijed kao u DOM-u, bez preskakanja grupa. */
  function onNavKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]") ?? []);
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(index + 1, links.length - 1) : Math.max(index - 1, 0);
      links[next]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      links[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      links[links.length - 1]?.focus();
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    menuButton.current?.focus();
  }

  return (
    <div className="gx-shell" data-open={drawerOpen}>
      <a href="#sadrzaj" className="gx-skip">
        Preskoči na sadržaj
      </a>

      {drawerOpen ? (
        <button type="button" className="gx-shell__scrim" aria-label="Zatvori navigaciju" onClick={closeDrawer} />
      ) : null}

      <aside className="gx-sidebar">
        <div className="gx-brand">
          <span aria-hidden="true" className="gx-brand__mark" />
          <span className="gx-brand__text" title={user.companyName}>
            Gradix
          </span>
        </div>

        {/* Ime je na `<nav>` (landmark koji čitač ekrana nudi u spisku regija), ne na
            `<aside>` — inače navigacija nema pristupačno ime. */}
        <nav ref={navRef} className="gx-nav" aria-label="Glavna navigacija" onKeyDown={onNavKeyDown}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="gx-nav__group">{group.label}</p>
              {group.items.map((item) => {
                const active = item.href === current?.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav-item
                    data-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className="gx-nav-item"
                  >
                    <span className="gx-nav-item__icon">
                      <Icon name={item.icon} />
                    </span>
                    <span>{item.label}</span>
                    {item.badge && item.badge.count > 0 ? (
                      <Badge tone={item.badge.older > 0 ? "danger" : "primary"}>{item.badge.count}</Badge>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="gx-org">
          <span aria-hidden="true" className="gx-avatar">
            {initialsOf(user.displayName)}
          </span>
          <div className="gx-org__text">
            <span className="gx-org__name" title={user.companyName}>
              {user.companyName}
            </span>
            <span className="gx-org__person">
              {user.displayName} · {user.roles.map((role) => ROLE_BS[role] ?? role).join(", ")}
            </span>
          </div>
        </div>
      </aside>

      <div className="gx-main">
        <header className="gx-topbar">
          <button
            ref={menuButton}
            type="button"
            className="gx-icon-btn gx-topbar__menu"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Zatvori meni" : "Otvori meni"}
            onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
          >
            <Icon name="menu" />
          </button>

          <button
            type="button"
            className="gx-search"
            onClick={openSearch}
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Traži (Ctrl K)"
          >
            <Icon name="search" />
            <span className="gx-search__label">Traži projekte, radnike, mašine</span>
            <kbd className="gx-search__key" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>

          <span className="gx-topbar__spacer" />

          {/* Tema: jedno dugme koje mijenja svijetlu i tamnu. Ime nosi stanje koje SLIJEDI,
              jer se to dešava na klik („Pređi na tamnu“), a `title` objašnjava izvor. */}
          <button
            type="button"
            className="gx-icon-btn"
            aria-label={resolved === "dark" ? "Pređi na svijetlu temu" : "Pređi na tamnu temu"}
            title={choice === "system" ? "Tema prati sistem" : "Tema je izabrana ručno"}
            onClick={() => apply(resolved === "dark" ? "light" : "dark")}
          >
            <Icon name={resolved === "dark" ? "sun" : "moon"} />
          </button>

          <div style={{ position: "relative" }} ref={userMenuRef}>
            <button
              type="button"
              className="gx-avatar gx-avatar--lg"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={`Korisnički meni: ${user.displayName}`}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              {initialsOf(user.displayName)}
            </button>

            {userMenuOpen ? (
              <div
                role="menu"
                aria-label="Korisnički meni"
                className="gx-menu"
                style={{ top: "calc(100% + 8px)" }}
              >
                <div style={{ padding: "4px 12px 8px" }}>
                  <p style={{ fontWeight: 700 }}>{user.displayName}</p>
                  <p className="gx-mono" style={{ color: "var(--muted)" }}>
                    {user.email}
                  </p>
                  <p style={{ fontSize: "var(--text-label)", color: "var(--muted)" }}>
                    {user.roles.map((role) => ROLE_BS[role] ?? role).join(", ")}
                  </p>
                </div>
                <Link role="menuitem" href="/lozinka/promjena" className="gx-menu-item">
                  Promijeni lozinku
                </Link>
                {choice !== "system" ? (
                  <button role="menuitem" type="button" className="gx-menu-item" onClick={() => apply("system")}>
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
        </header>

        <main id="sadrzaj" className="gx-page">
          {children}
        </main>
      </div>

      {searchOpen ? (
        <CommandPalette
          items={allItems}
          onClose={() => setSearchOpen(false)}
          onNavigate={(href) => {
            setSearchOpen(false);
            router.push(href);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * `Ctrl+K` — pretraga po stavkama navigacije. Nova funkcionalnost (pretraga korisnika i
 * zapisa) nije dio dizajna, pa je nema.
 */
