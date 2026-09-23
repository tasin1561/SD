'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle, CircleAlert, FileText, Search, ShieldCheck, Tag } from 'lucide-react';
import { Dialog, DialogFooter, ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Accordion, AccordionItem } from '@skydrop/ui/app/accordion';
import { Switch } from '@skydrop/ui/app/switch';
import { useToast } from '@skydrop/ui/app/toast';
import { useCreateRole, useUpdateRole, type Catalogue, type RoleView } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, phaseOf } from '../../../settings/_components/settings-parts';
import './roles.css';

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
 *
 * ── SWITCHES, IN GROUPS, AND A SECOND LOOK BEFORE TAKING ONE AWAY ────
 * Each permission is a switch inside its area's accordion group (every
 * group opens while a search is typed, so a match is never hidden).
 * Saving an EXISTING role that loses permissions first asks, naming the
 * ones going: whoever holds the role loses them the moment it saves.
 * The confirm sends exactly the save the button always sent.
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
  const [busy, setBusy] = useState(false);
  const [openGroups, setOpenGroups] = useState<readonly string[]>([]);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  // Re-seed on every open, and whenever a DIFFERENT role is opened —
  // otherwise the previous role's ticks appear under this one's name.
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(role?.permissions ?? []);
    setQuery('');
    setError(null);
    setOpenGroups([]);
    setConfirmRemoval(false);
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

  // Permissions the role holds now and would not hold after saving.
  const removed =
    role === null
      ? []
      : role.permissions
          .filter((k) => !selected.includes(k))
          .map((k) => catalogue.permissions.find((p) => p.key === k)?.label ?? k);

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  const groupsShown = catalogue.groups.filter((g) => matches.some((p) => p.group === g));

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        icon={<ShieldCheck size={18} />}
        title={role === null ? 'New role' : `Edit ${role.name}`}
        size="lg"
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              labels={{
                idle: role === null ? 'Create role' : 'Save changes',
                busy: 'Saving…',
                error: 'Not saved',
              }}
              state={phaseOf(busy || pending, error)}
              disabled={pending || name.trim().length < 2}
              onClick={() => {
                if (removed.length > 0) setConfirmRemoval(true);
                else void save();
              }}
            />
          </DialogFooter>
        }
      >
        <div className="set-form-grid">
          <TextField
            label="Name"
            id="role-name"
            icon={<Tag size={15} />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warehouse manager"
          />

          <TextArea
            label="What this role is for"
            id="role-desc"
            icon={<FileText size={15} />}
            hint="Shown on the roles list. Helps whoever assigns it later."
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="role-perms">
            <TextField
              icon={<Search size={15} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search permissions — try “return”, “wallet” or a key"
              aria-label="Search permissions"
            />

            <div className="role-perms__summary">
              <span className="set-muted">
                <span className="sk-figure">
                  {selected.length} of {catalogue.permissions.length}
                </span>{' '}
                permissions
                {needle !== '' && ` · ${matches.length} match${matches.length === 1 ? '' : 'es'}`}
                {hiddenSelected > 0 && (
                  <span className="role-perms__hidden"> · {hiddenSelected} selected not shown</span>
                )}
              </span>
              {sensitiveCount > 0 && (
                <span className="role-perms__sensitive">
                  <AlertTriangle size={12} aria-hidden />
                  {sensitiveCount} can move money or stock
                </span>
              )}
            </div>

            <div className="role-perms__list">
              {matches.length === 0 && (
                <p className="set-muted role-perms__none">
                  Nothing matches “{query.trim()}”. The search covers the name, the explanation and
                  the permission key.
                </p>
              )}
              {matches.length > 0 && (
                <Accordion
                  type="multiple"
                  value={needle !== '' ? groupsShown : openGroups}
                  onValueChange={(next) => {
                    if (needle === '') setOpenGroups(next);
                  }}
                >
                  {groupsShown.map((group) => {
                    const items = matches.filter((p) => p.group === group);
                    const on = catalogue.permissions.filter(
                      (p) => p.group === group && selected.includes(p.key),
                    ).length;
                    const total = catalogue.permissions.filter((p) => p.group === group).length;
                    return (
                      <AccordionItem
                        key={group}
                        value={group}
                        title={group}
                        meta={
                          <span className="sk-figure">
                            {on} of {total} on
                          </span>
                        }
                      >
                        <ul className="set-rows">
                          {items.map((p) => (
                            <li key={p.key} className="set-row">
                              <Switch
                                checked={selected.includes(p.key)}
                                onCheckedChange={() => toggle(p.key)}
                                label={
                                  <span className="role-perm__label">
                                    {p.label}
                                    {p.sensitive && (
                                      <span className="role-perm__flag">
                                        <AlertTriangle size={11} aria-hidden />
                                        <span className="set-sr">Can move money or stock</span>
                                      </span>
                                    )}
                                  </span>
                                }
                                description={p.description}
                              />
                            </li>
                          ))}
                        </ul>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </div>
          </div>

          {error !== null && (
            <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
              <p>{error}</p>
            </SetCallout>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRemoval}
        onOpenChange={setConfirmRemoval}
        title="Remove permissions from this role?"
        entity={role?.name ?? name}
        consequence={`Everyone holding ${role?.name ?? 'this role'} (${role?.memberCount ?? 0} ${
          (role?.memberCount ?? 0) === 1 ? 'person' : 'people'
        }) loses ${removed.length === 1 ? 'this permission' : `these ${removed.length} permissions`} as soon as it saves.`}
        confirmLabel="Remove and save"
        destructive
        onConfirm={save}
      >
        <ul className="role-removed">
          {removed.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}
