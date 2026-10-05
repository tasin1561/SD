'use client';

import type { ReactElement } from 'react';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import './roles.css';

export interface StoreRoleOption {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * Which roles somebody holds — several, because one person can do the
 * daily work AND the money without a bespoke sixth role being invented
 * for them.
 *
 * Checkboxes rather than a multi-select combobox: there are five of
 * them, each needs its sentence of explanation to be choosable at all,
 * and a list that is simply visible needs no typing on a phone. The
 * whole row is the label (the `Checkbox` primitive's own contract), so
 * the target is the row and not the 18px box (FE-7).
 *
 * The options are whatever `GET /store/team` offered — `store_roles` is
 * a per-store table, so a store can only ever be shown its OWN roles,
 * and this component invents none.
 *
 * It does NOT refuse an empty set, and that is deliberate (FE-2): the
 * server owns that rule — in two places, the DTO's `ArrayMinSize` and
 * the service's `NO_ROLES` — and a copy here would be a third able to
 * disagree with both.
 */
export function RolePicker({
  legend,
  options,
  value,
  onChange,
  disabled,
  lockedKeys,
  lockedNote,
}: {
  readonly legend: string;
  readonly options: readonly StoreRoleOption[];
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean | undefined;
  /** Roles this person may not grant or take away (owner, for a non-owner). */
  readonly lockedKeys?: readonly string[] | undefined;
  readonly lockedNote?: string | undefined;
}): ReactElement {
  const chosen = new Set(value);
  const locked = new Set(lockedKeys ?? []);
  const showsLocked = options.some((o) => locked.has(o.key));

  return (
    <fieldset className="rd-roles" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="rd-roles__grid">
        {options.map((o) => {
          const isLocked = locked.has(o.key);
          return (
            <Checkbox
              key={o.key}
              checked={chosen.has(o.key)}
              disabled={isLocked}
              label={o.name}
              description={o.description}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(o.key);
                else next.delete(o.key);
                // The server's own order, so the list reads the same
                // on every screen and the first role — the label the
                // rest of the API shows — is predictable.
                onChange(options.map((x) => x.key).filter((k) => next.has(k)));
              }}
            />
          );
        })}
      </div>
      {showsLocked && lockedNote !== undefined ? (
        <p className="rd-roles__note">{lockedNote}</p>
      ) : null}
    </fieldset>
  );
}

/** Every role somebody holds, read as a sentence. */
export function RoleList({ names }: { readonly names: readonly string[] }): ReactElement {
  if (names.length === 0) {
    // The server drops a soft-deleted role out of the union, so this is
    // somebody whose every role was deleted: they cannot sign in, and
    // saying so is more use than an empty cell.
    return <span className="rd-roles__none">No live role — they cannot sign in</span>;
  }
  return (
    <span className="rd-roles__held">
      {names.map((n) => (
        <span key={n} className="rd-roles__chip">
          {n}
        </span>
      ))}
    </span>
  );
}
