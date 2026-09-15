'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Textarea } from '@skydrop/ui/components';
import {
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  type ExpenseCategoryView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Add a category, or — given `category` — rename it / change its hint.
 *
 * The CODE is shown read-only in edit mode: the API refuses to move it
 * (past entries are read back through it), so offering the field would be
 * a control that does nothing. Retiring is a separate, confirmed act on
 * the list, not a checkbox buried in this form.
 */
export function CategoryModal({
  open,
  onOpenChange,
  category,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly category?: ExpenseCategoryView | null;
}): ReactElement {
  const create = useCreateExpenseCategory();
  const update = useUpdateExpenseCategory();
  const editing = category !== undefined && category !== null;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load the row being edited each time the modal opens on it.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (category) {
      setCode(category.code);
      setName(category.name);
      setHint(category.hint ?? '');
    }
  }, [open, category]);

  const pending = create.isPending || update.isPending;

  async function save(): Promise<void> {
    setError(null);
    try {
      if (category) {
        if (name.trim() === '') {
          setError('A name is needed');
          return;
        }
        await update.mutateAsync({
          categoryId: category.id,
          name: name.trim(),
          ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
        });
      } else {
        if (code.trim() === '' || name.trim() === '') {
          setError('A code and a name, both');
          return;
        }
        await create.mutateAsync({
          code: code.trim(),
          name: name.trim(),
          ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
        });
      }
      setCode('');
      setName('');
      setHint('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title={editing ? 'Edit expense category' : 'New expense category'}
      description={
        editing
          ? 'The code cannot change — past entries are read back through it. The name and hint can.'
          : 'The code is permanent — past entries are read back through it. The name can change.'
      }
    >
      <div className="space-y-3">
        <FormField
          label="Code"
          required={!editing}
          hint={editing ? 'Permanent' : 'Upper-cased and underscored automatically'}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. OFFICE_RENT"
            maxLength={60}
            readOnly={editing}
            disabled={editing}
          />
        </FormField>
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office rent"
            maxLength={120}
          />
        </FormField>
        <FormField label="What goes here" hint="For whoever records the next one">
          <Textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Warehouse and office rent, excluding utilities"
          />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Add category'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
