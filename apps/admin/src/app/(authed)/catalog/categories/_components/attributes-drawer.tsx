'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  useCategoryAttributes,
  useCreateAttribute,
  useDeleteAttribute,
  useEffectiveAttributes,
} from '@/lib/attribute-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const VALUE_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'ENUM'] as const;

/**
 * What variants under this category must specify.
 *
 * Two tables, and the split is the point. The first is what this
 * category DEFINES; the second is what actually applies to a variant
 * filed here, after inheriting down the tree. They differ whenever a
 * parent defines something — and an attribute you did not write can
 * still be making a seller's upload fail validation, so it has to be
 * visible from here rather than only from wherever it was declared.
 *
 * Inherited rows are read-only in this view. Editing one would edit it
 * for every sibling category too, which is a decision to make while
 * looking at the parent, not a side effect of a click here.
 */
export function AttributesDrawer({
  categoryId,
  categoryName,
  onClose,
}: {
  categoryId: string | null;
  categoryName: string;
  onClose: () => void;
}): ReactElement {
  const own = useCategoryAttributes(categoryId);
  const effective = useEffectiveAttributes(categoryId);
  const create = useCreateAttribute();
  const remove = useDeleteAttribute();
  const [adding, setAdding] = useState(false);

  const [attributeKey, setAttributeKey] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [valueType, setValueType] = useState<string>('STRING');
  const [allowedValues, setAllowedValues] = useState('');
  const [isRequired, setIsRequired] = useState(false);

  const ownKeys = new Set((own.data ?? []).map((a) => a.attributeKey));
  const inherited = (effective.data ?? []).filter((a) => !ownKeys.has(a.attributeKey));

  function resetForm(): void {
    setAttributeKey('');
    setDisplayLabel('');
    setValueType('STRING');
    setAllowedValues('');
    setIsRequired(false);
    setAdding(false);
    create.reset();
  }

  function close(): void {
    resetForm();
    remove.reset();
    onClose();
  }

  const enumNeedsValues = valueType === 'ENUM' && allowedValues.trim() === '';

  return (
    <Modal
      open={categoryId !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={`Attributes — ${categoryName}`}
      description="What a variant filed under this category has to specify."
    >
      <Section
        title="Defined here"
        subtitle="Applies to this category and everything beneath it."
        action={
          !adding ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Add attribute
            </Button>
          ) : undefined
        }
      >
        {own.isLoading ? (
          <SkeletonRows rows={3} />
        ) : own.isError ? (
          <ErrorNote message={serverVerdict(own.error)} retry={() => void own.refetch()} />
        ) : (own.data ?? []).length === 0 ? (
          <EmptyState
            bare
            title="Nothing defined here"
            description="This category adds no requirements of its own. It may still inherit some — see below."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Key</Th>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th>Allowed</Th>
                <Th>Required</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {(own.data ?? []).map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <code className="text-xs">{a.attributeKey}</code>
                  </Td>
                  <Td>{a.displayLabel}</Td>
                  <Td>{a.valueType.toLowerCase()}</Td>
                  <Td>
                    {a.allowedValues.length === 0 ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <span className="text-text-muted text-xs">{a.allowedValues.join(', ')}</span>
                    )}
                  </Td>
                  <Td>
                    {a.isRequired ? (
                      <StatusBadge kind="confirmed" label="required" />
                    ) : (
                      <span className="text-text-faint">optional</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending || categoryId === null}
                      onClick={() => {
                        if (categoryId !== null) {
                          remove.mutate({ categoryId, attributeId: a.id });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {adding && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Key"
                htmlFor="at-key"
                hint="snake_case, lowercase. Permanent — this is what variant data is keyed on."
              >
                <Input
                  id="at-key"
                  value={attributeKey}
                  onChange={(e) => setAttributeKey(e.target.value)}
                  placeholder="fabric_weight"
                />
              </FormField>
              <FormField label="Label" htmlFor="at-label" hint="What a seller sees.">
                <Input
                  id="at-label"
                  value={displayLabel}
                  onChange={(e) => setDisplayLabel(e.target.value)}
                  placeholder="Fabric weight"
                />
              </FormField>
              <FormField label="Type" htmlFor="at-type">
                <Select
                  id="at-type"
                  value={valueType}
                  onChange={(e) => setValueType(e.target.value)}
                >
                  {VALUE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toLowerCase()}
                    </option>
                  ))}
                </Select>
              </FormField>
              {valueType === 'ENUM' && (
                <FormField
                  label="Allowed values"
                  htmlFor="at-allowed"
                  hint="Comma separated. A value outside this list is rejected on upload."
                >
                  <Input
                    id="at-allowed"
                    value={allowedValues}
                    onChange={(e) => setAllowedValues(e.target.value)}
                    placeholder="light, medium, heavy"
                  />
                </FormField>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              <span>
                Required — a variant without it cannot be created
                <span className="text-text-faint">
                  {' '}
                  (this will reject existing uploads that omit it)
                </span>
              </span>
            </label>

            {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={
                  attributeKey.trim() === '' ||
                  displayLabel.trim() === '' ||
                  enumNeedsValues ||
                  create.isPending ||
                  categoryId === null
                }
                onClick={() => {
                  if (categoryId === null) return;
                  create.mutate(
                    {
                      categoryId,
                      body: {
                        attributeKey: attributeKey.trim(),
                        displayLabel: displayLabel.trim(),
                        valueType: valueType as 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ENUM',
                        isRequired,
                        ...(valueType === 'ENUM'
                          ? {
                              allowedValues: allowedValues
                                .split(',')
                                .map((v) => v.trim())
                                .filter((v) => v !== ''),
                            }
                          : {}),
                      },
                    },
                    { onSuccess: resetForm },
                  );
                }}
              >
                {create.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Inherited from parents"
        subtitle="Also applies here. Change these where they are defined — editing one from this screen would change it for every sibling category too."
      >
        {effective.isLoading ? (
          <SkeletonRows rows={2} />
        ) : inherited.length === 0 ? (
          <EmptyState
            bare
            title="Nothing inherited"
            description="No ancestor category defines an attribute this one does not already override."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Key</Th>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th>Required</Th>
              </Tr>
            </THead>
            <TBody>
              {inherited.map((a) => (
                <Tr key={a.attributeKey}>
                  <Td>
                    <code className="text-xs">{a.attributeKey}</code>
                  </Td>
                  <Td>{a.displayLabel}</Td>
                  <Td>{a.valueType.toLowerCase()}</Td>
                  <Td>
                    {a.isRequired ? (
                      <StatusBadge kind="confirmed" label="required" />
                    ) : (
                      <span className="text-text-faint">optional</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {remove.error !== null && <ErrorNote message={serverVerdict(remove.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
