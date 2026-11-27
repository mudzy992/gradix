"use client";

/**
 * Zadaci projekta (tab 6) — jedan izvršilac (radnik ILI nalog), rok, prioritet, komentari.
 *
 * „Kasni“ nije status nego izvedeno stanje (`due_on < danas`), pa se prikazuje uz status. Komentar
 * smije pisati svako ko vidi zadatak — pitanje sa terena je ono što inače izostane.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDate, formatDateTime } from "@/format";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Input, SelectField as Select, Skeleton, Textarea,
} from "@/components/ui/index";
import type { TaskCommentRow, TaskListResult, TaskRow } from "@/server/task-types";

const STATUS_LABEL: Record<TaskRow["status"], string> = {
  OPEN: "Otvoren",
  IN_PROGRESS: "U toku",
  BLOCKED: "Blokiran",
  DONE: "Završen",
  CANCELLED: "Otkazan",
};

const PRIORITY_LABEL: Record<TaskRow["priority"], string> = {
  LOW: "Nizak",
  NORMAL: "Normalan",
  HIGH: "Visok",
  URGENT: "Hitno",
};

type TaskForm = {
  id?: string;
  title: string;
  description: string;
  dueOn: string;
  priority: TaskRow["priority"];
  status: TaskRow["status"];
};

const EMPTY: TaskForm = {
  title: "",
  description: "",
  dueOn: "",
  priority: "NORMAL",
  status: "OPEN",
};

export function ProjectTasks({
  projectId,
  canManage,
  today,
  initialDashboardFilter = "",
}: {
  projectId?: string;
  canManage: boolean;
  today?: boolean;
  initialDashboardFilter?: "" | "kasni" | "otvoreni";
}) {
  const [data, setData] = useState<TaskListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState(initialDashboardFilter);
  const [statusFilter, setStatusFilter] = useState<"" | TaskRow["status"]>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<TaskRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (statusFilter) query.set("status", statusFilter);
    if (dashboardFilter) {
      query.set("assignedProjects", "1");
      query.set("open", "1");
      if (dashboardFilter === "kasni") query.set("due", "OVERDUE");
    }
    if (today) query.set("assignee", "ME");
    if (today) query.set("due", "TODAY");
    const result = await apiCall<TaskListResult>(`/api/tasks?${query.toString()}`);
    if (!result.ok) {
      setError(result.message);
      setData(null);
      return;
    }
    setData(result.data);
  }, [projectId, statusFilter, today, dashboardFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const body = {
      ...(form.id ? { id: form.id } : {}),
      projectId: projectId ?? null,
      title: form.title.trim(),
      description: form.description.trim() || null,
      dueOn: form.dueOn || null,
      priority: form.priority,
      status: form.status,
    };
    const result = await apiCall<TaskRow>(
      form.id ? `/api/tasks/${form.id}` : "/api/tasks",
      form.id ? patchBody(body) : { ...jsonBody(body), method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm(null);
    setMessage("Zadatak je sačuvan.");
    await load();
  }

  async function quickStatus(task: TaskRow, status: TaskRow["status"]) {
    setBusy(true);
    setError(null);
    const result = await apiCall<TaskRow>(`/api/tasks/${task.id}`, patchBody({ status }));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(`Zadatak „${task.title}“ → ${STATUS_LABEL[status].toLowerCase()}.`);
    await load();
  }

  if (error && data === null) return <Alert tone="error">{error}</Alert>;
  if (data === null) return <Skeleton rows={4} />;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-inline-flex">
        {dashboardFilter ? <Button onClick={() => setDashboardFilter("")}>Prikaži sve zadatke</Button> : null}
        {dashboardFilter ? <span>{dashboardFilter === "kasni" ? "Zadaci koji kasne" : "Otvoreni zadaci"} · dodijeljeni projekti · najviše 500 zapisa</span> : null}
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "" | TaskRow["status"])}
        >
          <option value="">Svi</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {canManage ? (
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + Novi zadatak
          </Button>
        ) : null}
      </div>

      {data.tasks.length === 0 ? (
        <EmptyState
          title="Nema zadataka"
          description="Zadatak nosi jednog izvršioca i rok. Kasni zadaci se vide i bez filtera — rok je taj koji govori stanje."
        />
      ) : (
        <DataTable
          caption="Zadaci"
          rows={data.tasks}
          rowKey={(task) => task.id}
          emptyText="Nema zadataka."
          columns={[
            {
              key: "title",
              header: "Zadatak",
              cell: (task) => (
                <span className="gx-stack gx-stack--2">
                  <span>{task.title}</span>
                  {task.project_code ? (
                    <span className="gx-page-sub">
                      {task.project_code} {task.project_name ? `· ${task.project_name}` : ""}
                      {task.phase_name ? ` · ${task.phase_name}` : ""}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "assignee",
              header: "Izvršilac",
              cell: (task) => task.assignee_worker_name ?? task.assignee_user_name ?? "nije dodijeljen",
            },
            {
              key: "due",
              header: "Rok",
              cell: (task) => (
                <span className="gx-stack gx-stack--2">
                  <span>{formatDate(task.due_on)}</span>
                  {task.overdue ? <Chip tone="hot">kasni</Chip> : null}
                </span>
              ),
              sortValue: (task) => task.due_on ?? "",
            },
            {
              key: "priority",
              header: "Prioritet",
              cell: (task) => PRIORITY_LABEL[task.priority],
            },
            {
              key: "status",
              header: "Stanje",
              cell: (task) => (
                <Chip tone={task.status === "DONE" ? "hollow" : task.status === "BLOCKED" ? "hot" : "hollow"}>
                  {STATUS_LABEL[task.status]}
                </Chip>
              ),
            },
            {
              key: "comments",
              header: "Komentari",
              numeric: true,
              cell: (task) => String(task.comment_count),
            },
          ]}
          rowActionLabel={(task) => `Više radnji za zadatak ${task.title}`}
          actions={(task) => {
            const actions = [
              { key: "comments", label: "Komentari", onSelect: () => setCommentsFor(task) },
            ];
            if (canManage) {
              if (task.status !== "DONE" && task.status !== "CANCELLED") {
                actions.push({
                  key: "done",
                  label: "Označi završenim",
                  onSelect: () => void quickStatus(task, "DONE"),
                });
              }
              actions.push({
                key: "edit",
                label: "Izmijeni zadatak",
                onSelect: () =>
                  setForm({
                    id: task.id,
                    title: task.title,
                    description: task.description ?? "",
                    dueOn: task.due_on ?? "",
                    priority: task.priority,
                    status: task.status,
                  }),
              });
            }
            return actions;
          }}
        />
      )}

      {form ? (
        <Dialog
          title={form.id ? "Izmjena zadatka" : "Novi zadatak"}
          hint="Jedan izvršilac po zadatku — tim se dodjeljuje kroz više zadataka, ne kroz jedno polje."
          returnFocusTo={null}
          onClose={() => setForm(null)}
        >
          <form className="gx-stack" onSubmit={submit}>
            <Input
              label="Naslov"
              required
              maxLength={200}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <Textarea
              label="Opis"
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <Input
              label="Rok"
              type="date"
              value={form.dueOn}
              onChange={(event) => setForm({ ...form, dueOn: event.target.value })}
            />
            <Select
              label="Prioritet"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as TaskRow["priority"] })}
            >
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            {form.id ? (
              <Select
                label="Stanje"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as TaskRow["status"] })}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            ) : null}
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj zadatak
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {commentsFor ? <TaskComments task={commentsFor} onClose={() => setCommentsFor(null)} /> : null}
    </div>
  );
}

function TaskComments({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const [comments, setComments] = useState<TaskCommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiCall<{ comments: TaskCommentRow[] }>(`/api/tasks/${task.id}/comments`);
    if (!result.ok) {
      setError(result.message);
      setComments([]);
      return;
    }
    setComments(result.data.comments);
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (body.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<TaskCommentRow>(`/api/tasks/${task.id}/comments`, {
      ...jsonBody({ body: body.trim(), attachmentId: null }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBody("");
    await load();
  }

  return (
    <Dialog title={`Komentari · ${task.title}`} returnFocusTo={null} onClose={onClose}>
      <div className="gx-stack">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {comments === null ? <Skeleton rows={2} /> : null}
        {comments !== null && comments.length === 0 ? (
          <p className="gx-page-sub">Još nema komentara.</p>
        ) : null}
        {comments !== null && comments.length > 0 ? (
          <ul className="gx-stack gx-stack--2">
            {comments.map((comment) => (
              <li key={comment.id} className="gx-stack gx-stack--2">
                <span className="gx-page-sub">
                  {comment.author_name} · {formatDateTime(comment.created_at)}
                </span>
                <span>{comment.body}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <form className="gx-stack" onSubmit={submit}>
          <Textarea
            label="Novi komentar"
            rows={3}
            maxLength={2000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="gx-inline-flex">
            <Button type="submit" variant="primary" disabled={busy || body.trim().length === 0}>
              Pošalji komentar
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
