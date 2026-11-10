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
import { apiCall } from "@/api-client";
import { Alert, Button, Card, DataTable, Mono, PageHeader, Skeleton, Stack } from "@/components/ui/index";

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
    const result = await apiCall<Matrix>("/api/roles");
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "ready", data: result.data });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Pristup i role" subtitle="Ko šta smije u firmi. Dozvole se ne mijenjaju iz ekrana." />

      {state.kind === "loading" ? <Skeleton rows={6} /> : null}

      {state.kind === "error" ? (
        <Card>
          <Stack>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </Stack>
        </Card>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <Alert tone="info">
            Ovo je pregled: koja rola šta smije. Izmjena dozvola po roli nije dio ove faze.
          </Alert>

          <Card>
            <p className="gx-page-sub">Rola × dozvola. Kvačica znači da rola ima dozvolu.</p>
            <DataTable
              caption="Matrica rola i dozvola"
              rows={state.data.roles}
              rowKey={(role) => role.role}
              emptyText="Nema rola za prikaz."
              columns={[
                {
                  key: "role",
                  header: "Rola",
                  cell: (role) => (
                    <Stack>
                      <strong>{role.label}</strong>
                      <Mono>{role.role}</Mono>
                      <span className="gx-page-sub">{role.description}</span>
                      <span className="gx-page-sub">
                        Dodjeljuje: {role.assignableBy.map((r) => (r === "OWNER" ? "vlasnik" : "administrator")).join(", ")}
                      </span>
                    </Stack>
                  ),
                },
                ...state.data.permissions.map((permission) => ({
                  key: permission.key,
                  header: permission.label,
                  cell: (role: RoleRow) => {
                    const has = role.permissions.includes(permission.key);
                    return has ? (
                      <span>
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">ima dozvolu</span>
                      </span>
                    ) : (
                      <span className="gx-page-sub">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">nema dozvolu</span>
                      </span>
                    );
                  },
                })),
              ]}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
