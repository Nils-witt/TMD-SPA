import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useRef } from 'react';
import {
  isImageFile,
  type Message,
  type MessageFile,
  maxMessageFiles,
  messageAttachmentAccept,
} from '@/api/messages';
import { type MessageTag, tagTextColor } from '@/api/messageTags';
import SymbolIcon from '@/components/symbols/SymbolIcon';
import {
  downloadMessageFile,
  openMessageFile,
  useMessageFileUrl,
} from '@/pages/dashboard/widgets/Messages/messagesState';
import { formatSize } from '@/pages/dashboard/widgets/shared/logbookEntries';
import { usePriorityLabel } from '@/data/messages';

const priorityColors: Record<number, { bgcolor: string; color: string }> = {
  1: { bgcolor: 'var(--triage-red)', color: '#fff' },
  2: { bgcolor: 'var(--triage-yellow)', color: '#000' },
};

export function PriorityChipMUI({ priority }: { priority: number }) {
  const label = usePriorityLabel(priority);
  return (
    <Chip size="small" label={label} title={`Priority ${label}`} sx={priorityColors[priority]} />
  );
}

export function TagChipMUI({ tag }: { tag: MessageTag }) {
  return (
    <Chip
      size="small"
      label={tag.deleted ? `${tag.name} (deleted)` : tag.name}
      sx={{ bgcolor: tag.color, color: tagTextColor(tag.color) }}
    />
  );
}

export function TagChipsMUI({ tags }: { tags: readonly MessageTag[] }) {
  if (tags.length === 0) return null;
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }} component="span">
      {tags.map((t) => (
        <TagChipMUI key={t.id} tag={t} />
      ))}
    </Stack>
  );
}

// The tags as one multi-select, the chosen ones shown as chips; choices
// gives the order and the chips' colors.
export function TagSelectMUI({
  choices,
  value,
  disabled,
  onChange,
}: {
  choices: readonly MessageTag[];
  value: readonly string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const chosen = (ids: readonly string[]) => choices.filter((t) => ids.includes(t.id));
  return (
    <TextField
      select
      label="Tags"
      value={value}
      disabled={disabled}
      slotProps={{
        select: {
          multiple: true,
          displayEmpty: true,
          renderValue: (ids) =>
            (ids as string[]).length === 0 ? (
              <span>None</span>
            ) : (
              <TagChipsMUI tags={chosen(ids as string[])} />
            ),
        },
        inputLabel: { shrink: true },
      }}
      onChange={(e) => {
        const v = e.target.value as unknown as string[] | string;
        // Kept in the order of the choices, not of the clicks.
        const ids = typeof v === 'string' ? v.split(',') : v;
        onChange(chosen(ids).map((t) => t.id));
      }}
    >
      {choices.map((t) => (
        <MenuItem key={t.id} value={t.id}>
          <Checkbox size="small" checked={value.includes(t.id)} sx={{ py: 0 }} />
          <TagChipMUI tag={t} />
        </MenuItem>
      ))}
    </TextField>
  );
}

// As AttachmentList: a tap opens the file in a new tab, the button downloads.
export function AttachmentListMUI({
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
    <List dense disablePadding>
      {files.map((f) => (
        <ListItem
          key={f.id}
          disablePadding
          secondaryAction={
            <IconButton
              edge="end"
              aria-label={`Download ${f.filename}`}
              onClick={() => run(() => downloadMessageFile(message, f))}
            >
              <SymbolIcon name="download" />
            </IconButton>
          }
        >
          <ListItemButton onClick={() => run(() => openMessageFile(message, f))}>
            <ListItemAvatar>
              <FileAvatarMUI message={message} file={f} />
            </ListItemAvatar>
            <ListItemText
              primary={f.filename}
              secondary={formatSize(f.size)}
              slotProps={{ primary: { noWrap: true } }}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
}

function FileAvatarMUI({ message, file }: { message: Message; file: MessageFile }) {
  const image = isImageFile(file);
  const { url } = useMessageFileUrl(message, file, image);
  return (
    <Avatar variant="rounded" src={url ?? undefined} alt="">
      <SymbolIcon name={image ? 'image' : 'picture_as_pdf'} />
    </Avatar>
  );
}

// The files picked to send as removable chips, then Attach (images and
// PDFs; on a phone also the camera).
export function AttachmentPicksMUI({
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  files: readonly File[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {files.map((f, i) => (
        <Chip
          key={`${i}-${f.name}`}
          size="small"
          label={f.name}
          title={formatSize(f.size)}
          disabled={disabled}
          onDelete={() => onRemove(f)}
        />
      ))}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={messageAttachmentAccept}
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <Button
        size="small"
        startIcon={<SymbolIcon name="attach_file" />}
        disabled={disabled || files.length >= maxMessageFiles}
        onClick={() => input.current?.click()}
      >
        Attach
      </Button>
    </Stack>
  );
}
