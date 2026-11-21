import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import {
  attachmentProblem,
  awaitsAcknowledgement,
  chatDisabledType,
  composeOptions,
  type Message,
  type MessageBox,
  type MessageFile,
  type MessagePriority,
  messagesApi,
  maxMessageFiles,
  maxMessageOrigin,
  maxMessageText,
  useMessageReceivers,
  useMessages,
} from '@/api/messages';
import { activeTags, type MessageTag, useMessageTags } from '@/api/messageTags';
import { useTransmissionWays } from '@/api/transmissionWays';
import { useChatEnabled, useMessageAccess } from '@/data/messages';

// The state of a messages view, shared by the desktop widget and /m.

export const boxLabels: Record<MessageBox, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  all: 'All',
};

const isBox = (v: unknown): v is MessageBox => v === 'inbox' || v === 'sent' || v === 'all';
export const parseBox = (v: unknown) => (isBox(v) ? v : undefined);

export type MessagesView = ReturnType<typeof useMessagesView>;

// box/unacknowledged/tag are the caller's state (useWidgetState on the
// desktop), so the list is a pure view of it.
export function useMessagesView(box: MessageBox, tag: string, unacknowledged: boolean) {
  const access = useMessageAccess();
  const chatEnabled = useChatEnabled();
  const boxes: MessageBox[] = access.viewAll ? ['inbox', 'sent', 'all'] : ['inbox', 'sent'];
  // A box the session may no longer use (switched function) falls back.
  const shownBox = boxes.includes(box) ? box : 'inbox';
  const list = useMessages(
    access.load ? { box: shownBox, tag: tag || null, unacknowledged } : null,
  );
  const tags = useMessageTags(access.load);
  const tagsById = new Map((tags.data ?? []).map((t) => [t.id, t]));
  return { access, chatEnabled, boxes, box: shownBox, list, tags, tagsById };
}

// The tags of a message in its order, those unknown (another scope's) left
// out.
export const tagsOf = (m: Message, byId: ReadonlyMap<string, MessageTag>) =>
  m.tags.flatMap((id) => byId.get(id) ?? []);

// What is wrong with sending now, or null.
export function sendBlocker(
  access: ReturnType<typeof useMessageAccess>,
  chatEnabled: boolean | undefined,
): string | null {
  if (access.offline) return 'Messages cannot be sent offline.';
  if (!access.send) return 'Needs the permission messages.send.';
  if (chatEnabled === false) return 'The chat is disabled in this scope.';
  return null;
}

