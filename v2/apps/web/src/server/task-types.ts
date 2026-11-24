export type TaskServiceError = { code: string; message: string };

export type TaskRow = {
  id: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  title: string;
  description: string | null;
  assignee_worker_id: string | null;
  assignee_worker_name: string | null;
  assignee_user_id: string | null;
  assignee_user_name: string | null;
  due_on: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  completed_at: string | null;
  overdue: boolean;
  comment_count: number;
};

export type TaskListResult = {
  tasks: TaskRow[];
  counts: { mine_today: number; overdue: number; open: number };
};

export type TaskQuery = {
  projectId?: string;
  status?: TaskRow["status"];
  assignee?: "ME" | "ALL";
  due?: "TODAY" | "OVERDUE";
};

export type TaskInput = {
  id?: string;
  projectId?: string | null;
  phaseId?: string | null;
  title?: string;
  description?: string | null;
  assigneeWorkerId?: string | null;
  assigneeUserId?: string | null;
  dueOn?: string | null;
  priority?: TaskRow["priority"];
  status?: TaskRow["status"];
};

export type TaskCommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};
