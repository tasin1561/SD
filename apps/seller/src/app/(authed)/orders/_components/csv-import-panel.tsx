'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileWarning,
  History,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { BulkUploadStatus } from '@skydrop/db';
import { uploadStatusKind, uploadStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useApiClient } from '@skydrop/auth/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CsvColumnGuide, type CsvColumnGuideColumn } from '@skydrop/ui/app/csv-column-guide';
import { verdict } from '@/i18n/verdict';
import { Notice, OrdSection } from './orders-parts';
import { ImportReviewDialog } from './import-review-dialog';
import {
  CompactColumnGuide,
  GuideDisclosure,
  ImportSteps,
  useGuidePanelId,
} from './import-page-parts';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Shared CSV import widget — drives:
 *   1. Download template (GET endpointBase/template)
 *   2. Upload — POST endpointBase/presign → PUT to Spaces → POST
 *      endpointBase/process
 *   3. Recent imports table — GET endpointBase, polls every 5s while
 *      any row is RUNNING / QUEUED
 *   4. Per-row "Errors CSV" link if errorReportKey is set
 *
 * Both the orders import (POST /seller/order-imports) and the
 * catalog import (POST /seller/csv-imports) follow the same shape;
 * pages set `endpointBase` accordingly.
 */
export interface CsvUploadJob {
  readonly id: string;
  readonly fileName: string;
  readonly status: string;
  readonly rowCount: number;
  readonly rowsFailed?: number;
  readonly rowsSkipped?: number;
  readonly errorReportKey?: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  /** orders import returns this; catalog returns its own variant. */
  readonly ordersCreated?: number;
  readonly productsCreated?: number;
  readonly variantsCreated?: number;
}

type Kind = 'orders' | 'catalog';

interface UploadsResponse {
  readonly items: ReadonlyArray<CsvUploadJob>;
  readonly total: number;
}

/**
 * What the server says about a file BEFORE any of it is imported.
 *
 * THE TWO IMPORTERS DO NOT RETURN THE SAME SHAPE, and this comment said
 * they did. The ORDERS preview groups rows into orders and runs the
 * importer's own row checks, so it carries `orderCount`, `ignoredHeaders`,
 * `rowsWithProblems` and `problems`. The CATALOGUE preview has no such
 * notion — one row is one product or variant — and returns none of the
 * four (`CsvImportService.preview` in apps/api/src/modules/catalog-csv-import).
 *
 * Declaring them required made the panel read `preview.ignoredHeaders.length`
 * on a value that was `undefined`, which THREW DURING RENDER and took the
 * whole "Check before importing" step down with it — on the only screen
 * that imports a catalogue. The button beneath it read "Import undefined
 * orders". Nothing caught it: the cast at the fetch is `as CsvPreview`, so
 * typecheck believed the declaration, and no test uploads a catalogue CSV.
 *
 * So the four are OPTIONAL, defaulted where they are read, and the two
 * sentences that differ are chosen by `kind` rather than pretending one
 * fits both.
 */
interface CsvPreview {
  readonly rowCount: number;
  /** ORDERS ONLY. Rows sharing a reference are LINES of one order. */
  readonly orderCount?: number;
  readonly headers: readonly string[];
  readonly sampleRows: ReadonlyArray<Record<string, string>>;
  readonly mapping: Readonly<Record<string, string | undefined>>;
  readonly missingRequired: readonly string[];
  readonly unmatchedHeaders: ReadonlyArray<{ header: string; suggestion: string | null }>;
  /** ORDERS ONLY. */
  readonly ignoredHeaders?: ReadonlyArray<{ header: string; reason: string }>;
  /** ORDERS ONLY. */
  readonly rowsWithProblems?: number;
  /** ORDERS ONLY. */
  readonly problems?: ReadonlyArray<{ rowNumber: number; field: string; reason: string }>;
  readonly exceedsRowLimit: boolean;
  readonly rowLimit: number;
}

/** "12 orders" for the order importer, "12 rows" for the catalogue one. */
function importLabel(t: Translate<MessageKey>, kind: Kind, preview: CsvPreview): string {
  const n = kind === 'orders' ? (preview.orderCount ?? preview.rowCount) : preview.rowCount;
  if (kind === 'orders')
    return t(n === 1 ? 'orderImport.importOrderOne' : 'orderImport.importOrderMany', { count: n });
  return t(n === 1 ? 'orderImport.importRowOne' : 'orderImport.importRowMany', { count: n });
}

