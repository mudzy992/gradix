"use client";

/**
 * F8 — radionica: red čekanja, filteri i brze radnje.
 *
 * Zašto `DataTable` a ne kartice: mehaničar gleda DESETINE naloga i poredi ih po kolonama
 * (koliko stoji, koji prioritet, čeka li dio). Kartice troše visinu i tjeraju skrolovanje za
 * podatkom koji staje u jedan red. Na mobilnom `DataTable` sam prelazi u kartice.
 *
 * Radnje (`Start`/`Završi`/`Čeka dio`) su OVDJE, a ne u detalju: posao u radionici je promjena
 * stanja, ne čitanje. Detalj služi za sate, dijelove i trošak.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Checkbox, DataTable, FilterBar, Inline, Select, Stack, StatusDot, TextLink } from "@/components/ui/index";
import type { ServiceOrderRow } from "@/server/service-order-types";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, formatDuration, money } from "./servis-shared";

type Caps = { canManage: boolean; canApprove: boolean };

export function ServisClient({
  initialOrders,
  caps,
}: {
  initialOrders: ServiceOrderRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [statusFilter, setStatusFilter] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => setOrders(initialOrders), [initialOrders]);

  const act = useCallback(
    async (order: ServiceOrderRow, action: "start" | "wait-parts" | "finish") => {
      setBusyId(order.id);
      setNotice(null);
      const result = await apiCall<{ outcome: string; message?: string }>(
        `/api/service-orders/${order.id}/${action}`,
        jsonBody(action === "finish" ? {} : {}),
      );
      setBusyId(null);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        return;
      }
      setNotice({
        tone: "success",
        text:
          action === "start"
            ? "Rad je počeo."
            : action === "wait-parts"
              ? "Nalog čeka dijelove."
              : "Nalog je završen; trošak je proknjižen.",
      });
      router.refresh();
    },
    [router],
  );

  const rows = useMemo(
    () =>
      orders.filter((order) => {
        if (statusFilter && order.status !== statusFilter) return false;
        if (onlyWaiting && order.status !== "WAITING_PARTS") return false;
        return true;
      }),
    [orders, onlyWaiting, statusFilter],
  );

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<ServiceOrderRow>>[0]["columns"] = [
      {
        key: "order",
        header: "Nalog",
        cell: (row) => (
          <Stack gap="var(--space-1)">
            <TextLink href={`/ured/servis/${row.id}`}>{row.machine_code} — {row.machine_name}</TextLink>
            <span className="gx-muted">{row.fault_title ?? row.description ?? "—"}</span>
          </Stack>
        ),
        sortValue: (row) => row.machine_code,
      },
      {
        key: "status",
        header: "Stanje",
        cell: (row) => <StatusDot tone={STATUS_TONE[row.status] ?? "muted"} label={STATUS_LABEL[row.status] ?? row.status} />,
        sortValue: (row) => row.status,
      },
      {
        key: "priority",
        header: "Prioritet",
        cell: (row) => PRIORITY_LABEL[row.priority] ?? row.priority,
        sortValue: (row) => row.priority,
      },
      {
        key: "mechanic",
        header: "Mehaničar",
        cell: (row) => row.assigned_mechanic_name ?? "—",
        sortValue: (row) => row.assigned_mechanic_name ?? "",
      },
      {
        key: "age",
        header: "Stoji",
        numeric: true,
        cell: (row) => (row.status === "DONE" || row.status === "CANCELLED" ? "—" : `${row.open_days} d`),
        sortValue: (row) => row.open_days,
      },
      {
        key: "downtime",
        header: "Zastoj",
        numeric: true,
        cell: (row) => formatDuration(row.downtime_minutes),
        sortValue: (row) => row.downtime_minutes ?? -1,
      },
      {
        key: "cost",
        header: "Trošak",
        numeric: true,
        cell: (row) => money(row.total_cost_amount, row.currency_code),
        sortValue: (row) => Number(row.total_cost_amount),
      },
      {
        key: "approval",
        header: "Odobrenje",
        cell: (row) =>
          row.approval_status === "OPEN"
            ? "Čeka"
            : row.approval_status === "APPROVED"
              ? "Odobreno"
              : row.approval_status === "REJECTED"
                ? "Odbijeno"
                : "—",
      },
    ];
    if (caps.canManage) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => {
          const disabled = busyId === row.id;
          if (row.status === "DONE" || row.status === "CANCELLED") {
            return <TextLink href={`/ured/servis/${row.id}`}>Detalj</TextLink>;
          }
          return (
            <Inline gap="var(--space-2)">
              {row.status === "PLANNED" || row.status === "APPROVED" ? (
                <Button variant="secondary" disabled={disabled} onClick={() => void act(row, "start")}>
                  Počni
                </Button>
              ) : null}
              {row.status === "IN_PROGRESS" ? (
                <Button variant="quiet" disabled={disabled} onClick={() => void act(row, "wait-parts")}>
                  Čeka dio
                </Button>
              ) : null}
              {row.status === "WAITING_PARTS" ? (
                <Button variant="secondary" disabled={disabled} onClick={() => void act(row, "start")}>
                  Nastavi
                </Button>
              ) : null}
              {row.status === "IN_PROGRESS" || row.status === "WAITING_PARTS" ? (
                <Button variant="primary" disabled={disabled} onClick={() => void act(row, "finish")}>
                  Završi
                </Button>
              ) : null}
            </Inline>
          );
        },
      });
    }
    return base;
  }, [act, busyId, caps.canManage]);

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select label="Stanje" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Sva stanja</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Checkbox
          label="Samo ono što čeka dijelove"
          checked={onlyWaiting}
          onChange={(event) => setOnlyWaiting(event.target.checked)}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        caption="Red čekanja radionice"
        emptyText="Nema naloga za izabrane filtere."
      />
    </Stack>
  );
}
