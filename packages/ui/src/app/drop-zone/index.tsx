'use client';

import { clsx } from 'clsx';
import { CircleAlert, FileText, CloudUpload, X } from 'lucide-react';
import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useMergedRef } from '../text-field/field-shell';
import './drop-zone.css';

/**
 * DropZone (u15). A dashed area that lifts and tints while a file is dragged
 * over it, with a real button that opens the native file picker (so the
 * keyboard path is the browser's own). Chosen files are listed with a
 * remove button each.
 *
 * It uploads NOTHING: it hands the chosen `File`s to `onFiles` and the
 * caller does the rest. A dropped file that the `accept` list refuses is
 * left out and said so, since a drop does not pass through the picker's
 * own filter. `accept`, `multiple`, `name`, `capture` and every other
 * attribute reach the native <input type="file">.
 */
export type DropZoneProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value' | 'defaultValue'
> & {
  readonly onFiles: (files: File[]) => void;
  readonly label?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  /** The button's words. */
  readonly buttonText?: string | undefined;
  /** Show the chosen files under the zone. */
  readonly showFiles?: boolean | undefined;
};

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a !== '')
    .some((a) => {
      if (a.startsWith('.')) return name.endsWith(a);
      if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
      return type === a;
    });
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DropZone = forwardRef<HTMLInputElement, DropZoneProps>(function DropZone(
  {
    onFiles,
    label = 'Drop files here',
    hint,
    error,
    buttonText = 'Choose files',
    showFiles = true,
    accept,
    multiple,
    disabled,
    className,
    id: idProp,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-dz-${autoId}`;
  const [node, setRef] = useMergedRef<HTMLInputElement>(ref);
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [left, setLeft] = useState<string | null>(null);
  const depth = useRef(0);
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';

  function take(list: File[]): void {
    const ok = list.filter((f) => matchesAccept(f, accept));
    const kept = multiple === true ? ok : ok.slice(0, 1);
    const wrongType = list.length - ok.length;
    const extra = ok.length - kept.length;
    const notes = [
      wrongType > 0
        ? `${wrongType} ${wrongType === 1 ? 'file is' : 'files are'} not an accepted type`
        : null,
      extra > 0 ? `only one file can be added` : null,
    ].filter((x): x is string => x !== null);
    setLeft(notes.length > 0 ? `Left out: ${notes.join('; ')}.` : null);
    if (kept.length === 0) return;
    setFiles(kept);
    onFiles(kept);
  }

  function picked(e: ChangeEvent<HTMLInputElement>): void {
    take(Array.from(e.target.files ?? []));
  }

  function enter(e: DragEvent<HTMLDivElement>): void {
    if (disabled === true) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }
  function leave(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }
  function overIt(e: DragEvent<HTMLDivElement>): void {
    if (disabled === true) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function drop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled === true) return;
    take(Array.from(e.dataTransfer.files));
  }

  function remove(i: number): void {
    const next = files.filter((_, k) => k !== i);
    setFiles(next);
    setLeft(null);
    if (node.current) node.current.value = '';
    onFiles(next);
  }

  const described =
    [hasError ? `${id}-e` : null, hasHint ? `${id}-h` : null]
      .filter((x): x is string => x !== null)
      .join(' ') || undefined;

  return (
    <div className={clsx('sk-drop', className)} data-invalid={hasError || undefined}>
      <div
        className="sk-drop__zone"
        data-over={over || undefined}
        data-disabled={disabled === true || undefined}
        onDragEnter={enter}
        onDragLeave={leave}
        onDragOver={overIt}
        onDrop={drop}
      >
        <span className="sk-drop__icon" aria-hidden>
          <CloudUpload size={22} />
        </span>
        <span className="sk-drop__label">{label}</span>
        <span className="sk-drop__or" aria-hidden>
          or
        </span>
        <button
          type="button"
          className="sk-drop__btn"
          disabled={disabled}
          aria-describedby={described}
          onClick={() => node.current?.click()}
        >
          {buttonText}
        </button>
        <input
          ref={setRef}
          id={id}
          type="file"
          className="sk-drop__input"
          tabIndex={-1}
          aria-hidden
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={picked}
          {...rest}
        />
      </div>
      {hasError ? (
        <p className="sk-drop__msg" data-kind="error" id={`${id}-e`} aria-live="polite">
          <CircleAlert size={14} aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {hasHint ? (
        <p className="sk-drop__msg" id={`${id}-h`}>
          {hint}
        </p>
      ) : null}
      <p className="sk-drop__msg" data-kind="notice" aria-live="polite">
        {left}
      </p>
      {showFiles && files.length > 0 ? (
        <ul className="sk-drop__files" aria-label="Chosen files">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="sk-drop__file">
              <FileText size={16} aria-hidden className="sk-drop__file-icon" />
              <span className="sk-drop__file-name">{f.name}</span>
              <span className="sk-drop__file-size sk-figure">{sizeText(f.size)}</span>
              <button
                type="button"
                className="sk-drop__remove"
                aria-label={`Remove ${f.name}`}
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