export function CsvImportPanel({
  kind,
  endpointBase,
  templateFileName,
  detailHrefBase,
}: {
  readonly kind: Kind;
  readonly endpointBase: string;
  readonly templateFileName: string;
  readonly previewSampleSize?: number;
  /**
   * Where a row goes when clicked — the PREFIX, `<base>/<id>`.
   * Optional because only the orders importer has a per-run detail
   * screen (GET endpointBase/:id); passing nothing leaves the table
   * exactly as it was rather than linking somewhere that 404s.
   *
   * ── WHY A STRING AND NOT A FUNCTION (2026-09-20) ──────────────────
   * It was `(uploadId: string) => string`, and `/orders/import` is a
   * SERVER component, so React refused the render outright:
   * "Functions cannot be passed directly to Client Components". The
   * page returned a 500 and an error boundary — the whole bulk order
   * import was unreachable, in production, and nothing caught it
   * because a server-component boundary error is invisible to
   * typecheck, to lint and to a jsdom test. It surfaced the first time
   * the page was opened in a real browser.
   */
  readonly detailHrefBase?: string;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * The file the seller chose — by the button OR by dropping it on the
   * zone. A dropped file never reaches the input's own `files`, so the
   * upload reads this first and the input second.
   */
  const pickedFile = useRef<File | null>(null);
  /** Bumped after an upload so the drop zone starts empty again. */
  const [zoneKey, setZoneKey] = useState(0);

  const [busy, setBusy] = useState<'uploading' | 'processing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');
  /**
   * The uploaded-but-not-yet-imported file.
   *
   * The preview endpoint existed on both importers and was never called:
   * the panel went presign → PUT → process, committing the file before
   * the seller could see what we made of it. A CSV with a column we
   * cannot map does not fail loudly — it imports every row wrong, or
   * fails one row at a time into an error report read after the fact.
   */
  const [pending, setPending] = useState<{
    spacesKey: string;
    fileName: string;
    preview: CsvPreview;
  } | null>(null);
  // The check result opens in a modal; closing it leaves the inline
  // section below, which carries the same facts and the same actions.
  const [reviewOpen, setReviewOpen] = useState(false);
  const reopenRef = useRef<HTMLButtonElement | null>(null);

  // Required/optional columns come from the API (the importer's own sets),
  // never from a list in this file; see CsvColumnGuide.
  const columnGuide = useQuery<{ columns: CsvColumnGuideColumn[] }>({
    queryKey: ['seller-csv-columns', kind],
    queryFn: () =>
      client.request<{ columns: CsvColumnGuideColumn[] }>(`${endpointBase}/template/columns`),
    staleTime: 60_000,
  });

  const list = useQuery<UploadsResponse>({
    queryKey: ['seller-csv-uploads', kind],
    queryFn: () => client.request<UploadsResponse>(`${endpointBase}?page=1&pageSize=10`),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      // Both importers write `BulkUploadStatus`, whose only non-terminal
      // values are PENDING and PROCESSING. This used to also test for
      // RUNNING and QUEUED, which that enum has never had — so polling
      // stopped the moment the worker claimed the job and the table
      // sat on PROCESSING until someone reloaded the page.
      const stillRunning = items.some(
        (it) => it.status === 'PENDING' || it.status === 'PROCESSING',
      );
      return stillRunning ? 5_000 : false;
    },
  });

  /**
   * The newest run, once we have seen it running — so its progress line
   * stays on screen when it finishes and lands, rather than vanishing the
   * moment the poll reads a terminal status.
   */
  const [watching, setWatching] = useState<string | null>(null);
  const newest = list.data?.items[0];
  useEffect(() => {
    if (newest !== undefined && (newest.status === 'PENDING' || newest.status === 'PROCESSING')) {
      setWatching(newest.id);
    }
  }, [newest]);

  function fmtError(err: unknown): string {
    return verdict(err, t, t('orderImport.uploadFailed'));
  }

  /** The template download for the rolling-label button: it records the
   *  same verdict, then rethrows so the label ends on the real outcome. */
  async function downloadTemplateOrThrow(): Promise<void> {
    const ok = await downloadTemplate();
    if (!ok) throw new Error(t('orderImport.templateDownloadFailed'));
  }

  /**
   * Save what the API returned as a file. The request carried the BEARER
   * token, which is the only thing that authenticates here.
   *
   * Both downloads on this panel were a raw `fetch(..., { credentials:
   * 'include' })` with no Authorization header, so every one of them
   * 401'd — for every seller, always, on both importers, since the panel
   * is shared with the catalogue one. The access token lives in JS
   * memory and nowhere else (FE-1), so `credentials` has nothing to
   * send: the `__Host-sellerRefresh` cookie goes up and `SellerJwtGuard`
   * is bearer-only. The panel then painted a red "Template download
   * failed: 401" that stayed until the next upload cleared it.
   *
   * `@AllowCookieAuth` is deliberately NOT the fix. It exists for a
   * browser NAVIGATION — an `<a href>` or a `window.open`, which cannot
   * send a header — and its own docblock says to put it only there.
   * This is a `fetch`, so it can carry the token, and apps/reseller's
   * copy of this screen has always done exactly that.
   */
  function save(text: string, fileName: string): void {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', text.replace(/^\uFEFF/, '')], { type: 'text/csv' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** A binary download (`.xlsx`) — `request` reads text and would corrupt a zip. */
  function saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** The Excel template: the primary download on the orders importer. */
  async function downloadTemplateXlsx(): Promise<void> {
    setError(null);
    try {
      const blob = await client.requestBlob(`${endpointBase}/template/xlsx`);
      saveBlob(blob, templateFileName.replace(/\.csv$/i, '.xlsx'));
    } catch (err) {
      setError(fmtError(err));
      throw new Error(t('orderImport.templateDownloadFailed'));
    }
  }

  async function downloadErrorReportXlsx(uploadId: string): Promise<void> {
    try {
      const blob = await client.requestBlob(`${endpointBase}/${uploadId}/error-report?format=xlsx`);
      saveBlob(blob, `error-report-${uploadId}.xlsx`);
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function downloadTemplate(): Promise<boolean> {
    setError(null);
    try {
      const body = await client.request<unknown>(`${endpointBase}/template`);
      save(typeof body === 'string' ? body : JSON.stringify(body), templateFileName);
      return true;
    } catch (err) {
      setError(fmtError(err));
      return false;
    }
  }

  function onPickFiles(files: File[]): void {
    const f = files[0];
    pickedFile.current = f ?? null;
    setSelectedName(f ? f.name : '');
  }

  async function upload(): Promise<void> {
    setError(null);
    const f = pickedFile.current ?? fileRef.current?.files?.[0];
    if (!f) {
      setError(t(kind === 'orders' ? 'orderImport.pickAFile' : 'orderImport.pickACsvFile'));
      return;
    }
    // Only the ORDER importer reads a workbook; the catalogue one is CSV only.
    const isXlsx = kind === 'orders' && f.name.toLowerCase().endsWith('.xlsx');
    if (!isXlsx && !f.name.toLowerCase().endsWith('.csv')) {
      setError(
        kind === 'orders' ? t('orderImport.fileMustBeCsvOrXlsx') : t('orderImport.fileMustBeA'),
      );
      return;
    }
    setBusy('uploading');
    try {
      const presign = await client.request<{
        spacesKey: string;
        uploadUrl: string;
      }>(`${endpointBase}/presign`, {
        method: 'POST',
        body: { fileName: f.name },
      });

      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': isXlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
        },
        body: f,
      });
      if (!put.ok) {
        throw new Error(t('orderImport.putToSpacesFailed', { status: put.status }));
      }

      // Look at it BEFORE committing it. The file is in Spaces either
      // way; this only decides whether we create orders from it.
      const preview = await client.request<CsvPreview>(`${endpointBase}/preview`, {
        method: 'POST',
        body: { spacesKey: presign.spacesKey },
      });
      setPending({ spacesKey: presign.spacesKey, fileName: f.name, preview });
      setReviewOpen(true);
      if (fileRef.current) fileRef.current.value = '';
      pickedFile.current = null;
      setZoneKey((k) => k + 1);
      setSelectedName('');
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport(): Promise<void> {
    if (pending === null) return;
    setError(null);
    setBusy('processing');
    try {
      await client.request<CsvUploadJob>(`${endpointBase}/process`, {
        method: 'POST',
        body: { spacesKey: pending.spacesKey, fileName: pending.fileName },
      });
      toast.success(t('orderImport.importQueuedRefreshTo'));
      setPending(null);
      void queryClient.invalidateQueries({
        queryKey: ['seller-csv-uploads', kind],
      });
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadErrorReport(uploadId: string): Promise<void> {
    // Same shape, same 401, same fix — see `downloadTemplate` above.
    try {
      const body = await client.request<unknown>(`${endpointBase}/${uploadId}/error-report`);
      save(typeof body === 'string' ? body : JSON.stringify(body), `error-report-${uploadId}.csv`);
    } catch (err) {
      setError(fmtError(err));
    }
  }

  const items = list.data?.items ?? [];
  const latest = items[0];

  const guideNotes = {
    externalRef: t('csvcols.d.externalRef'),
    paymentMode: t('csvcols.d.paymentMode'),
    customerName: t('csvcols.d.customerName'),
    customerPhone: t('csvcols.d.customerPhone'),
    addressLine1: t('csvcols.d.addressLine1'),
    city: t('csvcols.d.city'),
    state: t('csvcols.d.state'),
    pinCode: t('csvcols.d.pinCode'),
    productSku: t('csvcols.d.productSku'),
    quantity: t('csvcols.d.quantity'),
    retailUnitPrice: t('csvcols.d.retailUnitPrice'),
    advanceAmount: t('csvcols.d.advanceAmount'),
    codAmount: t('csvcols.d.codAmount'),
    deliveryFee: t('csvcols.d.deliveryFee'),
    discountValue: t('csvcols.d.discountValue'),
    discountType: t('csvcols.d.discountType'),
    declaredValue: t('csvcols.d.declaredValue'),
    productName: t('csvcols.d.productName'),
    productExternalRef: t('csvcols.d.productExternalRef'),
    variantSkuCode: t('csvcols.d.variantSkuCode'),
    weightGrams: t('csvcols.d.weightGrams'),
    lengthCm: t('csvcols.d.lengthCm'),
    widthCm: t('csvcols.d.widthCm'),
    heightCm: t('csvcols.d.heightCm'),
    declaredValueInr: t('csvcols.d.declaredValueInr'),
    barcode: t('csvcols.d.barcode'),
    variantAttributes: t('csvcols.d.variantAttributes'),
    addressLine2: t('csvcols.landmarkNote'),
  };
  const guideLabels = {
    title: t('csvcols.title'),
    colTitle: t('csvcols.colTitle'),
    colMandatory: t('csvcols.colMandatory'),
    colDescription: t('csvcols.colDescription'),
    colSample: t('csvcols.colSample'),
    yes: t('csvcols.yes'),
    no: t('csvcols.no'),
    notUsed: t('csvcols.notUsed'),
    everyRow: t('csvcols.everyRow'),
    everyRowHint: t('csvcols.everyRowHint'),
    oncePerOrder: t('csvcols.oncePerOrder'),
    oncePerOrderHint: t('csvcols.oncePerOrderHint'),
    uat: t('csvcols.uat'),
  };

  const isOrders = kind === 'orders';
  const [guideOpen, setGuideOpen] = useState(false);
  const guidePanelId = useGuidePanelId();

  // Step indicator: read from state that already exists, nothing new.
  // A file in the zone = upload done; the preview = review; the confirmed
  // run (processing, or the watched job still running) = import.
  const importing =
    busy === 'processing' ||
    (latest !== undefined && watching === latest.id && RUNNING.has(latest.status));
  const currentStep = importing ? 4 : pending !== null ? 3 : 2;
  const doneThrough = importing ? 3 : pending !== null ? 2 : selectedName ? 2 : 1;
  const stepNames = [
    t('orderImport.stepDownload'),
    t('orderImport.stepUpload'),
    t('orderImport.stepReview'),
    t('orderImport.stepImport'),
  ];

  function clearFile(): void {
    pickedFile.current = null;
    if (fileRef.current) fileRef.current.value = '';
    setSelectedName('');
    setZoneKey((k) => k + 1);
  }
  const pickedSize = pickedFile.current?.size ?? null;
  const sizeText =
    pickedSize === null
      ? ''
      : pickedSize < 1024
        ? `${pickedSize} B`
        : pickedSize < 1024 * 1024
          ? `${(pickedSize / 1024).toFixed(0)} KB`
          : `${(pickedSize / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className={isOrders ? 'ord-stack imp-root' : 'ord-stack'}>
      {isOrders ? (
        <>
          <header className="imp-head">
            <div className="imp-head__main">
              <nav aria-label={t('orderImport.breadcrumbLabel')} className="imp-head__crumb">
                <Link href="/orders">{t('orderImport.crumbOrders')}</Link>
                <span aria-hidden>/</span>
              </nav>
              <h1 className="imp-head__title">{t('orderImport.importTitle')}</h1>
            </div>
            <div className="imp-head__actions">
              <AsyncButton
                variant="ghost"
                size="sm"
                icon={<Download size={14} />}
                labels={{
                  idle: t('orderImport.downloadTemplateCsv'),
                  busy: t('orderImport.downloading'),
                  done: t('orderImport.downloaded'),
                }}
                onAction={() => downloadTemplateOrThrow()}
              />
              <AsyncButton
                variant="primary"
                size="sm"
                icon={<Download size={14} />}
                labels={{
                  idle: t('orderImport.templateExcelShort'),
                  busy: t('orderImport.downloading'),
                  done: t('orderImport.downloaded'),
                }}
                onAction={() => downloadTemplateXlsx()}
              />
            </div>
            <p className="imp-head__sub">{t('orderImport.importOneLiner')}</p>
          </header>

          <ImportSteps
            label={t('orderImport.stepsLabel')}
            steps={stepNames}
            current={currentStep}
            doneThrough={doneThrough}
            mobileText={t('orderImport.stepMobile', {
              n: currentStep,
              label: stepNames[currentStep - 1] ?? '',
            })}
          />

          <div className="imp-grid">
            <section className="imp-card imp-upload" aria-label={t('orderImport.stepUpload')}>
              <DropZone
                key={zoneKey}
                ref={fileRef}
                className="imp-drop"
                accept=".csv,.xlsx,text/csv"
                label={
                  selectedName ? (
                    <span className="imp-file" aria-label={t('orderImport.selectedFile')}>
                      <FileSpreadsheet size={16} aria-hidden />
                      <span className="imp-file__name" title={selectedName}>
                        {selectedName}
                      </span>
                      <span className="imp-file__size sk-figure">{sizeText}</span>
                      <button
                        type="button"
                        className="imp-file__x"
                        aria-label={t('orderImport.removeFile', { name: selectedName })}
                        disabled={busy !== null}
                        onClick={clearFile}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="imp-drop__title">{t('orderImport.dropYourSheetHere')}</span>
                      <span className="imp-drop__hint">{t('orderImport.dropHint')}</span>
                    </>
                  )
                }
                buttonText={
                  selectedName ? t('orderImport.changeFile') : t('orderImport.chooseFile')
                }
                showFiles={false}
                onFiles={onPickFiles}
                disabled={busy !== null}
              />
              <div className="imp-upload__foot">
                <span className="imp-upload__note">
                  <ShieldCheck size={16} aria-hidden />
                  {t('orderImport.reviewFirst')}
                </span>
                <AsyncButton
                  variant="primary"
                  icon={<Upload size={15} />}
                  state={busy === 'uploading' ? 'busy' : undefined}
                  labels={{
                    idle: t('orderImport.uploadAndCheck'),
                    busy: t('orderImport.checking'),
                  }}
                  onClick={() => void upload()}
                  disabled={busy !== null || !selectedName}
                />
              </div>
              {error && (
                <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
                  <span>{error}</span>
                </Notice>
              )}
            </section>

            {columnGuide.data !== undefined ? (
              <CompactColumnGuide
                columns={columnGuide.data.columns}
                notes={guideNotes}
                warnFields={['addressLine2']}
                open={guideOpen}
                onToggle={() => setGuideOpen((o) => !o)}
                panelId={guidePanelId}
                labels={{
                  title: t('orderImport.guideTitle'),
                  groupEvery: t('orderImport.groupEvery'),
                  groupOnce: t('orderImport.groupOnce'),
                  groupOptional: t('orderImport.groupOptional'),
                  example: (sample) => t('orderImport.chipExample', { sample }),
                  important: t('orderImport.chipImportant'),
                  ignored: (count) =>
                    t(count === 1 ? 'orderImport.ignoredOne' : 'orderImport.ignoredMany', {
                      count,
                    }),
                  fullGuide: t('orderImport.fullGuide'),
                }}
              />
            ) : null}
          </div>

          {columnGuide.data !== undefined ? (
            <GuideDisclosure open={guideOpen} id={guidePanelId}>
              <CsvColumnGuide
                columns={columnGuide.data.columns}
                notes={guideNotes}
                labels={guideLabels}
              />
            </GuideDisclosure>
          ) : null}
        </>
      ) : null}

      {!isOrders ? (
        <OrdSection
          title={t('orderImport.upload')}
          note={
            // A row is a LINE on the orders importer since 2026-09-29
            // (ORD-9 widened) — the product importer is still one row per
            // thing, so the two say different words rather than one
            // sentence that is half true.
            t('orderImport.oneRowIsOne2')
          }
          action={
            <AsyncButton
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              labels={{
                idle: t('orderImport.downloadTemplate'),
                busy: t('orderImport.downloading'),
                done: t('orderImport.downloaded'),
              }}
              onAction={() => downloadTemplateOrThrow()}
            />
          }
        >
          <div className="ord-stack ord-stack--tight">
            <p className="ord-p">{t('orderImport.downloadTheTemplateFill')}</p>

            {columnGuide.data !== undefined ? (
              <CsvColumnGuide
                columns={columnGuide.data.columns}
                notes={guideNotes}
                labels={guideLabels}
              />
            ) : null}

            <DropZone
              key={zoneKey}
              ref={fileRef}
              accept=".csv,text/csv"
              label={selectedName || t('orderImport.dropYourCsvHere')}
              buttonText={t('orderImport.chooseCsv')}
              showFiles={false}
              onFiles={onPickFiles}
              disabled={busy !== null}
            />

            <div className="ord-row">
              <AsyncButton
                variant="primary"
                icon={<Upload size={15} />}
                state={busy === 'uploading' ? 'busy' : undefined}
                labels={{ idle: t('orderImport.uploadAndCheck'), busy: t('orderImport.checking') }}
                onClick={() => void upload()}
                disabled={busy !== null || !selectedName}
              />
            </div>

            {error && (
              <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
                <span>{error}</span>
              </Notice>
            )}
          </div>
        </OrdSection>
      ) : null}

      {/* Nothing has been imported yet. This is the step that was
          missing: the file went straight to process, so a column we
          could not map became rows that failed one at a time into an
          error report read afterwards. */}
      {/* Only while the dialog is CLOSED (owner, 2026-10-28). Rendering
          both at once put the same verdict, the same rejected rows and
          the same import button on screen twice — the second copy
          visible behind the overlay, which reads as the page having
          duplicated itself. This section is the fallback for a DISMISSED
          dialog, not its companion. */}
      {pending !== null && !reviewOpen && (
        <OrdSection
          title={t('orderImport.checkBeforeImporting')}
          note={
            <span>
              <span className="sk-ident">{pending.fileName}</span> · {pending.preview.rowCount} row
              {pending.preview.rowCount === 1 ? '' : 's'}
              {pending.preview.orderCount !== undefined &&
              pending.preview.orderCount !== pending.preview.rowCount
                ? t('orderImport.order', {
                    orderCount: pending.preview.orderCount,
                    plural: pending.preview.orderCount === 1 ? '' : 's',
                  })
                : ''}
            </span>
          }
        >
          <div className="ord-stack ord-stack--tight">
            <p className="ord-p">{t('orderImport.nothingHasBeenImported')}</p>
            <div className="ord-row">
              <Button
                ref={reopenRef}
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setReviewOpen(true)}
              >
                {t('orderImport.reviewOpen')}
              </Button>
            </div>

            {pending.preview.missingRequired.length > 0 && (
              <Notice
                tone="bad"
                icon={<FileWarning size={16} />}
                title={t('orderImport.missingColumns')}
              >
                <span>
                  {richMessage(t('orderImport.addThemToYour'), {
                    missingRequired: pending.preview.missingRequired.join(', '),
                  })}
                </span>
              </Notice>
            )}

            {pending.preview.exceedsRowLimit && (
              <Notice tone="bad" icon={<FileWarning size={16} />}>
                <span>
                  {richMessage(t('orderImport.tooManyRowsThe'), {
                    rowLimit: pending.preview.rowLimit,
                  })}
                </span>
              </Notice>
            )}

            {/* The importer's own grouping, run over the whole file.
                Column mapping was all this used to check, and a file
                from another system does not get the columns wrong — it
                leaves a cell we need empty. Delhivery's template maps
                every required column and leaves our landmark blank. */}
            {(pending.preview.rowsWithProblems ?? 0) > 0 && (
              <Notice
                tone="warn"
                icon={<FileWarning size={16} />}
                title={t('orderImport.rowWillNotImport', {
                  rowsWithProblems: pending.preview.rowsWithProblems ?? 0,
                  plural: pending.preview.rowsWithProblems === 1 ? '' : 's',
                })}
              >
                <span>
                  {(pending.preview.problems ?? [])
                    .map((p) =>
                      t('orderImport.rowProblem', { rowNumber: p.rowNumber, reason: p.reason }),
                    )
                    .join(' · ')}
                  {(pending.preview.rowsWithProblems ?? 0) > (pending.preview.problems ?? []).length
                    ? t('orderImport.andMore', {
                        problems:
                          (pending.preview.rowsWithProblems ?? 0) -
                          (pending.preview.problems ?? []).length,
                      })
                    : ''}
                  {t('orderImport.theRestWillImport')}
                </span>
              </Notice>
            )}

            {(pending.preview.ignoredHeaders ?? []).length > 0 && (
              <p className="ord-p">
                {/* A column we KNOW and do not want is a different fact
                    from one we have never seen, and saying so stops
                    somebody mapping "Pickup Location Name" onto a name
                    field because a guess sat next to it. */}
                <strong className="ord-strong">{t('orderImport.columnsWeRecogniseAnd')}</strong>{' '}
                {(pending.preview.ignoredHeaders ?? [])
                  .map((u) => `${u.header} — ${u.reason}`)
                  .join(' · ')}
              </p>
            )}

            {pending.preview.unmatchedHeaders.length > 0 && (
              <p className="ord-p">
                <strong className="ord-strong">{t('orderImport.columnsWeWillIgnore')}</strong>{' '}
                {pending.preview.unmatchedHeaders
                  .map((u) =>
                    // The suggestion is the useful half — "Phone No is
                    // ignored" is a shrug; "did you mean customerPhone"
                    // is a fix.
                    u.suggestion !== null
                      ? t('orderImport.didYouMean', { header: u.header, suggestion: u.suggestion })
                      : u.header,
                  )
                  .join(', ')}
              </p>
            )}

            <div className="ord-stack ord-stack--tight">
              <span className="ord-strong">{t('orderImport.whatWeMatched')}</span>
              <div className="ord-mapping">
                {Object.entries(pending.preview.mapping).map(([field, header]) => (
                  <span key={field}>
                    <span className="sk-ident">{field}</span> <span className="ord-faint">←</span>{' '}
                    <span className="sk-ident ord-strong">{header}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="ord-row">
              <AsyncButton
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                state={busy === 'processing' ? 'busy' : undefined}
                labels={{
                  idle: importLabel(t, kind, pending.preview),
                  busy: t('orderImport.queuing'),
                }}
                disabled={
                  busy !== null ||
                  pending.preview.missingRequired.length > 0 ||
                  pending.preview.exceedsRowLimit
                }
                onClick={() => void confirmImport()}
              />
              <Button variant="secondary" disabled={busy !== null} onClick={() => setPending(null)}>
                {t('orderImport.discard')}
              </Button>
            </div>
          </div>
        </OrdSection>
      )}

      {pending !== null && (
        <ImportReviewDialog
          open={reviewOpen}
          onOpenChange={(open) => {
            setReviewOpen(open);
            // Focus goes back to the inline "open the check result" button
            // (the trigger); the upload button is disabled by now.
            if (!open) requestAnimationFrame(() => reopenRef.current?.focus());
          }}
          t={t}
          kind={isOrders ? 'orders' : 'catalogue'}
          fileName={pending.fileName}
          rowCount={pending.preview.rowCount}
          willCreate={
            isOrders
              ? (pending.preview.orderCount ?? pending.preview.rowCount)
              : pending.preview.rowCount
          }
          rejectedCount={pending.preview.rowsWithProblems ?? 0}
          problems={pending.preview.problems ?? []}
          blocked={pending.preview.missingRequired.length > 0 || pending.preview.exceedsRowLimit}
          busy={busy !== null}
          importing={busy === 'processing'}
          importLabel={importLabel(t, kind, pending.preview)}
          onImport={() => void confirmImport()}
          blockers={
            <>
              {pending.preview.missingRequired.length > 0 && (
                <Notice
                  tone="bad"
                  icon={<FileWarning size={16} />}
                  title={t('orderImport.missingColumns')}
                >
                  <span>
                    {richMessage(t('orderImport.addThemToYour'), {
                      missingRequired: pending.preview.missingRequired.join(', '),
                    })}
                  </span>
                </Notice>
              )}
              {pending.preview.exceedsRowLimit && (
                <Notice tone="bad" icon={<FileWarning size={16} />}>
                  <span>
                    {richMessage(t('orderImport.tooManyRowsThe'), {
                      rowLimit: pending.preview.rowLimit,
                    })}
                  </span>
                </Notice>
              )}
              {error && (
                <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
                  <span>{error}</span>
                </Notice>
              )}
            </>
          }
        />
      )}

      {latest !== undefined && watching === latest.id && (
        <ImportRunProgress job={latest} kind={kind} />
      )}

      {isOrders ? (
        <section className="ord-section">
          <div className="imp-recent">
            <div className="imp-recent__head">
              <History size={16} aria-hidden />
              <h2 className="imp-recent__title">
                {list.data !== undefined && list.data.items.length > 0
                  ? t('orderImport.recentCount', { count: list.data.total })
                  : t('orderImport.recentImports')}
              </h2>
              {list.data !== undefined && list.data.items.length === 0 ? (
                <>
                  <span>{t('orderImport.noneYet')}</span>
                  <span className="imp-recent__aside">{t('orderImport.uploadsAppearHere')}</span>
                </>
              ) : null}
            </div>
            <div
              className="imp-recent__body"
              data-flush={list.data !== undefined && list.data.items.length > 0 ? '' : undefined}
            >
              {list.isLoading ? (
                <SkeletonRows rows={3} cols={4} label={t('orderImport.loadingRecentImports')} />
              ) : list.isError ? (
                <ErrorState
                  message={verdict(list.error, t, t('orderImport.failedToLoadUploads'))}
                  retry={() => void list.refetch()}
                />
              ) : !list.data || list.data.items.length === 0 ? null : (
                <Table caption={t('orderImport.recentImports')}>
                  <THead>
                    <Tr>
                      <Th>{t('orderImport.file')}</Th>
                      <Th>{t('orderImport.status')}</Th>
                      <Th align="right">{t('orderImport.rows')}</Th>
                      <Th align="right">{t('orderImport.created')}</Th>
                      <Th align="right">{t('orderImport.failed')}</Th>
                      <Th>{t('orderImport.when')}</Th>
                      <Th aria-label={t('orderImport.errorReport')} />
                    </Tr>
                  </THead>
                  <TBody>
                    {list.data.items.map((u) => {
                      const created =
                        u.ordersCreated ?? (u.productsCreated ?? 0) + (u.variantsCreated ?? 0);
                      return (
                        <Tr key={u.id}>
                          <Td>
                            {detailHrefBase === undefined ? (
                              <span className="sk-ident ord-file-name" title={u.fileName}>
                                {u.fileName}
                              </span>
                            ) : (
                              <Link
                                href={`${detailHrefBase}/${u.id}`}
                                className="ord-link sk-ident ord-file-name"
                                title={u.fileName}
                              >
                                {u.fileName}
                              </Link>
                            )}
                          </Td>
                          <Td>
                            <UploadStatusChip status={u.status} />
                          </Td>
                          <Td align="right">
                            <span className="sk-figure">{u.rowCount}</span>
                          </Td>
                          <Td align="right">
                            <span className="sk-figure">{created}</span>
                          </Td>
                          <Td align="right">
                            <span className="sk-figure">{u.rowsFailed ?? 0}</span>
                          </Td>
                          <Td>
                            <span className="sk-figure ord-nowrap ord-muted">
                              {new Date(u.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                            </span>
                          </Td>
                          <Td>
                            {u.errorReportKey && (
                              <div className="ord-row">
                                {kind === 'orders' ? (
                                  <button
                                    type="button"
                                    onClick={() => void downloadErrorReportXlsx(u.id)}
                                    className="ord-expand"
                                  >
                                    <Download size={14} aria-hidden />
                                    {t('orderImport.errorsXlsx')}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void downloadErrorReport(u.id)}
                                  className="ord-expand"
                                >
                                  <Download size={14} aria-hidden />
                                  {t('orderImport.errorsCsv')}
                                </button>
                              </div>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </div>
          </div>
        </section>
      ) : (
        <OrdSection
          title={t('orderImport.recentImports')}
          note={
            list.data === undefined
              ? undefined
              : t('orderImport.shownNewestFirst', { items: list.data.items.length })
          }
          flush={list.data !== undefined && list.data.items.length > 0}
        >
          {list.isLoading ? (
            <SkeletonRows rows={3} cols={4} label={t('orderImport.loadingRecentImports')} />
          ) : list.isError ? (
            <ErrorState
              message={verdict(list.error, t, t('orderImport.failedToLoadUploads'))}
              retry={() => void list.refetch()}
            />
          ) : !list.data || list.data.items.length === 0 ? (
            <EmptyState
              bare
              icon={<FileSpreadsheet size={20} />}
              title={t('orderImport.noImportsYet')}
              description={t('orderImport.uploadACsvAbove')}
            />
          ) : (
            <Table caption={t('orderImport.recentImports')}>
              <THead>
                <Tr>
                  <Th>{t('orderImport.file')}</Th>
                  <Th>{t('orderImport.status')}</Th>
                  <Th align="right">{t('orderImport.rows')}</Th>
                  <Th align="right">{t('orderImport.created')}</Th>
                  <Th align="right">{t('orderImport.failed')}</Th>
                  <Th>{t('orderImport.when')}</Th>
                  <Th aria-label={t('orderImport.errorReport')} />
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((u) => {
                  const created =
                    u.ordersCreated ?? (u.productsCreated ?? 0) + (u.variantsCreated ?? 0);
                  return (
                    <Tr key={u.id}>
                      <Td>
                        {detailHrefBase === undefined ? (
                          <span className="sk-ident ord-file-name" title={u.fileName}>
                            {u.fileName}
                          </span>
                        ) : (
                          <Link
                            href={`${detailHrefBase}/${u.id}`}
                            className="ord-link sk-ident ord-file-name"
                            title={u.fileName}
                          >
                            {u.fileName}
                          </Link>
                        )}
                      </Td>
                      <Td>
                        <UploadStatusChip status={u.status} />
                      </Td>
                      <Td align="right">
                        <span className="sk-figure">{u.rowCount}</span>
                      </Td>
                      <Td align="right">
                        <span className="sk-figure">{created}</span>
                      </Td>
                      <Td align="right">
                        <span className="sk-figure">{u.rowsFailed ?? 0}</span>
                      </Td>
                      <Td>
                        <span className="sk-figure ord-nowrap ord-muted">
                          {new Date(u.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                        </span>
                      </Td>
                      <Td>
                        {u.errorReportKey && (
                          <div className="ord-row">
                            <button
                              type="button"
                              onClick={() => void downloadErrorReport(u.id)}
                              className="ord-expand"
                            >
                              <Download size={14} aria-hidden />
                              {t('orderImport.errorsCsv')}
                            </button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </OrdSection>
      )}
    </div>
  );
}

const UPLOAD_STATUSES: readonly string[] = Object.values(BulkUploadStatus);
const RUNNING: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

/** The run's status as a chip, in the shared words; an unknown value prints as itself. */
function UploadStatusChip({ status }: { readonly status: string }): ReactElement {
  const locale = useLocale();
  if (!UPLOAD_STATUSES.includes(status)) {
    return <StatusChip kind="neutral" label={status} size="sm" />;
  }
  const s = status as BulkUploadStatus;
  return (
    <StatusChip
      kind={uploadStatusKind(s)}
      label={uploadStatusLabel(s, locale)}
      size="sm"
      pulse={RUNNING.has(status)}
    />
  );
}

/**
 * The run the seller is watching, as the parachute progress line.
 *
 * The fill is the REAL count of rows the worker has dealt with (made an
 * order, refused, or skipped as already sent) over the rows in the file,
 * from the same record the table polls. A catalogue import does not
 * report rows handled, so it is honest about not knowing (no value).
 */
function ImportRunProgress({
  job,
  kind,
}: {
  readonly job: CsvUploadJob;
  readonly kind: Kind;
}): ReactElement {
  const t = useT();
  const handled =
    kind === 'orders' && job.ordersCreated !== undefined
      ? job.ordersCreated + (job.rowsFailed ?? 0) + (job.rowsSkipped ?? 0)
      : null;
  const value =
    job.status === 'PENDING' || handled === null || job.rowCount === 0
      ? null
      : Math.min(100, Math.max(0, (handled / job.rowCount) * 100));
  const state: ParachuteState = RUNNING.has(job.status)
    ? 'running'
    : job.status === 'FAILED' || job.status === 'CANCELLED'
      ? 'failed'
      : 'done';
  return (
    <div className="ord-card">
      <ParachuteProgress
        label={t('orderImport.importing', { fileName: job.fileName })}
        value={state === 'running' ? value : 100}
        state={state}
        doneLabel={t('orderImport.importFinished')}
        failedLabel={t('orderImport.importStopped')}
        detail={
          handled === null
            ? t(job.rowCount === 1 ? 'orderImport.rowInFile' : 'orderImport.rowsInTheFile', {
                count: job.rowCount,
              })
            : t(job.rowCount === 1 ? 'orderImport.rowHandled' : 'orderImport.rowsHandled', {
                handled,
                count: job.rowCount,
              })
        }
      />
    </div>
  );
}
