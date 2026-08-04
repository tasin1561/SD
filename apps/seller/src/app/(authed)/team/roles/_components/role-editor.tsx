'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
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
 * The sensitive ones are marked and counted. They are NOT enforced
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
  const sensitiveCount = selected.filter(
    (k) => catalogue.permissions.find((p) => p.key === k)?.sensitive === true,
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
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={role === null ? 'New role' : `Edit ${role.name}`}
    >
      <div className="space-y-4">
        <FormField label="Name" htmlFor="role-name">
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warehouse manager"
          />
        </FormField>

        <FormField
          label="What this role is for"
          htmlFor="role-desc"
          hint="Shown on the roles list. Helps whoever assigns it later."
        >
          <Textarea
            id="role-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        <div>
          <div className="relative mb-2">
            <Search
              size={13}
              className="text-text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search permissions — try “return”, “wallet” or a key"
              className="pl-8"
              aria-label="Search permissions"
            />
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-text-muted text-xs">
              {selected.length} of {catalogue.permissions.length} permissions
              {needle !== '' && ` · ${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              {hiddenSelected > 0 && (
                <span className="text-[var(--status-pending-fg)]">
                  {' '}
                  · {hiddenSelected} selected not shown
                </span>
              )}
            </span>
            {sensitiveCount > 0 && (
              <span className="text-critical inline-flex items-center gap-1.5 text-xs">
                <AlertTriangle size={12} />
                {sensitiveCount} can move money or stock
              </span>
            )}
          </div>

          <div className="border-border max-h-[46vh] space-y-4 overflow-y-auto rounded-xl border p-3">
            {matches.length === 0 && (
              <p className="text-text-muted py-6 text-center text-sm">
                Nothing matches “{query.trim()}”. The search covers the name, the explanation and
                the permission key.
              </p>
            )}
            {catalogue.groups.map((group) => {
              const items = matches.filter((p) => p.group === group);
              if (items.length === 0) return null;
              return (
                <fieldset key={group}>
                  <legend className="text-text-muted mb-1.5 text-xs tracking-wide uppercase">
                    {group}
                  </legend>
                  <div className="space-y-1.5">
                    {items.map((p) => (
                      <label
                        key={p.key}
                        className="hover:bg-surface-2 flex cursor-pointer gap-2.5 rounded-lg p-1.5"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={selected.includes(p.key)}
                          onChange={() => toggle(p.key)}
                        />
                        <span className="min-w-0">
                          <span className="text-text-bright flex items-center gap-1.5 text-sm">
                            {p.label}
                            {p.sensitive && <AlertTriangle size={11} className="text-critical" />}
                          </span>
                          <span className="text-text-muted block text-xs">{p.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={pending || name.trim().length < 2}
          onClick={() => void save()}
        >
          {pending ? 'Saving…' : role === null ? 'Create role' : 'Save changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