// Acknowledging and tagging one message.
export function useMessageActions(message: Message | undefined, onChanged: (m: Message) => void) {
  const access = useMessageAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<Message>) => {
    setBusy(true);
    try {
      onChanged(await fn());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canAcknowledge =
    !!message && !access.offline && awaitsAcknowledgement(message, access.functionId);
  return {
    busy,
    error,
    clearError: () => setError(null),
    canAcknowledge,
    // Tags can be changed by anyone reading the message, online.
    canTag: !!message && !access.offline,
    acknowledge: () => message && void run(() => messagesApi.acknowledge(message.id)),
    setTags: (tags: string[]) => message && void run(() => messagesApi.setTags(message, tags)),
  };
}

// The attachments after picking added: those the API would refuse are left
// out and named in error, as are any beyond maxMessageFiles. A file picked
// again (same name, size and time) is kept once.
export function addAttachments(
  current: readonly File[],
  added: readonly File[],
): { files: File[]; error: string | null } {
  const same = (a: File, b: File) =>
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  const problems: string[] = [];
  const files = [...current];
  for (const f of added) {
    const problem = attachmentProblem(f.name);
    if (problem) problems.push(problem);
    else if (!files.some((g) => same(f, g))) files.push(f);
  }
  if (files.length > maxMessageFiles) {
    problems.push(`A message has at most ${maxMessageFiles} attachments.`);
    files.length = maxMessageFiles;
  }
  return { files, error: problems.length > 0 ? problems.join(' ') : null };
}

export type ComposeState = ReturnType<typeof useMessageCompose>;

// The compose form: To and CC from /api/v1/message-receivers, a function
// chosen in one list not offered in the other, always-CC ones as fixed CC.
export function useMessageCompose(onSent: (m: Message) => void) {
  const access = useMessageAccess();
  const chatEnabled = useChatEnabled();
  const receivers = useMessageReceivers(access.load);
  const tags = useMessageTags(access.load);
  const ways = useTransmissionWays(access.load);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [priority, setPriority] = useState<MessagePriority>(3);
  const [text, setText] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  // '' for none.
  const [wayId, setWayId] = useState('');
  const [origin, setOrigin] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = composeOptions(receivers.data ?? [], access.functionId, to, cc);
  const blocker = sendBlocker(access, chatEnabled);
  const canSend =
    blocker === null &&
    !busy &&
    to.length > 0 &&
    text.trim() !== '' &&
    text.length <= maxMessageText &&
    origin.length <= maxMessageOrigin;

  const reset = () => {
    setTo([]);
    setCc([]);
    setPriority(3);
    setText('');
    setTagIds([]);
    setWayId('');
    setOrigin('');
    setFiles([]);
    setError(null);
  };

  const addFiles = (added: readonly File[]) => {
    const next = addAttachments(files, added);
    setFiles(next.files);
    setError(next.error);
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const m = await messagesApi.send(
        {
          to,
          cc,
          priority,
          text: text.trim(),
          tags: tagIds,
          transmission_way: wayId || null,
          origin: origin.trim() || null,
        },
        files,
      );
      reset();
      onSent(m);
    } catch (err) {
      setError(
        err instanceof ApiError && err.type === chatDisabledType
          ? 'The chat is disabled in this scope.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    to,
    setTo,
    cc,
    setCc,
    priority,
    setPriority,
    text,
    setText,
    tagIds,
    setTagIds,
    options,
    receivers,
    tags: activeTags(tags.data),
    wayId,
    setWayId,
    origin,
    setOrigin,
    files,
    addFiles,
    removeFile: (f: File) => setFiles((fs) => fs.filter((g) => g !== f)),
    ways: ways.items.toSorted((a, b) => a.name.localeCompare(b.name)),
    blocker,
    canSend,
    busy,
    error,
    clearError: () => setError(null),
    send,
    reset,
  };
}

// An attachment's content as an object URL (it needs the token, so no plain
// link or <img src> can load it), revoked on unmount; null while loading or
// when disabled, error if it failed.
export function useMessageFileUrl(m: Pick<Message, 'id'>, f: MessageFile, enabled = true) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: null,
    error: null,
  });
  // By value: a message's files never change, and a reload brings new objects.
  const messageId = m.id;
  const { id: fileId, filename, content_type, size } = f;
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let url: string | null = null;
    messagesApi
      .file({ id: messageId }, { id: fileId, filename, content_type, size }, ctrl.signal)
      .then((blob) => {
        if (ctrl.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: null });
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setState({ url: null, error: (err as Error).message });
      });
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [messageId, fileId, filename, content_type, size, enabled]);
  return state;
}

// Opens the attachment in a new tab (images and PDFs show in the browser).
// The tab is opened before the content loads, so no popup blocker stops it;
// where none opens, it is downloaded instead.
export async function openMessageFile(m: Pick<Message, 'id'>, f: MessageFile) {
  const tab = window.open('', '_blank');
  if (!tab) return downloadMessageFile(m, f);
  try {
    const url = URL.createObjectURL(await messagesApi.file(m, f));
    tab.location.href = url;
    // Once the tab has loaded it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab.close();
    throw err;
  }
}

export async function downloadMessageFile(m: Pick<Message, 'id'>, f: MessageFile) {
  const url = URL.createObjectURL(await messagesApi.file(m, f));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
