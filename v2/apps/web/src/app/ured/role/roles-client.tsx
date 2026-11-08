"use client";

/**
 * Matrica rola — PREGLED, ne uređivanje dozvola.
 *
 * Web (≥ 640 px): tabela role × dozvola, gusta, sa `✓`.
 * < 640 px: kartice, jedna rola po kartici — ista pravila kao lista korisnika.
 *
 * Sadržaj dolazi iz `/api/roles`, a taj endpoint gradi matricu iz `PERMISSIONS` u kodu. Zato
 * ekran ne može prikazati dozvolu koju ruta ne provjerava: jedan izvor, dva prikaza.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Pill, SectionTitle, Skeleton } from "@/components/ui";

type Permission = { key: string; label: string; description: string };
type RoleRow = {
  role: string;
  label: string;
  description: string;
  permissions: string[];
  assignableBy: string[];
};
type Matrix = { permissions: Permission[]; roles: RoleRow[]; editable: boolean };

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Matrix };

export default function RolesClient() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/roles", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", message: body?.error?.message ?? "Ne mogu da učitam matricu." });
        return;
      }
      setState({ kind: "ready", data: body.data as Matrix });
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid" style={{ gap: "var(--section-gap)" }}>
      <SectionTitle hint="pregled — dozvole se ne mijenjaju iz ekrana">
        Matrica rola
      </SectionTitle>

      {state.kind === "loading" ? <Skeleton rows={6} /> : null}

      {state.kind === "error" ? (
        <Card>
          <div className="grid gap-3">
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <Alert tone="info">
            Ovo je pregled: koja rola šta smije. Izmjena dozvola po roli nije dio ove faze.
          </Alert>

          {/* Tabela ≥ 640 px — vidi se na širokom ekranu */}
          <Card className="hidden sm:block">
            <table className="gx-table w-full text-[var(--body-size)]">
              <caption className="mb-2 text-left text-[13px] text-[var(--color-text-muted)]">
                Rola × dozvola. ✓ znači da rola ima dozvolu.
              </caption>
              <thead>
                <tr className="border-b-2 border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Rola
                  </th>
                  {state.data.permissions.map((permission) => (
                    <th key={permission.key} scope="col" className="px-3 py-2 font-semibold">
                      {permission.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.roles.map((role) => (
                  <tr key={role.role} className="border-b border-[var(--color-border)]">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {role.label}
                      <span className="block text-xs font-normal text-[var(--color-text-muted)]">
                        {role.description}
                      </span>
                    </th>
                    {state.data.permissions.map((permission) => {
                      const has = role.permissions.includes(permission.key);
                      return (
                        <td key={permission.key} className="px-3 py-2">
                          {has ? (
                            <span className="font-bold text-[var(--color-success)]">
                              <span aria-hidden="true">✓</span>
                              <span className="sr-only">ima dozvolu</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">nema dozvolu</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Kartice < 640 px — ista informacija, drugi ritam */}
          <div className="grid gap-3 sm:hidden">
            {state.data.roles.map((role) => (
              <Card key={role.role}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{role.label}</p>
                  <Pill tone="quiet">{role.role}</Pill>
                </div>
                <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">{role.description}</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {state.data.permissions.map((permission) => {
                    const has = role.permissions.includes(permission.key);
                    return (
                      <li key={permission.key} className="flex items-baseline gap-2">
                        <span
                          aria-hidden="true"
                          className={
                            has
                              ? "font-bold text-[var(--color-success)]"
                              : "text-[var(--color-text-muted)]"
                          }
                        >
                          {has ? "✓" : "—"}
                        </span>
                        <span className={has ? "" : "text-[var(--color-text-muted)]"}>
                          {permission.label}
                          <span className="sr-only">{has ? " — ima dozvolu" : " — nema dozvolu"}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
                  Dodjeljuje: {role.assignableBy.map((r) => (r === "OWNER" ? "vlasnik" : "administrator")).join(", ")}
                </p>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
