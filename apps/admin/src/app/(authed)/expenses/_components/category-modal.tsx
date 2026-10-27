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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
          setError(t('expensesCategoryModal.aNameIsNeeded'));
          return false;
        }
        await update.mutateAsync({
          categoryId: category.id,
          name: name.trim(),
          ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
        });
      } else {
        if (code.trim() === '' || name.trim() === '') {
          setError(t('expensesCategoryModal.aCodeAndAName'));
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
      toast.success(
        category
          ? t('expensesCategoryModal.categorySaved')
          : t('expensesCategoryModal.categoryAdded'),
      );
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
      title={
        editing
          ? t('expensesCategoryModal.editExpenseCategory')
          : t('expensesCategoryModal.newExpenseCategory')
      }
      description={
        editing
          ? t('expensesCategoryModal.theCodeCannotChangePast')
          : t('expensesCategoryModal.theCodeIsPermanentPast')
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('expensesCategoryModal.cancel')}
          </Button>
          <AsyncButton
            disabled={pending}
            labels={{
              idle: editing
                ? t('expensesCategoryModal.saveChanges')
                : t('expensesCategoryModal.addCategory'),
              busy: t('expensesCategoryModal.saving'),
              done: t('expensesCategoryModal.saved'),
              error: t('expensesCategoryModal.notSaved'),
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
          label={t('expensesCategoryModal.code')}
          requiredMark={!editing}
          hint={
            editing
              ? t('expensesCategoryModal.permanent')
              : t('expensesCategoryModal.upperCasedAndUnderscoredAutomatically')
          }
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('expensesCategoryModal.eGOfficeRent')}
          maxLength={60}
          readOnly={editing}
          disabled={editing}
          inputClassName="sk-ident"
        />
        <TextField
          label={t('expensesCategoryModal.name')}
          requiredMark
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('expensesCategoryModal.eGOfficeRent2')}
          maxLength={120}
          showCount
        />
        <TextArea
          label={t('expensesCategoryModal.whatGoesHere')}
          hint={t('expensesCategoryModal.forWhoeverRecordsTheNext')}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={2}
          maxLength={500}
          showCount
          placeholder={t('expensesCategoryModal.eGWarehouseAndOffice')}
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
