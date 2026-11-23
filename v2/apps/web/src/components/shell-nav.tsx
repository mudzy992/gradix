"use client";

/**
 * Skrolabilan sidebar meni s collapsible grupama (L1).
 * Izvor: plan layout shell — collapse A + sessionStorage `gx.nav.groups`.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Icon } from "./ui/index";
import {
  findActiveGroupLabel,
  readNavGroupOpenMap,
  resolveNavGroupOpenMap,
  writeNavGroupOpenMap,
  type NavOpenMap,
} from "./shell-nav-groups";
import type { NavItem } from "./shell-types";

export type ShellNavGroup = { label: string; items: NavItem[] };

export function ShellNav({
  groups,
  pathname,
  currentHref,
}: {
  groups: ShellNavGroup[];
  pathname: string;
  currentHref: string | undefined;
}) {
  const baseId = useId();
  const navRef = useRef<HTMLElement>(null);
  const labels = useMemo(() => groups.map((group) => group.label), [groups]);
  const labelsKey = labels.join("|");
  const activeLabel = findActiveGroupLabel(groups, pathname);

  const [openMap, setOpenMap] = useState<NavOpenMap>(() =>
    resolveNavGroupOpenMap({ labels, activeLabel, stored: {} }),
  );

  useEffect(() => {
    const next = resolveNavGroupOpenMap({
      labels,
      activeLabel,
      stored: readNavGroupOpenMap(),
    });
    setOpenMap(next);
    writeNavGroupOpenMap(next);
  }, [pathname, activeLabel, labels, labelsKey]);

  const toggleGroup = useCallback((label: string) => {
    setOpenMap((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      writeNavGroupOpenMap(next);
      return next;
    });
  }, []);

  function onNavKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const links = Array.from(
      navRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]") ?? [],
    ).filter((link) => !link.closest("[hidden]"));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown" ? Math.min(index + 1, links.length - 1) : Math.max(index - 1, 0);
      links[next]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      links[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      links[links.length - 1]?.focus();
    }
  }

  return (
    <nav
      ref={navRef}
      className="gx-nav gx-scroll-hidden"
      aria-label="Glavna navigacija"
      onKeyDown={onNavKeyDown}
    >
      {groups.map((group, groupIndex) => {
        const panelId = `${baseId}-panel-${groupIndex}`;
        const isOpen = openMap[group.label] === true;
        return (
          <div key={group.label}>
            <button
              type="button"
              className="gx-nav__group-btn"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleGroup(group.label)}
            >
              <span>{group.label}</span>
              <span aria-hidden="true" style={{ transform: isOpen ? "rotate(90deg)" : undefined }}>
                <Icon name="chevron" />
              </span>
            </button>
            <div id={panelId} className="gx-nav__group-panel" hidden={!isOpen}>
              {group.items.map((item) => {
                const active = item.href === currentHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav-item
                    data-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className="gx-nav-item"
                    tabIndex={isOpen ? undefined : -1}
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
          </div>
        );
      })}
    </nav>
  );
}
