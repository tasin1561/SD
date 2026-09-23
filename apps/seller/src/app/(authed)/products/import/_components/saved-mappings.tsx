'use client';

import { useState, type ReactElement } from 'react';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import {
  AreaSection,
  InlineError,
  Note,
  Panel,
  PanelPad,
  mutationPhase,
} from '@/app/(authed)/inventory/_components/stock-ui';
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
  // Removing a mapping ASKS first, naming it; the request is the same one.
  const [removing, setRemoving] = useState<CsvMappingView | null>(null);

  return (
    <AreaSection
      title="Saved column mappings"
      note="Your spreadsheet's headers, translated to ours."
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setCreating(true)}
        >
          Save a mapping
        </Button>
      }
    >
      <Panel flush>
        {list.isLoading ? (
          <PanelPad>
            <SkeletonRows rows={2} />
          </PanelPad>
        ) : list.isError ? (
          <PanelPad>
            <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
          </PanelPad>
        ) : items.length === 0 ? (
          <PanelPad>
            <EmptyState
              bare
              title="No saved mappings"
              description="Only worth it if your export headers differ from the template. If you use our template as-is, you do not need one."
              action={
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Plus size={15} />}
                  onClick={() => setCreating(true)}
                >
                  Save a mapping
                </Button>
              }
            />
          </PanelPad>
        ) : (
          <Table caption="Saved column mappings">
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th align="right">Columns</Th>
                <Th>Last used</Th>
                <Th>Default</Th>
                <Th align="right" aria-label="Actions" />
              </Tr>
            </THead>
            <TBody>
              {items.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <span className="inv-strong-link">{m.name}</span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{Object.keys(m.columnMap).length}</span>
                  </Td>
                  <Td>
                    {m.lastUsedAt === null ? (
                      <span className="inv-faint">never</span>
                    ) : (
                      <span className="sk-figure">
                        {new Date(m.lastUsedAt).toLocaleDateString('en-IN')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {m.isDefault ? (
                      <StatusChip kind="confirmed" label="default" size="sm" />
                    ) : (
                      <span className="inv-faint">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="inv-actions" style={{ justifyContent: 'flex-end' }}>
                      {!m.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Star size={14} />}
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: m.id, body: { isDefault: true } })}
                        >
                          Make default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={14} />}
                        onClick={() => setEditing(m)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.reset();
                          setRemoving(m);
                        }}
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
      </Panel>

      {(remove.error !== null || update.error !== null) && removing === null && (
        <InlineError message={serverVerdict(remove.error ?? update.error)} />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this mapping?"
        entity={removing === null ? '' : removing.name}
        consequence={
          removing !== null && removing.isDefault
            ? 'It is your default, so future uploads use the template headers until you pick another. Uploads already done are not touched.'
            : 'Future uploads can no longer use it. Uploads already done are not touched.'
        }
        confirmLabel="Remove mapping"
        destructive
        error={remove.error === null ? undefined : serverVerdict(remove.error)}
        onConfirm={async () => {
          if (removing === null) return;
          await remove.mutateAsync({ id: removing.id });
        }}
      />

      <MappingDialog
        mapping={editing}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </AreaSection>
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={mapping === null ? 'Save a column mapping' : 'Edit mapping'}
      description="Keys are our field names; values are the headers as they appear in your file."
      size="md"
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{ idle: 'Save mapping', busy: 'Saving…' }}
            state={busy ? 'busy' : mutationPhase(mapping === null ? create : update)}
            disabled={effectiveName.trim() === '' || effectiveJson.trim() === '' || busy}
            onClick={save}
          />
        </DialogFooter>
      }
    >
      <div className="inv-stack">
        <TextField
          label="Name"
          id="cm-name"
          hint="How you will recognise it. e.g. Shopify export"
          value={effectiveName}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
            if (!touched && mapping !== null) setJson(JSON.stringify(mapping.columnMap, null, 2));
          }}
        />

        <TextArea
          label="Mapping"
          id="cm-json"
          rows={8}
          inputClassName="sk-ident"
          value={effectiveJson}
          onChange={(e) => {
            setTouched(true);
            setJson(e.target.value);
            if (!touched && mapping !== null) setName(mapping.name);
          }}
          placeholder={EXAMPLE}
        />

        <Note>
          Download the template to see every field name we accept — anything you do not map keeps
          its template header.
        </Note>

        {parseError !== null && <InlineError message={parseError} />}
        {serverError !== null && serverError !== undefined && (
          <InlineError message={serverVerdict(serverError)} />
        )}
      </div>
    </Dialog>
  );
}
