'use client';

import { Check, FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Translate } from '../i18n';
import type { UiMessageKey } from '../i18n/ui-messages';

/** How many files one question may carry. The server is the authority; this only sizes the tray. */
export const MAX_FILES = 3;
/** The file picker's filter. A hint for the dialog, never the check: the server sniffs the bytes. */
export const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export type AttachmentKind = 'IMAGE' | 'PDF';

/** A file the person is attaching right now: idle, busy, done or error. */
export interface PendingFile {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly kind: AttachmentKind;
  readonly state: 'busy' | 'done' | 'error';
  /** Server id, once uploaded. */
  readonly id?: string;
  readonly pages?: number | null;
  /** The server's `[CODE] message`, verbatim. */
  readonly error?: string;
  /** A local blob: URL of the original, for the thumbnail only. */
  readonly preview?: string;
}

/** A file that went with a question (what the transcript shows). */
export interface SentFile {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly bytes: number;
  readonly pages?: number | null;
  readonly preview?: string;
}

export interface UploadedAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly mediaType: string;
  readonly name: string;
  readonly bytes: number;
  readonly pages: number | null;
  readonly previewUrl?: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The server's own words: `[CODE] message`, exactly as it sent them (FE-2).
 * Anything that is not an API error with a message falls back to `fallback`.
 */
export function describeUploadError(e: unknown, fallback: string): string {
  const err = e as { code?: unknown; body?: unknown } | null;
  const body = err?.body as { message?: unknown } | null | undefined;
  const message = typeof body?.message === 'string' ? body.message : undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  if (message === undefined) return fallback;
  return code !== undefined ? `[${code}] ${message}` : message;
}

export function kindOfFile(file: { type: string }): AttachmentKind {
  return file.type.startsWith('image/') ? 'IMAGE' : 'PDF';
}

function Thumb({
  kind,
  preview,
}: {
  kind: AttachmentKind;
  preview?: string | undefined;
}): ReactElement {
  if (kind === 'IMAGE' && preview !== undefined) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="sk-ai-file__thumb" src={preview} alt="" width={32} height={32} />;
  }
  return (
    <span className="sk-ai-file__icon" aria-hidden="true">
      {kind === 'IMAGE' ? <ImageIcon size={18} /> : <FileText size={18} />}
    </span>
  );
}

/** One chip in the composer tray. */
export function AttachmentChip({
  file,
  t,
  onRemove,
}: {
  readonly file: PendingFile;
  readonly t: Translate<UiMessageKey>;
  readonly onRemove: (key: string) => void;
}): ReactElement {
  const meta =
    file.state === 'busy'
      ? t('ui.assistant.attachUploading', { name: file.name })
      : file.state === 'done'
        ? file.pages != null
          ? `${formatBytes(file.size)} · ${t('ui.assistant.attachPages', { n: file.pages })}`
          : formatBytes(file.size)
        : (file.error ?? t('ui.assistant.attachFailed', { name: file.name }));
  return (
    <li className="sk-ai-file" data-state={file.state} data-kind={file.kind}>
      <Thumb kind={file.kind} preview={file.preview} />
      <span className="sk-ai-file__text">
        <span className="sk-ai-file__name" title={file.name}>
          {file.name}
        </span>
        <span
          className="sk-ai-file__meta"
          // An error is announced when it appears; progress and success are not chatty.
          role={file.state === 'error' ? 'alert' : undefined}
        >
          {meta}
        </span>
      </span>
      <span className="sk-ai-file__state" aria-hidden="true">
        {file.state === 'busy' ? <Loader2 size={16} className="sk-ai-spin" /> : null}
        {file.state === 'done' ? <Check size={16} /> : null}
      </span>
      {file.state === 'busy' ? (
        <span className="sk-ai-file__bar" aria-hidden="true">
          <i />
        </span>
      ) : (
        <button
          type="button"
          className="sk-ai-file__remove"
          onClick={() => onRemove(file.key)}
          aria-label={t('ui.assistant.attachRemove', { name: file.name })}
          title={t('ui.assistant.attachRemove', { name: file.name })}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/** The chips under a sent question: name, type and size, with a download. */
export function SentFiles({
  files,
  t,
  onDownload,
}: {
  readonly files: readonly SentFile[];
  readonly t: Translate<UiMessageKey>;
  readonly onDownload: (file: SentFile) => void;
}): ReactElement {
  return (
    <ul className="sk-ai-files sk-ai-files--sent" aria-label={t('ui.assistant.attachments')}>
      {files.map((f) => (
        <li key={f.id} className="sk-ai-file" data-state="done" data-kind={f.kind}>
          <Thumb kind={f.kind} preview={f.preview} />
          <button
            type="button"
            className="sk-ai-file__text sk-ai-file__open"
            onClick={() => onDownload(f)}
            aria-label={t('ui.assistant.attachDownload', { name: f.name })}
            title={t('ui.assistant.attachDownload', { name: f.name })}
          >
            <span className="sk-ai-file__name">{f.name}</span>
            <span className="sk-ai-file__meta">
              {f.pages != null
                ? `${formatBytes(f.bytes)} · ${t('ui.assistant.attachPages', { n: f.pages })}`
                : formatBytes(f.bytes)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export { Paperclip };
