'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Select } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type {
  CategoryView,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@skydrop/api-client';
import { useCreateCategory, useUpdateCategory } from '@/lib/api-hooks';

type Mode = 'create' | 'edit';

/**
 * Shared create/edit form. Slug + parent are CREATE-only (the API
 * keeps slug stable; re-parenting uses the separate /move endpoint
 * which we expose as a TODO follow-up — for now you can edit defaults
 * but not re-home a category).
 *
 * FE-2: server rejection (slug-collision, parent-not-found, etc.)
 * surfaces `[code] message` verbatim.
 */
export function CategoryFormModal(
  props:
    | {
        readonly mode: 'create';
        readonly parentId: string | null;
        readonly categories: ReadonlyArray<CategoryView>;
        readonly onClose: () => void;
        readonly onSuccess: () => void;
      }
    | {
        readonly mode: 'edit';
        readonly category: CategoryView;
        readonly categories: ReadonlyArray<CategoryView>;
        readonly onClose: () => void;
        readonly onSuccess: () => void;
      },
): ReactElement {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const mode: Mode = props.mode;

  const seed = props.mode === 'edit' ? props.category : null;
  const seedParent = props.mode === 'create' ? props.parentId : null;

  const [name, setName] = useState(seed?.name ?? '');
  const [slug, setSlug] = useState(seed?.slug ?? '');
  const [parentId, setParentId] = useState<string>(seed?.parentId ?? seedParent ?? '');
  const [sortOrder, setSortOrder] = useState(
    seed?.sortOrder !== undefined ? String(seed.sortOrder) : '0',
  );
  const [defaultPackageType, setDefaultPackageType] = useState<string>(
    seed?.defaultPackageType ?? '',
  );
  const [requiresFragile, setRequiresFragile] = useState(seed?.requiresFragile ?? false);
  const [requiresColdChain, setRequiresColdChain] = useState(seed?.requiresColdChain ?? false);
  const [defaultHsCode, setDefaultHsCode] = useState(seed?.defaultHsCode ?? '');
  const [defaultGstRate, setDefaultGstRate] = useState(seed?.defaultGstRate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          name: name.trim(),
          slug: slug.trim(),
          sortOrder: Number(sortOrder || 0),
          requiresFragile,
          requiresColdChain,
        };
        if (parentId) body.parentId = parentId;
        if (defaultPackageType) body.defaultPackageType = defaultPackageType;
        if (defaultHsCode.trim()) body.defaultHsCode = defaultHsCode.trim();
        if (defaultGstRate !== '') body.defaultGstRate = Number(defaultGstRate);
        await create.mutateAsync(body as unknown as CreateCategoryRequest);
      } else if (seed) {
        const body: Record<string, unknown> = {
          name: name.trim(),
          sortOrder: Number(sortOrder || 0),
          requiresFragile,
          requiresColdChain,
          defaultPackageType: defaultPackageType || null,
          defaultHsCode: defaultHsCode.trim() || null,
          defaultGstRate: defaultGstRate === '' ? null : Number(defaultGstRate),
        };
        await update.mutateAsync({
          id: seed.id,
          body: body as unknown as UpdateCategoryRequest,
        });
      }
      props.onSuccess();
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
      title={mode === 'create' ? 'New category' : `Edit ${seed?.name}`}
      description={
        mode === 'create'
          ? 'Slug is permanent; choose carefully. Defaults inherit to products + variants in this category.'
          : 'Slug and parent are immutable here. Re-parenting will land as a follow-up.'
      }
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FormField>

        {mode === 'create' && (
          <>
            <FormField label="Slug" required>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="lowercase-kebab"
                maxLength={140}
                required
              />
            </FormField>
            <FormField label="Parent">
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— root —</option>
                {props.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullPath}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Sort order">
            <Input
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </FormField>
          <FormField label="Default package type">
            <Select
              value={defaultPackageType}
              onChange={(e) => setDefaultPackageType(e.target.value)}
            >
              <option value="">—</option>
              <option value="STANDARD">Standard</option>
              <option value="FRAGILE">Fragile</option>
              <option value="DOCUMENT">Document</option>
            </Select>
          </FormField>
          <FormField label="Default HS code">
            <Input
              value={defaultHsCode}
              onChange={(e) => setDefaultHsCode(e.target.value)}
              maxLength={16}
              placeholder="6-10 digits"
            />
          </FormField>
          <FormField label="Default GST rate (%)">
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={defaultGstRate?.toString() ?? ''}
              onChange={(e) => setDefaultGstRate(e.target.value)}
              placeholder="18"
            />
          </FormField>
        </div>

        <div className="flex items-center gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-text-body cursor-pointer">
            <input
              type="checkbox"
              checked={requiresFragile}
              onChange={(e) => setRequiresFragile(e.target.checked)}
            />
            Requires fragile handling
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-text-body cursor-pointer">
            <input
              type="checkbox"
              checked={requiresColdChain}
              onChange={(e) => setRequiresColdChain(e.target.checked)}
            />
            Requires cold-chain
          </label>
        </div>

        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Create'
                : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
