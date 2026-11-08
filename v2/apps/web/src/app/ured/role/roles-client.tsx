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
import { Alert, Button, Card, Mono, Skeleton } from "@/components/ui";

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
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Pristup i role</h1>
          <p className="gx-page-sub">Ko šta smije u firmi. Dozvole se ne mijenjaju iz ekrana.</p>
        </div>
      </div>

      {state.kind === "loading" ? <Skeleton rows={6} /> : null}

      {state.kind === "error" ? (
        <Card>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
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
            <table className="gx-table">
              <caption
                style={{
                  marginBottom: "var(--space-2)",
                  textAlign: "left",
                  fontSize: "var(--text-small)",
                  color: "var(--muted)",
                }}
              >
                Rola × dozvola. Kvačica znači da rola ima dozvolu.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rola</th>
                  {state.data.permissions.map((permission) => (
                    <th key={permission.key} scope="col">
                      {permission.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.roles.map((role) => (
                  <tr key={role.role}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 600, padding: "14px 12px" }}>
                      {role.label}
                      <Mono className="gx-mono--block">{role.role}</Mono>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-small)",
                          fontWeight: 500,
                          color: "var(--muted)",
                        }}
                      >
                        {role.description}
                      </span>
                    </th>
                    {state.data.permissions.map((permission) => {
                      const has = role.permissions.includes(permission.key);
                      return (
                        <td key={permission.key}>
                          {has ? (
                            <span style={{ fontWeight: 700, color: "var(--success, var(--text))" }}>
                              <span aria-hidden="true">✓</span>
                              <span className="sr-only">ima dozvolu</span>
                            </span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>
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
          <div className="gx-cards-mobile">
            {state.data.roles.map((role) => (
              <Card key={role.role}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <p style={{ fontWeight: 700 }}>{role.label}</p>
                  {/* Tehnički ključ je za podršku, ne za čitanje — zato mono i tiho. */}
                  <Mono className="text-[11px] text-[var(--color-text-muted)]">{role.role}</Mono>
                </div>
                <p style={{ marginTop: "var(--space-1)", fontSize: "var(--text-small)", color: "var(--muted)" }}>
                  {role.description}
                </p>
                <ul style={{ marginTop: "var(--space-2)", display: "grid", gap: "var(--space-1)", listStyle: "none", padding: 0 }}>
                  {state.data.permissions.map((permission) => {
                    const has = role.permissions.includes(permission.key);
                    return (
                      <li key={permission.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
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
