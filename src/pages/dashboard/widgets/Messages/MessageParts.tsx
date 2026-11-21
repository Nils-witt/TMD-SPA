import { useRef } from 'react';
import {
  isImageFile,
  type Message,
  type MessageFile,
  type MessageReceiverOption,
  maxMessageFiles,
  messageAttachmentAccept,
} from '@/api/messages';
import { type MessageTag, tagTextColor } from '@/api/messageTags';
import Chip, { type ChipTone } from '@/components/Chip';
import SymbolIcon from '@/components/symbols/SymbolIcon';
import { usePriorityLabel } from '@/data/messages';
import { formatSize } from '../shared/logbookEntries';
import MessageTagChip from '../shared/MessageTagChip';
import { downloadMessageFile, openMessageFile, useMessageFileUrl } from './messagesState';
import styles from './Messages.module.scss';

const priorityTones: Record<number, ChipTone> = { 1: 'red', 2: 'yellow' };

export function PriorityChip({ priority }: { priority: number }) {
  const label = usePriorityLabel(priority);
  return (
    <Chip label={label} tone={priorityTones[priority] ?? 'default'} title={`Priority ${label}`} />
  );
}

export function TagChips({ tags }: { tags: readonly MessageTag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className={styles.chips}>
      {tags.map((t) => (
        <MessageTagChip key={t.id} tag={t} />
      ))}
    </span>
  );
}

// The picked functions of To or CC, each removable, then the fixed ones.
export function FunctionPicks({
  label,
  picked,
  options,
  all,
  fixed = [],
  disabled,
  onChange,
}: {
  label: string;
  picked: readonly string[];
  // What may still be added.
  options: readonly MessageReceiverOption[];
  all: readonly MessageReceiverOption[];
  fixed?: readonly MessageReceiverOption[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const name = (id: string) => all.find((r) => r.id === id)?.name ?? id;
  const addable = options.filter((o) => !picked.includes(o.id));
  return (
    <span className={styles.chips}>
      {picked.map((id) => (
        <span key={id} className={styles.pick}>
          {name(id)}
          <button
            type="button"
            aria-label={`Remove ${name(id)} from ${label}`}
            disabled={disabled}
            onClick={() => onChange(picked.filter((p) => p !== id))}
          >
            ×
          </button>
        </span>
      ))}
      {fixed.map((r) => (
        <span
          key={r.id}
          className={`${styles.pick} ${styles.fixed}`}
          title="Always CC: added to every message"
        >
          {r.name}
        </span>
      ))}
      {addable.length > 0 && (
        <select
          aria-label={`Add to ${label}`}
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && onChange([...picked, e.target.value])}
        >
          <option value="">Add…</option>
          {addable.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

// The chosen tags in their colors, each removable, then a select adding one
// of the others: a multi-select like FunctionPicks. choices gives the order.
export function TagPicks({
  choices,
  picked,
  disabled,
  onChange,
}: {
  choices: readonly MessageTag[];
  picked: readonly string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const inOrder = (ids: readonly string[]) =>
    choices.filter((t) => ids.includes(t.id)).map((t) => t.id);
  const chosen = choices.filter((t) => picked.includes(t.id));
  const addable = choices.filter((t) => !picked.includes(t.id));
  return (
    <span className={styles.chips}>
      {chosen.map((t) => (
        <span
          key={t.id}
          className={`${styles.pick} ${styles.tagPick}`}
          style={{ background: t.color, color: tagTextColor(t.color) }}
        >
          {t.deleted ? `${t.name} (deleted)` : t.name}
          <button
            type="button"
            aria-label={`Remove the tag ${t.name}`}
            disabled={disabled}
            onClick={() => onChange(picked.filter((p) => p !== t.id))}
          >
            ×
          </button>
        </span>
      ))}
      {addable.length > 0 && (
        <select
          aria-label="Add a tag"
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && onChange(inOrder([...picked, e.target.value]))}
        >
          <option value="">Add…</option>
          {addable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

// The attachments of a message, images with a thumbnail; a click opens one
// in a new tab.
export function AttachmentList({
  message,
  onError,
}: {
  message: Message;
  onError: (message: string) => void;
}) {
  const files = message.files ?? [];
  if (files.length === 0) return null;
  const run = (fn: () => Promise<void>) =>
    fn().catch((err: unknown) => onError((err as Error).message));
  return (
    <ul className={styles.files}>
      {files.map((f) => (
        <li key={f.id} className={styles.file}>
          <button
            type="button"
            className={styles.fileOpen}
            title={`Open ${f.filename}`}
            onClick={() => run(() => openMessageFile(message, f))}
          >
            {isImageFile(f) ? (
              <Thumbnail message={message} file={f} />
            ) : (
              <SymbolIcon name="picture_as_pdf" className={styles.fileIcon} />
            )}
            <span className={styles.fileName}>{f.filename}</span>
          </button>
          <span className="muted">{formatSize(f.size)}</span>
          <button
            type="button"
            className={styles.fileDownload}
            aria-label={`Download ${f.filename}`}
            title="Download"
            onClick={() => run(() => downloadMessageFile(message, f))}
          >
            <SymbolIcon name="download" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumbnail({ message, file }: { message: Message; file: MessageFile }) {
  const { url } = useMessageFileUrl(message, file);
  return url ? (
    <img className={styles.thumb} src={url} alt="" />
  ) : (
    <SymbolIcon name="image" className={styles.fileIcon} />
  );
}

// The files picked to send, each removable, then a button picking more
// (images and PDFs only, which the picker offers).
export function AttachmentPicks({
  id,
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  // The Attach button's, for the field's label.
  id?: string;
  files: readonly File[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className={styles.chips}>
      {files.map((f, i) => (
        <span key={`${i}-${f.name}`} className={styles.pick} title={formatSize(f.size)}>
          {f.name}
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            disabled={disabled}
            onClick={() => onRemove(f)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={messageAttachmentAccept}
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])]);
          // So picking the same file again fires a change.
          e.target.value = '';
        }}
      />
      <button
        id={id}
        type="button"
        disabled={disabled || files.length >= maxMessageFiles}
        title="Images (PNG, JPEG, GIF, WebP) and PDFs"
        onClick={() => input.current?.click()}
      >
        Attach…
      </button>
    </span>
  );
}
