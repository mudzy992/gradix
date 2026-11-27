"use client";

/**
 * Okvir aplikacije — fiksni viewport, skrol u gx-page / gx-nav (L0–L1).
 * Dizajn: `docs/design/DESIGN.md` + `reference.html`.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui/index";
import { startSessionWatch } from "./session-watch";
import { useTheme } from "./shell-theme";
import { ROLE_BS, initialsOf } from "./shell-user";
import { CommandPalette } from "./shell-palette";
import { ShellNav } from "./shell-nav";
import { ModuleNavigation, ModuleTabs } from "./module-nav";
import type { NavModule } from "./nav";
import { ShellUserMenu } from "./shell-user-menu";
import { ShellBell } from "./shell-bell";
import type { NavGroup } from "./shell-types";

export { initialsOf };
export type { NavItem, NavGroup } from "./shell-types";
export type ShellUser = { displayName: string; email: string; companyName: string; roles: string[] };

export default function Shell({
  groups,
  modules,
  user,
  children,
}: {
  groups: NavGroup[];
  modules?: NavModule[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { choice, resolved, apply } = useTheme();
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(
    () => startSessionWatch({ onUnauthorized: () => window.location.assign("/login") }),
    [],
  );

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const allItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const current = allItems.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  const openSearch = useCallback(() => setSearchOpen(true), []);

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
        {modules ? <ModuleNavigation modules={modules} pathname={pathname} onNavigate={() => setDrawerOpen(false)} /> : <ShellNav groups={groups} pathname={pathname} currentHref={current?.href} />}
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
          <button
            type="button"
            className="gx-icon-btn"
            aria-label={resolved === "dark" ? "Pređi na svijetlu temu" : "Pređi na tamnu temu"}
            title={choice === "system" ? "Tema prati sistem" : "Tema je izabrana ručno"}
            onClick={() => apply(resolved === "dark" ? "light" : "dark")}
          >
            <Icon name={resolved === "dark" ? "sun" : "moon"} />
          </button>
          <ShellBell />
          <ShellUserMenu
            displayName={user.displayName}
            email={user.email}
            roles={user.roles}
            choice={choice}
            applySystem={() => apply("system")}
          />
        </header>
        <main id="sadrzaj" className="gx-page gx-scroll-hidden" tabIndex={-1}>
          {modules ? <ModuleTabs modules={modules} pathname={pathname} /> : null}
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
