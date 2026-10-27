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
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      title={t('productImport.savedColumnMappings')}
      note={t('productImport.yourSpreadsheetSHeaders')}
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setCreating(true)}
        >
          {t('productImport.saveAMapping')}
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
            <InlineError message={verdict(list.error, t)} retry={() => void list.refetch()} />
          </PanelPad>
        ) : items.length === 0 ? (
          <PanelPad>
            <EmptyState
              bare
              title={t('productImport.noSavedMappings')}
              description={t('productImport.onlyWorthItIf')}
              action={
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Plus size={15} />}
                  onClick={() => setCreating(true)}
                >
                  {t('productImport.saveAMapping')}
                </Button>
              }
            />
          </PanelPad>
        ) : (
          <Table caption={t('productImport.savedColumnMappings')}>
            <THead>
              <Tr>
                <Th>{t('productImport.name')}</Th>
                <Th align="right">{t('productImport.columns')}</Th>
                <Th>{t('productImport.lastUsed')}</Th>
                <Th>{t('productImport.default')}</Th>
                <Th align="right" aria-label={t('productImport.actions')} />
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
                          {t('productImport.makeDefault')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={14} />}
                        onClick={() => setEditing(m)}
                      >
                        {t('productImport.edit')}
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
                        {t('productImport.remove')}
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
        <InlineError message={verdict(remove.error ?? update.error, t)} />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t('productImport.removeThisMapping')}
        entity={removing === null ? '' : removing.name}
        consequence={
          removing !== null && removing.isDefault
            ? t('productImport.itIsYourDefault')
            : t('productImport.futureUploadsCanNo')
        }
        confirmLabel={t('productImport.removeMapping')}
        destructive
        error={remove.error === null ? undefined : verdict(remove.error, t)}
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
  const t = useT();
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
        setParseError(t('productImport.theMappingMustBe'));
        return;
      }
      columnMap = parsed as Record<string, string>;
    } catch {
      setParseError(t('productImport.thatIsNotValid'));
      return;
    }
    if (Object.keys(columnMap).length === 0) {
      setParseError(t('productImport.anEmptyMappingWould'));
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
      title={
        mapping === null ? t('productImport.saveAColumnMapping') : t('productImport.editMapping')
      }
      description={t('productImport.keysAreOurField')}
      size="md"
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {t('productImport.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{ idle: t('productImport.saveMapping'), busy: t('productImport.saving') }}
            state={busy ? 'busy' : mutationPhase(mapping === null ? create : update)}
            disabled={effectiveName.trim() === '' || effectiveJson.trim() === '' || busy}
            onClick={save}
          />
        </DialogFooter>
      }
    >
      <div className="inv-stack">
        <TextField
          label={t('productImport.name')}
          id="cm-name"
          hint={t('productImport.howYouWillRecognise')}
          value={effectiveName}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
            if (!touched && mapping !== null) setJson(JSON.stringify(mapping.columnMap, null, 2));
          }}
        />

        <TextArea
          label={t('productImport.mapping')}
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

        <Note>{t('productImport.downloadTheTemplateTo')}</Note>

        {parseError !== null && <InlineError message={parseError} />}
        {serverError !== null && serverError !== undefined && (
          <InlineError message={verdict(serverError, t)} />
        )}
      </div>
    </Dialog>
  );
}
