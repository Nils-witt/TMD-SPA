import { type FormEvent, useMemo, useState } from 'react';
import {
  actionExecuted,
  actionSummary,
  executeBlocker,
  type Task,
  type TaskFields,
  tasksApi,
} from '@/api/tasks';
import { useReplica } from '@/api/replica';
import { useCan } from '@/app/session';
import ConfirmDialog from '@/components/ConfirmDialog';
import { FieldRow, FormActions, FormError, Section, WidgetForm } from '@/components/form';
import { useSelectedMission } from '@/data/selectedMissionContext';
import { localInputValue } from '../Reports/reportHelpers';
import { formatTime } from '../shared/logbookEntries';
import WidgetActionBar, { WidgetAction } from '../shared/WidgetActionBar';
import { EmptyState, NoMission } from '../shared/WidgetStates';
import type { WidgetProps } from '../widgetOptions';
import { useWidgetState } from '../widgetState';
import styles from './Tasks.module.scss';

const parseBool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

// Open tasks first (scheduled ones by time), then done ones; newest first
// within each.
function sortTasks(tasks: Task[]): Task[] {
  const rank = (t: Task) => (t.done_at === null ? 0 : 1);
  return [...tasks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.scheduled_at ?? '￿').localeCompare(b.scheduled_at ?? '￿') ||
      b.id.localeCompare(a.id),
  );
}

// The selected mission's tasks. Users create plain tasks; workflows create
// action tasks, whose Execute button runs the action once: success marks the
// task done for good, a failure leaves it open to try again.
function Tasks(_props: WidgetProps) {
  const { mission, readOnly, tasks } = useSelectedMission();
  const replica = useReplica();
  const canEdit = useCan('missions.edit');
  const [showArchived, setShowArchived] = useWidgetState('showArchived', false, parseBool);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [executing, setExecuting] = useState<Task | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writable = !readOnly && canEdit.allowed;

  const rows = useMemo(
    () => sortTasks(tasks.items.filter((t) => showArchived || t.archived_at === null)),
    [tasks.items, showArchived],
  );

  const run = (id: string, write: () => Promise<Task>) => {
    setBusy(id);
    setError(null);
    return write()
      .then((t) => replica.put('tasks', t))
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setBusy(null));
  };

  const actions = (
    <WidgetActionBar label="Task actions">
      <WidgetAction
        disabled={mission === null || !writable}
        title={canEdit.hint}
        onClick={() => setEditing('new')}
      >
        New Task
      </WidgetAction>
      <WidgetAction pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
        Archived
      </WidgetAction>
    </WidgetActionBar>
  );

  if (mission === null) {
    return (
      <>
        {actions}
        <NoMission className="mt" />
      </>
    );
  }
  return (
    <>
      {actions}
      {editing !== null && (
        <TaskForm
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (f) => {
            const saved =
              editing === 'new'
                ? await tasksApi.create(mission.id, f)
                : await tasksApi.update(editing.id, f);
            replica.put('tasks', saved);
            setEditing(null);
          }}
        />
      )}
      {!tasks.loading && rows.length === 0 ? (
        <EmptyState>{tasks.items.length > 0 ? 'No open tasks.' : 'No tasks yet.'}</EmptyState>
      ) : (
        <ul className={`list ${styles.list}`}>
          {rows.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              writable={writable}
              hint={readOnly ? undefined : canEdit.hint}
              busy={busy === t.id}
              onDone={(done) => void run(t.id, () => tasksApi.setDone(t.id, done))}
              onArchive={(archived) => void run(t.id, () => tasksApi.setArchived(t.id, archived))}
              onEdit={() => setEditing(t)}
              onExecute={() => setExecuting(t)}
            />
          ))}
        </ul>
      )}
      {executing !== null && (
        <ConfirmDialog
          title="Execute task"
          message={
            <>
              Execute “{executing.name}”?{' '}
              {executing.action && `This sends ${actionSummary(executing.action)}. `}A successful
              run marks the task done and cannot be undone.
            </>
          }
          confirmLabel="Execute"
          onCancel={() => setExecuting(null)}
          onConfirm={async () => {
            const t = await tasksApi.execute(executing.id);
            replica.put('tasks', t);
            setExecuting(null);
            if (t.action_run?.status === 'failed') {
              setError(`“${t.name}” failed: ${t.action_run.error || 'unknown error'}`);
            }
          }}
        />
      )}
      <FormError error={error ?? tasks.error} onClose={() => setError(null)} />
    </>
  );
}

type TaskItemProps = {
  task: Task;
  writable: boolean;
  hint: string | undefined;
  busy: boolean;
  onDone: (done: boolean) => void;
  onArchive: (archived: boolean) => void;
  onEdit: () => void;
  onExecute: () => void;
};

