'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Textarea } from '@skydrop/ui/components';
import { useCreateExpenseCategory } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

export function CategoryModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const create = useCreateExpenseCategory();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    if (code.trim() === '' || name.trim() === '') {
      setError('A code and a name, both');
      return;
    }
    try {
      await create.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
      });
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
      title="New expense category"
      description="The code is permanent — past entries are read back through it. The name can change."
    >
      <div className="space-y-3">
        <FormField label="Code" required hint="Upper-cased and underscored automatically">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. OFFICE_RENT"
            maxLength={60}
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
        <Button onClick={() => void save()} disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add category'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
