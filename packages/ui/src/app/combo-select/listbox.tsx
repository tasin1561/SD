'use client';

import { Check } from 'lucide-react';
import { useEffect, type MouseEvent, type ReactElement, type ReactNode } from 'react';

/**
 * The popup list shared by ComboSelect and MultiSelect: filtering, the
 * keyboard walk over enabled options, and the ARIA 1.2 listbox markup.
 * Focus never leaves the text input — the active option is conveyed with
 * `aria-activedescendant`, and a pointer press on an option is kept from
 * blurring the input.
 */
export interface ComboOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly icon?: ReactNode;
  readonly disabled?: boolean | undefined;
}

export interface ListedOption {
  readonly option: ComboOption;
  /** Its position in the caller's full list — the stable part of its id. */
  readonly index: number;
}

export function filterOptions(options: readonly ComboOption[], query: string): ListedOption[] {
  const q = query.trim().toLowerCase();
  const all = options.map((option, index) => ({ option, index }));
  if (q === '') return all;
  return all.filter(
    ({ option }) =>
      option.label.toLowerCase().includes(q) ||
      (option.description !== undefined && option.description.toLowerCase().includes(q)),
  );
}

/** The next enabled row from `from` in direction `dir`, or `from` if none. */
export function nextEnabled(list: readonly ListedOption[], from: number, dir: 1 | -1): number {
  if (list.length === 0) return -1;
  let i = from;
  for (let n = 0; n < list.length; n += 1) {
    i = i + dir;
    if (i < 0) i = list.length - 1;
    if (i >= list.length) i = 0;
    if (list[i]?.option.disabled !== true) return i;
  }
  return from;
}

export function optionId(listId: string, index: number): string {
  return `${listId}-o${index}`;
}

export function OptionList({
  id,
  labelId,
  open,
  list,
  active,
  isSelected,
  onPick,
  multiselectable = false,
  emptyText,
}: {
  readonly id: string;
  readonly labelId?: string | undefined;
  readonly open: boolean;
  readonly list: readonly ListedOption[];
  readonly active: number;
  readonly isSelected: (value: string) => boolean;
  readonly onPick: (option: ComboOption) => void;
  readonly multiselectable?: boolean;
  readonly emptyText: ReactNode;
}): ReactElement {
  const activeRow = list[active];
  const activeId = activeRow ? optionId(id, activeRow.index) : null;

  useEffect(() => {
    if (!open || activeId === null) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  const keep = (e: MouseEvent): void => e.preventDefault();

  return (
    <ul
      id={id}
      role="listbox"
      className="sk-lb"
      data-open={open || undefined}
      aria-labelledby={labelId}
      aria-multiselectable={multiselectable || undefined}
      onMouseDown={keep}
    >
      {list.length === 0 ? (
        <li className="sk-lb__empty" role="presentation">
          {emptyText}
        </li>
      ) : (
        list.map((row, i) => {
          const o = row.option;
          const selected = isSelected(o.value);
          return (
            <li
              key={o.value}
              id={optionId(id, row.index)}
              role="option"
              className="sk-lb__opt"
              aria-selected={selected}
              aria-disabled={o.disabled === true || undefined}
              data-active={i === active || undefined}
              onClick={() => {
                if (o.disabled !== true) onPick(o);
              }}
            >
              {o.icon !== undefined && o.icon !== null ? (
                <span className="sk-lb__icon" aria-hidden>
                  {o.icon}
                </span>
              ) : null}
              <span className="sk-lb__text">
                <span className="sk-lb__label">{o.label}</span>
                {o.description !== undefined ? (
                  <span className="sk-lb__desc">{o.description}</span>
                ) : null}
              </span>
              <span className="sk-lb__tick" aria-hidden>
                <Check size={16} />
              </span>
            </li>
          );
        })
      )}
    </ul>
  );
}
