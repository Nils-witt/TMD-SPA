import { request } from './client';
import type { EntityMeta, Timestamp } from './entity';
import { listFetcher } from './list';

// What executing an action task does. Only workflows give a task an action
// (create_task with a webhook URL); it never changes. A secret header's value
// is never sent to the client (null).
export type TaskAction = {
  kind: 'webhook';
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'GET';
  headers?: { name: string; value: string | null; secret: boolean }[];
  // A template rendered when executed; empty sends task and mission as JSON.
  body?: string;
};

export type TaskActionRun = {
  status: 'running' | 'succeeded' | 'failed';
  at: Timestamp;
  by: string;
  finished_at: Timestamp | null;
  http_status: number | null;
  // Why a run failed; empty otherwise.
  error: string;
};

// Tasks are never deleted, only archived.
export type Task = EntityMeta & {
  id: string;
  mission: string;
  name: string;
  description: string;
  scheduled_at: Timestamp | null;
  done_at: Timestamp | null;
  // Empty while not done.
  done_by: string;
  archived_at: Timestamp | null;
  // Empty while not archived.
  archived_by: string;
  // null for a plain task.
  action: TaskAction | null;
  action_run: TaskActionRun | null;
};

export const tasksBasePath = '/api/v1/tasks';

// Archived tasks included.
export const tasksPath = (missionId: string) =>
  `${tasksBasePath}?mission=${encodeURIComponent(missionId)}`;

export const fetchTasks = listFetcher<Task>('tasks');

export type TaskFields = {
  name: string;
  description: string;
  scheduled_at: Timestamp | null;
};

const taskPath = (id: string, sub = '') => `${tasksBasePath}/${encodeURIComponent(id)}${sub}`;

export const tasksApi = {
  create: (missionId: string, f: TaskFields) =>
    request<Task>(tasksBasePath, {
      method: 'POST',
      body: JSON.stringify({ mission: missionId, ...f }),
    }),
  update: (id: string, f: Partial<TaskFields>) =>
    request<Task>(taskPath(id), { method: 'PATCH', body: JSON.stringify(f) }),
  setDone: (id: string, done: boolean) =>
    request<Task>(taskPath(id, '/done'), { method: done ? 'POST' : 'DELETE' }),
  setArchived: (id: string, archived: boolean) =>
    request<Task>(taskPath(id, '/archive'), { method: archived ? 'POST' : 'DELETE' }),
  // Runs the action once; a failed run resolves too, with action_run failed.
  execute: (id: string) => request<Task>(taskPath(id, '/execute'), { method: 'POST' }),
};

// An executed action task is done for good.
export const actionExecuted = (t: Task) => t.action_run?.status === 'succeeded';

// Why the task's action cannot be executed now, null if it can.
export function executeBlocker(t: Task): string | null {
  if (t.action === null) return 'The task has no action.';
  if (actionExecuted(t)) return 'Already executed.';
  if (t.archived_at !== null) return 'The task is archived.';
  if (t.action_run?.status === 'running') return 'Running.';
  return null;
}

// Where an action goes, for display: "POST example.com".
export function actionSummary(a: TaskAction): string {
  let host = a.url;
  try {
    host = new URL(a.url).host;
  } catch {
    // not a URL: shown as it is
  }
  return `${a.method} ${host}`;
}
