'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle, KeyRound, Search } from 'lucide-react';
// The legacy toast on purpose: role-editor-search.test mounts this editor
// under the legacy <Toaster> only, and the shell mounts both.
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { AcAlert, phaseOf } from '../../settings/_components/ac-parts';
import { useCreateRole, useUpdateRole, type Catalogue, type RoleView } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Deciding what a role may do.
 *
 * The checkboxes are grouped by area and each carries its own sentence,
 * because the label alone does not tell you what you are agreeing to:
 * "Finalise a return" and "Hand parcels to the courier" both sound like
 * routine warehouse work, and both permanently remove stock.
 *
 * The dangerous ones are marked and counted. They are NOT enforced
 * differently — the server treats every permission identically — but a
 * role that quietly acquired six of them should say so before it is
 * saved, rather than being six unremarkable ticks in a list of sixty.
 *
 * ── SEARCH ───────────────────────────────────────────────────────────
 * Sixty-eight of them across ten groups does not fit on a screen, and
 * scrolling to find "the one about returns" is how a role ends up with
 * whatever was nearby instead. The query matches the label, the
 * explanation AND the key, because people arrive knowing any of the
 * three — someone reading a 403 in a log knows `warehouse.rto.finalize`
 * and nothing else.
 *
 * Filtering NEVER touches the selection. A permission ticked and then
 * searched out of view is still ticked and still saved, so the count
 * below says how many are hidden — otherwise "2 of 68" next to an empty
 * list reads as if something was lost.
 */
export function RoleEditor({
  role,
  catalogue,
  open,
  onClose,
}: {
  /** null = creating a new one. */
  readonly role: RoleView | null;
  readonly catalogue: Catalogue;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const create = useCreateRole();
  const update = useUpdateRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed on every open, and whenever a DIFFERENT role is opened —
  // otherwise the previous role's ticks appear under this one's name.
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(role?.permissions ?? []);
    setQuery('');
    setError(null);
  }, [open, role]);

  const pending = create.isPending || update.isPending;
  const dangerousCount = selected.filter(
    (k) => catalogue.permissions.find((p) => p.key === k)?.dangerous === true,
  ).length;

  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? catalogue.permissions
      : catalogue.permissions.filter(
          (p) =>
            p.label.toLowerCase().includes(needle) ||
            p.description.toLowerCase().includes(needle) ||
            p.key.toLowerCase().includes(needle) ||
            p.group.toLowerCase().includes(needle),
        );
  const visible = new Set(matches.map((p) => p.key));
  const hiddenSelected = selected.filter((k) => !visible.has(k)).length;

  function toggle(key: string): void {
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  async function save(): Promise<void> {
    setError(null);
    try {
      if (role === null) {
        await create.mutateAsync({ name, description, permissions: selected });
        toast.success(`${name} created`);
      } else {
        await update.mutateAsync({ id: role.id, name, description, permissions: selected });
        toast.success(`${name} updated`);
      }
      onClose();
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={role === null ? 'New role' : `Edit ${role.name}`}
      icon={<KeyRound size={18} />}
      size="lg"
      locked={pending}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            state={phaseOf(pending, error)}
            labels={{
              idle: role === null ? 'Create role' : 'Save changes',
              busy: 'Saving…',
              error: 'Not saved',
            }}
            disabled={pending || name.trim().length < 2}
            onClick={() => void save()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <TextField
          label="Name"
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Warehouse manager"
        />

        <TextArea
          label="What this role is for"
          id="role-desc"
          hint="Shown on the roles list. Helps whoever assigns it later."
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="ac-card__body">
          <TextField
            icon={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions — try “return”, “wallet” or a key"
            aria-label="Search permissions"
          />

          <div className="ac-counts">
            <span>
              <span className="sk-figure">{selected.length}</span> of{' '}
              <span className="sk-figure">{catalogue.permissions.length}</span> permissions
              {needle !== '' && ` · ${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              {hiddenSelected > 0 && (
                <span className="ac-counts__warn"> · {hiddenSelected} selected not shown</span>
              )}
            </span>
            {dangerousCount > 0 && (
              <span className="ac-counts__danger">
                <AlertTriangle size={13} aria-hidden />
                {dangerousCount} can move money or stock
              </span>
            )}
          </div>

          <div className="ac-perms">
            {matches.length === 0 && (
              <p className="ac-perms__empty">
                Nothing matches “{query.trim()}”. The search covers the name, the explanation and
                the permission key.
              </p>
            )}
            {catalogue.groups.map((group) => {
              const items = matches.filter((p) => p.group === group);
              if (items.length === 0) return null;
              return (
                <fieldset key={group} className="ac-fieldset">
                  <legend>{group}</legend>
                  {items.map((p) => (
                    <Checkbox
                      key={p.key}
                      checked={selected.includes(p.key)}
                      onChange={() => toggle(p.key)}
                      label={
                        <>
                          {p.label}
                          {p.dangerous && (
                            <span className="ac-perm-danger" title="Can move money or stock">
                              <AlertTriangle size={12} aria-hidden />
                            </span>
                          )}
                        </>
                      }
                      description={p.description}
                    />
                  ))}
                </fieldset>
              );
            })}
          </div>
        </div>

        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}
