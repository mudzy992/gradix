"use client";

/**
 * Okvir aplikacije (R1c): sidebar + header + sadržaj.
 *
 * Zašto klijentska komponenta, a ne server: sklapanje sidebara, drawer na telefonu i `Ctrl+K`
 * su stanje u pregledniku. Podaci (korisnik, dozvole) dolaze kao props sa servera — okvir ne
 * zna ništa o bazi i ne pravi nijedan zahtjev koji stranica već nije napravila.
 *
 * Tastatura (definicija gotovosti R1c):
 *  - sidebar: `↑`/`↓` po stavkama, `Home`/`End`, `Enter` prati link,
 *  - `Ctrl+K` (i `Cmd+K`) otvara pretragu, `↑`/`↓` biraju, `Enter` vodi, `Esc` zatvara,
 *  - `Esc` zatvara drawer i vraća fokus na dugme koje ga je otvorilo,
 *  - preskakanje na sadržaj („Preskoči na sadržaj“) je prvi fokusabilni element.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export type NavItem = { href: string; label: string; icon: string; description?: string };
export type NavGroup = { label: string; items: NavItem[] };
export type ShellUser = { displayName: string; email: string; companyName: string; roles: string[] };

const ROLE_BS: Record<string, string> = {
  OWNER: "Vlasnik",
  ADMIN: "Administrator",
  PROJECT_MANAGER: "Vođa projekta",
  SITE_SUPERVISOR: "Šef gradilišta",
  WORKER: "Radnik",
  DRIVER: "Vozač",
  MACHINE_OPERATOR: "Rukovalac",
  MECHANIC: "Mehaničar",
  ACCOUNTANT: "Računovođa",
};

/** Prvo slovo imena i prezimena — isto u headeru i u tabeli. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}

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

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Zatvori drawer pri promjeni stranice — na telefonu bi inače ostao preko sadržaja.
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
    <div className="gx-shell" data-collapsed={collapsed} data-open={drawerOpen}>
      {/* Preskakanje navigacije je prvi fokusabilni element — bez njega je tastatura kroz
          sidebar jedini put do sadržaja. */}
      <a href="#sadrzaj" className="gx-skip">
        Preskoči na sadržaj
      </a>

      {drawerOpen ? (
        <button
          type="button"
          className="gx-shell__scrim"
          aria-label="Zatvori navigaciju"
          onClick={closeDrawer}
        />
      ) : null}

      <aside className="gx-sidebar" data-collapsed={collapsed}>
        <div className="gx-sidebar__brand">
          <span aria-hidden="true" className="gx-mono" style={{ fontSize: 16, fontWeight: 800 }}>
            GX
          </span>
          {/* Puni naziv firme stoji u `title` — u sidebaru se skraćuje, ne lomi. */}
          <span className="gx-sidebar__brand-text" title={user.companyName}>
            {user.companyName}
          </span>
        </div>

        {/* Ime je na `<nav>` (landmark koji čitač ekrana nudi u spisku regija), ne na
            `<aside>` — inače navigacija nema pristupačno ime. */}
        <nav ref={navRef} className="gx-sidebar__nav" aria-label="Glavna navigacija" onKeyDown={onNavKeyDown}>
          {groups.map((group) => (
            <div className="gx-nav-group" key={group.label}>
              <p className="gx-nav-group__label">{group.label}</p>
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
                    title={collapsed ? item.label : undefined}
                  >
                    <span aria-hidden="true" className="gx-nav-item__icon gx-mono">
                      {item.icon}
                    </span>
                    <span className="gx-nav-item__text">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="gx-sidebar__footer">
          <button
            type="button"
            className="gx-sidebar__collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Proširi navigaciju" : "Skupi navigaciju"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span aria-hidden="true" className="gx-mono">
              {collapsed ? "»" : "«"}
            </span>
            {collapsed ? null : <span>Skupi</span>}
          </button>
        </div>
      </aside>

      <div className="gx-main">
        <header className="gx-header">
          <button
            ref={menuButton}
            type="button"
            className="gx-header__menu gx-icon-button"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Zatvori meni" : "Otvori meni"}
            onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <nav aria-label="Putanja" className="gx-breadcrumbs">
            <Link href="/pregled" className="gx-breadcrumbs__root">
              Gradix
            </Link>
            {current ? (
              <>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{current.label}</span>
              </>
            ) : null}
          </nav>

          {/* Dvije verzije istog dugmeta: puno polje na desktopu, ikona na telefonu. Jedno od
              njih je `display: none` po širini, pa čitač ekrana vidi samo jedno. */}
          <button
            type="button"
            className="gx-search"
            onClick={openSearch}
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Traži (Ctrl K)"
          >
            <span aria-hidden="true">⌕</span>
            <span className="gx-search__label">Traži…</span>
            <kbd className="gx-search__key" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="gx-icon-button"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={`Korisnički meni: ${user.displayName}`}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="gx-avatar" aria-hidden="true">
                {initialsOf(user.displayName)}
              </span>
            </button>

            {userMenuOpen ? (
              <div
                role="menu"
                aria-label="Korisnički meni"
                className="gx-dialog"
                style={{ position: "absolute", right: 0, top: 36, width: 232, zIndex: 20, padding: 8 }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setUserMenuOpen(false);
                }}
              >
                <p style={{ fontWeight: 600 }}>{user.displayName}</p>
                <p className="gx-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {user.email}
                </p>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>
                  {user.roles.map((role) => ROLE_BS[role] ?? role).join(", ")}
                </p>
                <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: "6px 0" }} />
                <Link role="menuitem" href="/lozinka/promjena" className="gx-menu-item">
                  Promijeni lozinku
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button role="menuitem" type="submit" className="gx-menu-item" style={{ width: "100%" }}>
                    Odjavi se
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </header>

        <main id="sadrzaj" className="gx-content">
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
 * `Ctrl+K` — pretraga po stavkama navigacije (R1c ne dodaje nove izvore: nema pretrage
 * korisnika ni zapisa, to bi bila nova funkcionalnost).
 */
function CommandPalette({
  items,
  onClose,
  onNavigate,
}: {
  items: NavItem[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle),
    );
  }, [items, query]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((value) => Math.min(value + 1, results.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((value) => Math.max(value - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[index];
      if (target) onNavigate(target.href);
    }
  }

  return (
    <div className="gx-overlay" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Brza navigacija"
        className="gx-dialog"
        style={{ width: "min(560px, 100%)" }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div style={{ padding: 8, borderBottom: "1px solid var(--color-border)" }}>
          <input
            ref={input}
            className="gx-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[index] ? `${listId}-${index}` : undefined}
            aria-label="Traži stranicu"
            placeholder="Traži stranicu…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <ul id={listId} role="listbox" aria-label="Stranice" style={{ maxHeight: 320, overflowY: "auto" }}>
          {results.length === 0 ? (
            <li style={{ padding: 12, color: "var(--color-text-muted)" }}>Nema stranice s tim imenom.</li>
          ) : null}
          {results.map((item, position) => (
            <li
              key={item.href}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={position === index}
              className="gx-menu-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                cursor: "pointer",
                background: position === index ? "var(--color-brand-soft)" : undefined,
              }}
              onMouseEnter={() => setIndex(position)}
              onClick={() => onNavigate(item.href)}
            >
              <span aria-hidden="true" className="gx-mono" style={{ width: 18 }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.description ? (
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" }}>
                  {item.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "6px 12px",
            borderTop: "1px solid var(--color-border)",
            fontSize: 11,
            color: "var(--color-text-muted)",
          }}
        >
          <span>
            <kbd className="gx-search__key">↑↓</kbd> biraj
          </span>
          <span>
            <kbd className="gx-search__key">Enter</kbd> otvori
          </span>
          <span>
            <kbd className="gx-search__key">Esc</kbd> zatvori
          </span>
        </div>
      </div>
    </div>
  );
}
