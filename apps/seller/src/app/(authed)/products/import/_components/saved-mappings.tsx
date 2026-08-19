'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
} from '@skydrop/ui/components';
import {
  useCreateCsvMapping,
  useCsvMappings,
  useDeleteCsvMapping,
  useUpdateCsvMapping,
  type CsvMappingView,
} from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Saved column mappings for CSV import.
 *
 * If your spreadsheet calls a column "Title" and ours expects
 * `productName`, you can save that translation once instead of renaming
 * headers before every upload. Whoever exports the file next month will
 * export it with the same headers as last month.
 *
 * The map is edited as JSON deliberately: the set of importable fields
 * is long and changes with the template, so a fixed row-per-field form
 * would go stale the first time a column is added. The example above
 * the box shows the shape, and a parse failure is caught here before it
 * can be saved.
 */
export function SavedMappings(): ReactElement {
  const list = useCsvMappings();
  const remove = useDeleteCsvMapping();
  const update = useUpdateCsvMapping();
  const [editing, setEditing] = useState<CsvMappingView | null>(null);
  const [creating, setCreating] = useState(false);

  const items = list.data ?? [];

  return (
    <Section
      title="Saved column mappings"
      subtitle="Reusable translations from your spreadsheet's headers to ours."
      action={
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          Save a mapping
        </Button>
      }
    >
      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={2} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            bare
            title="No saved mappings"
            description="Only worth it if your export headers differ from the template. If you use our template as-is, you do not need one."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th align="right">Columns</Th>
                <Th>Last used</Th>
                <Th>Default</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {items.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.name}</Td>
                  <Td align="right">{Object.keys(m.columnMap).length}</Td>
                  <Td>
                    {m.lastUsedAt === null ? (
                      <span className="text-text-faint">never</span>
                    ) : (
                      new Date(m.lastUsedAt).toLocaleDateString('en-IN')
                    )}
                  </Td>
                  <Td>
                    {m.isDefault ? (
                      <StatusBadge kind="confirmed" label="default" />
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      {!m.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: m.id, body: { isDefault: true } })}
                        >
                          Make default
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: m.id })}
                      >
                        Remove
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {(remove.error !== null || update.error !== null) && (
        <ErrorNote message={serverVerdict(remove.error ?? update.error)} />
      )}

      <MappingDialog
        mapping={editing}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </Section>
  );
}

const EXAMPLE = `{
  "productName": "Title",
  "variantSkuCode": "SKU",
  "priceInr": "MRP"
}`;

function MappingDialog({
  mapping,
  creating,
  onClose,
}: {
  mapping: CsvMappingView | null;
  creating: boolean;
  onClose: () => void;
}): ReactElement {
  const create = useCreateCsvMapping();
  const update = useUpdateCsvMapping();
  const open = mapping !== null || creating;

  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [touched, setTouched] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const effectiveName = touched || mapping === null ? name : mapping.name;
  const effectiveJson =
    touched || mapping === null ? json : JSON.stringify(mapping.columnMap, null, 2);

  function close(): void {
    setName('');
    setJson('');
    setTouched(false);
    setParseError(null);
    create.reset();
    update.reset();
    onClose();
  }

  function save(): void {
    setParseError(null);
    let columnMap: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(effectiveJson);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('The mapping must be a JSON object of ourField → yourHeader.');
        return;
      }
      columnMap = parsed as Record<string, string>;
    } catch {
      setParseError('That is not valid JSON. Check for a trailing comma or a missing quote.');
      return;
    }
    if (Object.keys(columnMap).length === 0) {
      setParseError('An empty mapping would translate nothing.');
      return;
    }
    if (mapping === null) {
      create.mutate({ name: effectiveName.trim(), columnMap }, { onSuccess: close });
    } else {
      update.mutate(
        { id: mapping.id, body: { name: effectiveName.trim(), columnMap } },
        { onSuccess: close },
      );
    }
  }

  const busy = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={mapping === null ? 'Save a column mapping' : 'Edit mapping'}
      description="Keys are our field names; values are the headers as they appear in your file."
    >
      <FormField
        label="Name"
        htmlFor="cm-name"
        hint="How you will recognise it. e.g. Shopify export"
      >
        <Input
          id="cm-name"
          value={effectiveName}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
            if (!touched && mapping !== null) setJson(JSON.stringify(mapping.columnMap, null, 2));
          }}
        />
      </FormField>

      <FormField label="Mapping" htmlFor="cm-json">
        <Textarea
          id="cm-json"
          rows={8}
          className="font-mono text-xs"
          value={effectiveJson}
          onChange={(e) => {
            setTouched(true);
            setJson(e.target.value);
            if (!touched && mapping !== null) setName(mapping.name);
          }}
          placeholder={EXAMPLE}
        />
      </FormField>

      <p className="text-text-faint text-xs">
        Download the template to see every field name we accept — anything you do not map keeps its
        template header.
      </p>

      {parseError !== null && <ErrorNote message={parseError} />}
      {serverError !== null && serverError !== undefined && (
        <ErrorNote message={serverVerdict(serverError)} />
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={effectiveName.trim() === '' || effectiveJson.trim() === '' || busy}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save mapping'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
