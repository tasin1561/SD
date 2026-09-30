'use client';

import { ChevronDown } from 'lucide-react';
import {
  forwardRef,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FieldShell,
  describedBy,
  hasContent,
  useMergedRef,
  type FieldMessages,
} from '../text-field';
import { OptionList, filterOptions, nextEnabled, optionId, type ComboOption } from './listbox';
import './combo-select.css';

export { filterOptions, type ComboOption } from './listbox';

/**
 * ComboSelect (u05 / u18). An ARIA 1.2 combobox: type to filter, ↑/↓ to
 * move, Enter to choose, Escape to close. Focus stays in the text input;
 * the active option is `aria-activedescendant`. Options may carry an icon
 * and a description. Leaving the field without choosing puts the chosen
 * label back; clearing the text and leaving clears the choice.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). With
 * `name`, a hidden input submits the chosen value with a form.
 *
 * ── REMOTE SEARCH (`remote` + `onQueryChange`) ───────────────────────
 * By default the options are the whole set and the typed text filters
 * them here. When the set is too large to hand over — a seller's
 * orders, a catalogue — the caller fetches instead: `onQueryChange`
 * reports what was typed (debounce it there, not here: how long to wait
 * is a property of the endpoint, not of the control) and `remote` turns
 * the local filter OFF.
 *
 * That second flag is load-bearing rather than a convenience. The
 * server decides what "matches" means, and for an order that is its
 * number, the seller's own reference, the recipient's name, their
 * phone AND the waybill — none of which need appear in the option's
 * LABEL. Left filtering locally, typing a phone number fetches the
 * right order and then hides it, because the label says
 * "SD-2026-26-000365 · Asha Verma".
 */
export type ComboSelectProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'role'
> &
  FieldMessages & {
    readonly options: readonly ComboOption[];
    readonly value?: string | null | undefined;
    readonly defaultValue?: string | null | undefined;
    readonly onChange?: ((value: string | null, option: ComboOption | null) => void) | undefined;
    /** Shown when nothing matches the typed text. */
    readonly emptyText?: ReactNode;
    /**
     * What was typed, on every keystroke. Debounce in the CALLER — the
     * right interval belongs to whatever it is asking.
     */
    readonly onQueryChange?: ((query: string) => void) | undefined;
    /**
     * The options are already the answer: do not filter them again
     * here. See the note above — local filtering over a remote result
     * hides rows the server matched on something the label never shows.
     */
    readonly remote?: boolean | undefined;
  };

export const ComboSelect = forwardRef<HTMLInputElement, ComboSelectProps>(function ComboSelect(
  {
    id: idProp,
    label,
    hint,
    help,
    notice,
    error,
    icon,
    options,
    value,
    defaultValue,
    onChange,
    emptyText = 'No matches',
    onQueryChange,
    remote = false,
    name,
    required,
    disabled,
    placeholder,
    className,
    onKeyDown,
    onBlur,
    'aria-describedby': describedByProp,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-f-${autoId}`;
  const listId = `${id}-list`;
  const [node, setRef] = useMergedRef<HTMLInputElement>(ref);
  const [own, setOwn] = useState<string | null>(defaultValue ?? null);
  const chosen = value !== undefined ? value : own;
  const chosenOption = options.find((o) => o.value === chosen) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useMemo(
    () =>
      remote
        ? options.map((option, index) => ({ option, index }))
        : filterOptions(options, query ?? ''),
    [options, query, remote],
  );
  const guidance = hint ?? help;
  const text = query ?? chosenOption?.label ?? '';

  function choose(option: ComboOption | null): void {
    if (value === undefined) setOwn(option?.value ?? null);
    onChange?.(option?.value ?? null, option);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }

  function openAt(rows = list): void {
    setOpen(true);
    const at = rows.findIndex((r) => r.option.value === chosen && r.option.disabled !== true);
    setActive(at >= 0 ? at : nextEnabled(rows, -1, 1));
  }

  function type(e: ChangeEvent<HTMLInputElement>): void {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    onQueryChange?.(q);
    // Remote: the rows on screen are the PREVIOUS answer until the
    // caller's fetch lands, so the highlight is computed over what is
    // actually rendered rather than over a re-filter of it.
    setActive(
      nextEnabled(
        remote ? options.map((option, index) => ({ option, index })) : filterOptions(options, q),
        -1,
        1,
      ),
    );
  }

  function key(e: KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open || e.altKey) openAt();
      else setActive((a) => nextEnabled(list, a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openAt();
      else setActive((a) => nextEnabled(list, a < 0 ? list.length : a, -1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const row = list[active];
      if (row && row.option.disabled !== true) choose(row.option);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery(null);
      } else if (query !== null) {
        e.preventDefault();
        setQuery(null);
      }
    }
  }

  function blur(e: FocusEvent<HTMLInputElement>): void {
    onBlur?.(e);
    if (query === '' && chosen !== null) choose(null);
    else {
      setQuery(null);
      setOpen(false);
    }
  }

  const activeRow = open ? list[active] : undefined;

  return (
    <FieldShell
      id={id}
      label={label}
      hint={guidance}
      notice={notice}
      error={error}
      icon={icon ?? chosenOption?.icon}
      required={required}
      disabled={disabled}
      float={placeholder !== undefined || text !== ''}
      variant="sk-combo"
      className={className}
      trail={
        <>
          <button
            type="button"
            className="sk-field__btn sk-combo__toggle"
            tabIndex={-1}
            disabled={disabled}
            aria-label="Show options"
            aria-controls={listId}
            aria-expanded={open}
            data-open={open || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) setOpen(false);
              else openAt();
              node.current?.focus();
            }}
          >
            <ChevronDown size={18} aria-hidden />
          </button>
          <OptionList
            id={listId}
            open={open}
            list={list}
            active={active}
            isSelected={(v) => v === chosen}
            onPick={(o) => choose(o)}
            emptyText={emptyText}
          />
          {name !== undefined ? <input type="hidden" name={name} value={chosen ?? ''} /> : null}
        </>
      }
    >
      <input
        ref={setRef}
        id={id}
        type="text"
        role="combobox"
        className="sk-field__input"
        autoComplete="off"
        value={text}
        onChange={type}
        onKeyDown={key}
        onBlur={blur}
        onClick={() => {
          if (!open) openAt();
        }}
        placeholder={placeholder ?? ' '}
        required={required}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeRow ? optionId(listId, activeRow.index) : undefined}
        aria-invalid={hasContent(error) ? true : ariaInvalid}
        aria-describedby={describedBy(id, {
          hint: guidance,
          notice,
          error,
          extra: describedByProp,
        })}
        {...rest}
      />
    </FieldShell>
  );
});
