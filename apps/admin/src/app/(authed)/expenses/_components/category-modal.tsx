'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Tags } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  type ExpenseCategoryView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import '../../treasury/_components/money.css';

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
  const toast = useToast();

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

  /** Resolves true once saved; false when a check or the server refused. */
  async function save(): Promise<boolean> {
    setError(null);
    try {
      if (category) {
        if (name.trim() === '') {
          setError('A name is needed');
          return false;
        }
        await update.mutateAsync({
          categoryId: category.id,
          name: name.trim(),
          ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
        });
      } else {
        if (code.trim() === '' || name.trim() === '') {
          setError('A code and a name, both');
          return false;
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
      toast.success(category ? 'Category saved' : 'Category added');
      return true;
    } catch (err) {
      setError(serverVerdict(err));
      return false;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      icon={<Tags size={18} />}
      title={editing ? 'Edit expense category' : 'New expense category'}
      description={
        editing
          ? 'The code cannot change — past entries are read back through it. The name and hint can.'
          : 'The code is permanent — past entries are read back through it. The name can change.'
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            disabled={pending}
            labels={{
              idle: editing ? 'Save changes' : 'Add category',
              busy: 'Saving…',
              done: 'Saved',
              error: 'Not saved',
            }}
            onAction={async () => {
              // The busy/failed phase follows the real outcome: a refusal
              // (the form's own check or the server's) is shown as failed.
              if (!(await save())) throw new Error('not saved');
            }}
          />
        </DialogFooter>
      }
    >
      <div className="mo-fields">
        <TextField
          label="Code"
          requiredMark={!editing}
          hint={editing ? 'Permanent' : 'Upper-cased and underscored automatically'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. OFFICE_RENT"
          maxLength={60}
          readOnly={editing}
          disabled={editing}
          inputClassName="sk-ident"
        />
        <TextField
          label="Name"
          requiredMark
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Office rent"
          maxLength={120}
          showCount
        />
        <TextArea
          label="What goes here"
          hint="For whoever records the next one"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={2}
          maxLength={500}
          showCount
          placeholder="e.g. Warehouse and office rent, excluding utilities"
        />
        {error !== null && (
          <p className="mo-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