function TaskItem({
  task: t,
  writable,
  hint,
  busy,
  onDone,
  onArchive,
  onEdit,
  onExecute,
}: TaskItemProps) {
  const done = t.done_at !== null;
  const archived = t.archived_at !== null;
  const blocker = executeBlocker(t);
  const run = t.action_run;
  const meta = [
    t.scheduled_at ? `due ${formatTime(t.scheduled_at)}` : '',
    actionExecuted(t)
      ? `executed by ${t.done_by} at ${formatTime(t.done_at ?? '')}`
      : done
        ? `done by ${t.done_by} at ${formatTime(t.done_at ?? '')}`
        : '',
    archived ? `archived by ${t.archived_by}` : '',
    `by ${t.created_by}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
  return (
    <li className={done || archived ? styles.closed : undefined}>
      {t.action === null ? (
        <input
          type="checkbox"
          className={styles.check}
          aria-label={done ? `Mark “${t.name}” not done` : `Mark “${t.name}” done`}
          checked={done}
          disabled={!writable || busy}
          title={hint}
          onChange={(e) => onDone(e.target.checked)}
        />
      ) : (
        <span className={styles.check} aria-hidden="true">
          {actionExecuted(t) ? '✓' : '⚡'}
        </span>
      )}
      <div className="content">
        <p className={styles.name}>
          {t.name}
          {t.action && (
            <span className={styles.badge} title={t.action.url}>
              {actionSummary(t.action)}
            </span>
          )}
        </p>
        {t.description && <p className={styles.description}>{t.description}</p>}
        {run && run.status !== 'succeeded' && (
          <p className={run.status === 'failed' ? styles.failed : 'secondary'}>
            {run.status === 'running'
              ? `Running since ${formatTime(run.at)} (${run.by})`
              : `Failed at ${formatTime(run.finished_at ?? run.at)} (${run.by})${
                  run.http_status ? `: HTTP ${run.http_status}` : ''
                }${run.error ? ` — ${run.error}` : ''}`}
          </p>
        )}
        <p className="secondary">{meta}</p>
      </div>
      <div className={styles.buttons}>
        {t.action && !actionExecuted(t) && (
          <button
            type="button"
            className="btn primary"
            disabled={!writable || busy || blocker !== null}
            title={hint ?? blocker ?? undefined}
            onClick={onExecute}
          >
            {run?.status === 'failed' ? 'Retry' : 'Execute'}
          </button>
        )}
        <button type="button" className="btn" disabled={!writable || busy} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="btn"
          disabled={!writable || busy}
          onClick={() => onArchive(!archived)}
        >
          {archived ? 'Restore' : 'Archive'}
        </button>
      </div>
    </li>
  );
}

type TaskFormProps = {
  task: Task | null;
  onSave: (f: TaskFields) => Promise<void>;
  onClose: () => void;
};

// Name, description and time only: an action is set by workflows alone and
// shown read-only.
function TaskForm({ task, onSave, onClose }: TaskFormProps) {
  const [name, setName] = useState(task?.name ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [scheduled, setScheduled] = useState(
    task?.scheduled_at ? localInputValue(new Date(task.scheduled_at)) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = task?.id ?? 'new';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    onSave({
      name: name.trim(),
      description,
      scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
    })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <WidgetForm onSubmit={submit} aria-label={task ? 'Edit task' : 'New task'}>
      <Section legend={task ? 'Edit Task' : 'New Task'}>
        <FieldRow id={`task-name-${id}`} label="Name" marked>
          <input
            id={`task-name-${id}`}
            value={name}
            maxLength={200}
            required
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        <FieldRow id={`task-description-${id}`} label="Description">
          <textarea
            id={`task-description-${id}`}
            value={description}
            maxLength={5000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FieldRow>
        <FieldRow id={`task-scheduled-${id}`} label="Scheduled">
          <input
            id={`task-scheduled-${id}`}
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </FieldRow>
        {task?.action && (
          <FieldRow id={`task-action-${id}`} label="Action">
            <p id={`task-action-${id}`} className={styles.description}>
              Webhook {task.action.method} {task.action.url}
              {(task.action.headers ?? []).map((h) => (
                <span key={h.name} className="secondary">
                  <br />
                  {h.name}: {h.secret ? '(secret)' : h.value}
                </span>
              ))}
              <br />
              <span className="secondary">Set by a workflow; it cannot be changed.</span>
            </p>
          </FieldRow>
        )}
      </Section>
      <FormActions
        submitLabel={task ? 'Save' : 'Add'}
        canSubmit={name.trim() !== ''}
        busy={busy}
        onDiscard={onClose}
        discardLabel="Cancel"
      />
      <FormError error={error} onClose={() => setError(null)} />
    </WidgetForm>
  );
}

export default Tasks;
