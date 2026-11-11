"use client";

/** Ctrl+K paleta komandi okvira: pretraga navigacije tastaturom. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./ui/index";
import type { NavItem } from "./shell";

export function CommandPalette({
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
