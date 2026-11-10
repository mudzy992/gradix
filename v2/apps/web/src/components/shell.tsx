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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./ui";

export type NavItem = { href: string; label: string; icon: IconName; description?: string };
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

/** Prvo slovo imena i prezimena — isto u traci i u tabeli. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}

const THEME_KEY = "gx-theme";
type ThemeChoice = "light" | "dark" | "system";

/**
 * Tema: prati sistem, osim kad je korisnik ručno izabrao. Izbor se pamti u `localStorage`;
 * „prati sistem“ briše ključ (tada odluku ponovo nosi `prefers-color-scheme`).
 * Prvo iscrtavanje rješava inline skripta u `layout.tsx` — ovdje se samo održava stanje.
 */
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const initial: ThemeChoice = stored === "light" || stored === "dark" ? stored : "system";
    setChoice(initial);
    setResolved(initial === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : initial);
  }, []);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolved(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);

  const apply = useCallback((next: ThemeChoice) => {
    setChoice(next);
    const effective =
      next === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next;
    setResolved(effective);
    // Atribut na <html> — isto mjesto koje čita inline skripta pri sljedećem učitavanju.
    document.documentElement.dataset.theme = effective;
    if (next === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  }, []);

  return { choice, resolved, apply };
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { choice, resolved, apply } = useTheme();

  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  /**
   * Sesija u drugom tabu / istek / opoziv (A2): okvir povremeno i pri povratku fokusa
   * provjeri sesiju; 401 znači da ovaj tab više nije prijavljen, pa ide na prijavu.
   * Bez ovoga drugi tab ostaje "prijavljen" dok korisnik ne klikne nešto što puca.
   */
  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!cancelled && response.status === 401) window.location.assign("/login");
      } catch {
        // Mrežna greška nije istek sesije — ne izbacuj korisnika zbog nje.
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void checkSession();
    }
    document.addEventListener("visibilitychange", onVisible);
    // Fokus prozora/taba provjerava bez uslova vidljivosti: headless i neki preglednici
    // visibilityState prijavljuju kasno, a fokus je pouzdan signal povratka korisnika.
    window.addEventListener("focus", checkSession);
    const timer = window.setInterval(() => void checkSession(), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkSession);
      window.clearInterval(timer);
    };
  }, []);

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
        item.label.toLowerCase().includes(needle) || (item.description ?? "").toLowerCase().includes(needle),
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
        style={{ maxWidth: 560, padding: 0 }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div style={{ padding: 10, borderBottom: "1px solid var(--line)" }}>
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

        <ul id={listId} role="listbox" aria-label="Stranice" style={{ maxHeight: 320, overflowY: "auto", padding: 8 }}>
          {results.length === 0 ? (
            <li style={{ padding: 12, color: "var(--muted)" }}>Nema stranice s tim imenom.</li>
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
                gap: 10,
                cursor: "pointer",
                background: position === index ? "var(--raise)" : undefined,
              }}
              onMouseEnter={() => setIndex(position)}
              onClick={() => onNavigate(item.href)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.description ? (
                <span style={{ marginLeft: "auto", fontSize: "var(--text-label)", color: "var(--muted)" }}>
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
            padding: "8px 14px",
            borderTop: "1px solid var(--line)",
            fontSize: "var(--text-label)",
            color: "var(--muted)",
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
