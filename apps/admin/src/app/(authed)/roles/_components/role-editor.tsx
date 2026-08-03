'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
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
 * The dangerous ones are marked and counted. They are NOT enforced
 * differently — the server treats every permission identically — but a
 * role that quietly acquired six of them should say so before it is
 * saved, rather than being six unremarkable ticks in a list of sixty.
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
  const [error, setError] = useState<string | null>(null);

  // Re-seed on every open, and whenever a DIFFERENT role is opened —
  // otherwise the previous role's ticks appear under this one's name.
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(role?.permissions ?? []);
    setError(null);
  }, [open, role]);

  const pending = create.isPending || update.isPending;
  const dangerousCount = selected.filter(
    (k) => catalogue.permissions.find((p) => p.key === k)?.dangerous === true,
  ).length;

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
          <div className="mb-2 flex items-center justify-between">
            <span className="text-text-muted text-xs">
              {selected.length} of {catalogue.permissions.length} permissions
            </span>
            {dangerousCount > 0 && (
              <span className="text-critical inline-flex items-center gap-1.5 text-xs">
                <AlertTriangle size={12} />
                {dangerousCount} can move money or stock
              </span>
            )}
          </div>

          <div className="border-border max-h-[46vh] space-y-4 overflow-y-auto rounded-xl border p-3">
            {catalogue.groups.map((group) => {
              const items = catalogue.permissions.filter((p) => p.group === group);
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
                            {p.dangerous && <AlertTriangle size={11} className="text-critical" />}
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
