'use client';

import { X } from 'lucide-react';
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
import {
  OptionList,
  filterOptions,
  nextEnabled,
  optionId,
  type ComboOption,
} from '../combo-select/listbox';
import '../combo-select/combo-select.css';
import './multi-select.css';

/**
 * MultiSelect (u24). Chosen values sit as chips inside the field, before a
 * combobox input that filters the rest. Enter toggles the active option and
 * keeps the list open; Backspace in an empty input removes the last chip;
 * each chip has its own named remove button. The listbox is
 * `aria-multiselectable`, so each option reports its own selected state.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). With
 * `name`, one hidden input per value submits them with a form. `required`
 * marks the field (`aria-required`) but is not a native constraint here —
 * the typed text is not the value, so the caller validates the count.
 */
export type MultiSelectProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'role'
> &
  FieldMessages & {
    readonly options: readonly ComboOption[];
    readonly value?: readonly string[] | undefined;
    readonly defaultValue?: readonly string[] | undefined;
    readonly onChange?: ((values: string[], options: ComboOption[]) => void) | undefined;
    readonly emptyText?: ReactNode;
  };

export const MultiSelect = forwardRef<HTMLInputElement, MultiSelectProps>(function MultiSelect(
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
  const [own, setOwn] = useState<readonly string[]>(defaultValue ?? []);
  const chosen = value ?? own;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useMemo(() => filterOptions(options, query), [options, query]);
  const guidance = hint ?? help;
  const chosenOptions = chosen
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is ComboOption => o !== undefined);

  function commit(next: string[]): void {
    if (value === undefined) setOwn(next);
    onChange?.(
      next,
      next
        .map((v) => options.find((o) => o.value === v))
        .filter((o): o is ComboOption => o !== undefined),
    );
  }

  function toggle(option: ComboOption): void {
    const has = chosen.includes(option.value);
    commit(has ? chosen.filter((v) => v !== option.value) : [...chosen, option.value]);
    setQuery('');
  }

  function remove(v: string): void {
    commit(chosen.filter((x) => x !== v));
    node.current?.focus();
  }

  function openAt(): void {
    setOpen(true);
    setActive(nextEnabled(list, -1, 1));
  }

  function type(e: ChangeEvent<HTMLInputElement>): void {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    setActive(nextEnabled(filterOptions(options, q), -1, 1));
  }

  function key(e: KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openAt();
      else setActive((a) => nextEnabled(list, a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openAt();
      else setActive((a) => nextEnabled(list, a < 0 ? list.length : a, -1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const row = list[active];
      if (row && row.option.disabled !== true) toggle(row.option);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && query === '' && chosen.length > 0) {
      e.preventDefault();
      commit(chosen.slice(0, -1));
    }
  }

  function blur(e: FocusEvent<HTMLInputElement>): void {
    onBlur?.(e);
    setOpen(false);
    setQuery('');
  }

  const activeRow = open ? list[active] : undefined;
  const chips = (
    <>
      {chosenOptions.map((o) => (
        <span key={o.value} className="sk-multi__chip">
          <span className="sk-multi__chip-label">{o.label}</span>
          <button
            type="button"
            className="sk-multi__remove"
            aria-label={`Remove ${o.label}`}
            disabled={disabled}
            onClick={() => remove(o.value)}
          >
            <X size={14} aria-hidden />
          </button>
        </span>
      ))}
    </>
  );

  return (
    <FieldShell
      id={id}
      label={label}
      hint={guidance}
      notice={notice}
      error={error}
      icon={icon}
      required={required}
      disabled={disabled}
      float={placeholder !== undefined || chosen.length > 0 || query !== ''}
      variant="sk-multi"
      className={className}
      lead={chips}
      trail={
        <>
          <OptionList
            id={listId}
            open={open}
            list={list}
            active={active}
            isSelected={(v) => chosen.includes(v)}
            onPick={toggle}
            multiselectable
            emptyText={emptyText}
          />
          {name !== undefined
            ? chosen.map((v) => <input key={v} type="hidden" name={name} value={v} />)
            : null}
        </>
      }
    >
      <input
        ref={setRef}
        id={id}
        type="text"
        role="combobox"
        className="sk-field__input sk-multi__input"
        autoComplete="off"
        value={query}
        onChange={type}
        onKeyDown={key}
        onBlur={blur}
        onClick={() => {
          if (!open) openAt();
        }}
        placeholder={placeholder ?? ' '}
        disabled={disabled}
        aria-required={required}
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
