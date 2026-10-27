'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ImagePlus, PackagePlus, Plus, X } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  AreaSection,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  busyPhase,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { verdict } from '@/i18n/verdict';
import {
  useCreateProduct,
  useCreateVariant,
  usePresignImage,
  useProductsList,
  useRegisterImage,
} from '@/lib/api-hooks';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

/**
 * Add a product and every variant it ships in, in one step.
 *
 * ── WHY ONE FORM AND NOT TWO ─────────────────────────────────────────
 * A product with no variant cannot be ordered, received, or picked —
 * nothing downstream can reference it. Two separate screens would let a
 * seller stop halfway and leave a catalogue entry that looks present and
 * cannot be sold.
 *
 * ── OPTIONS, NOT A TREE ──────────────────────────────────────────────
 * A shoe in Red is not a thing you can pick; a shoe in Red, size 42 is.
 * So variants are FLAT — one row per real combination, each with its own
 * SKU and its own stock — and "Red" is a value on that row rather than a
 * level above it. The seller names the axes (Colour, Size) and lists
 * their values; every combination becomes a row they can uncheck for the
 * ones they do not stock. Each row carries its values in `attributes`,
 * which is what makes "show me the Reds" answerable later. Typing the
 * combinations by hand records nothing structured, so it cannot be.
 *
 * With no options declared this collapses to exactly the old form: one
 * row, one SKU. That is the common case and it stays one field.
 *
 * ── PHYSICAL FIELDS SIT ON THE PRODUCT ───────────────────────────────
 * Weight, dimensions and declared value are asked ONCE, as
 * product defaults. Six sizes of the same shoe share all four, and the
 * backend already resolves `variant.field ?? product.defaultField` (M4
 * inheritance) — so a blank variant inherits, and a variant only stores
 * its own value when it genuinely differs. Asking per variant made the
 * form six times longer to serve the rare case.
 *
 * ── AN EXISTING PRODUCT CODE ATTACHES INSTEAD OF DUPLICATING ─────────
 * Typing a code that already belongs to a product switches this form to
 * ADDING to that product: no second product is created, and the physical
 * block fills from the one on file so a new size inherits what its
 * siblings already have. This is the same rule the CSV importer follows,
 * made visible — before it, the only way to add a colour was to find the
 * product and use its own Add-variant panel, and typing the code here
 * silently made a second product with the same name.
 *
 * ── THE N-CALL PROBLEM, STATED ───────────────────────────────────────
 * The API has no combined endpoint: this is POST product, then POST per
 * variant. Anything already created is remembered, so a retry after a
 * partial failure adds only what is missing rather than duplicating the
 * product or the rows that landed.
 */

export /** Two axes is the ceiling — see the note beside "Add an option". */
const MAX_OPTIONS = 2;

/** Matches the variant page's uploader, so the two behave the same. */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES_PER_VARIANT = 5;

export interface ProductOption {
  /** Axis name — "Colour", "Size". */
  name: string;
  /** Its values, in the order the seller typed them. */
  values: string[];
  /**
   * SECOND AXIS ONLY: its values listed per value of the FIRST axis.
   *
   * Real catalogues are ragged — Red runs 38-42, Blue 40-43, Yellow only
   * 37/40/42. A plain cartesian offers 21 rows for 12 real ones and
   * leaves nine to untick, and that gets worse with every colour added.
   * Here the seller types only what exists.
   *
   * `null` means "the same for every value of the first axis", which is
   * the common case and behaves exactly like a cartesian product. The
   * per-value lists are SEEDED from the shared one when the toggle is
   * turned off, so a ragged catalogue is edited down rather than typed
   * out again.
   */
  perParent: Record<string, string[]> | null;
}

interface FormState {
  name: string;
  externalRef: string;
  description: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  declaredValueInr: string;
}

const INITIAL: FormState = {
  name: '',
  externalRef: '',
  description: '',
  weightGrams: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  declaredValueInr: '',
};

/** A blank optional number must be OMITTED, not sent as 0 — a declared
 *  value of zero is a customs statement, not "unknown". */
function num(v: string): number | undefined {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Uppercase alphanumerics, for building a SKU suggestion. */
function slug(v: string, max: number): string {
  const s = v
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, max);
  return s;
}

/**
 * A row of the matrix: one real, orderable variant.
 *
 * `key` is derived from the option VALUES, so edits survive adding
 * another axis or another value — the rows the seller already touched
 * keep their SKU and their on/off state instead of being regenerated
 * from scratch under them.
 */
export interface VariantRow {
  key: string;
  values: Record<string, string>;
  label: string;
  suggestedSku: string;
}

const clean = (vs: readonly string[]): string[] => vs.map((v) => v.trim()).filter(Boolean);

/**
 * The second axis's values for one value of the first.
 *
 * The rule in ONE place: a shared list unless the seller turned on
 * per-value lists, in which case a parent with nothing listed has
 * nothing — and therefore produces no rows, which is the whole point of
 * a ragged catalogue.
 */
function secondaryFor(second: ProductOption, parentValue: string): string[] {
  if (second.perParent === null) return clean(second.values);
  return clean(second.perParent[parentValue] ?? []);
}

export function buildRows(name: string, options: ProductOption[]): VariantRow[] {
  const usable = options.filter(
    (o) =>
      o.name.trim() !== '' &&
      (clean(o.values).length > 0 ||
        (o.perParent !== null && Object.values(o.perParent).some((vs) => clean(vs).length > 0))),
  );

  const base = slug(name.split(/\s+/)[0] ?? '', 6) || 'SKU';
  const single = (): VariantRow[] => [{ key: '', values: {}, label: '', suggestedSku: base }];
  if (usable.length === 0) return single();

  const [first, second] = usable;
  if (first === undefined) return single();
  const firstName = first.name.trim();

  // Axis 1 x axis 2, where axis 2 may differ per axis-1 value. Axes 3+
  // are a plain cartesian on top: only the SECOND axis is per-value,
  // because "per colour, or per colour-and-size?" has no obvious answer,
  // and a rule nobody can predict is worse than one they cannot use.
  const combos: Array<Record<string, string>> = [];
  for (const v0 of clean(first.values)) {
    if (second === undefined) {
      combos.push({ [firstName]: v0 });
      continue;
    }
    const secondValues = secondaryFor(second, v0);
    if (secondValues.length === 0) continue; // this one stocks nothing
    for (const v1 of secondValues) combos.push({ [firstName]: v0, [second.name.trim()]: v1 });
  }

  if (combos.length === 0) return single();

  const axisNames = usable.map((a) => a.name.trim());
  return combos.map((values) => {
    const parts = axisNames.map((n) => values[n] ?? '').filter((part) => part !== '');
    return {
      key: parts.join(' '),
      values,
      label: parts.join(' / '),
      suggestedSku: [base, ...parts.map((part) => slug(part, 4))].filter(Boolean).join('-'),
    };
  });
}

/**
 * A row of option values as removable chips.
 *
 * Chips rather than a line of bare inputs: a value is a small discrete
 * thing, and giving each its own remove control means a mistyped colour
 * is deleted rather than blanked — a blank input still occupies the row
 * and reads as "one more value I have not filled in yet".
 */
function ValueChips({
  values,
  axisLabel,
  placeholderFor,
  onChange,
  onAdd,
  onRemove,
}: {
  readonly values: readonly string[];
  readonly axisLabel: string;
  readonly placeholderFor: (index: number) => string;
  readonly onChange: (index: number, value: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="prd-values">
      {values.map((v, vi) => (
        <span key={vi} className="prd-chip">
          <input
            value={v}
            onChange={(e) => onChange(vi, e.target.value)}
            placeholder={placeholderFor(vi)}
            aria-label={t('productNew.value', { axisLabel, vi: vi + 1 })}
            maxLength={40}
            size={Math.max(4, Math.min(14, v.length || 6))}
            className="prd-chip__input"
          />
          <button
            type="button"
            onClick={() => onRemove(vi)}
            aria-label={t('productNew.removeValue', {
              value:
                v.trim() === ''
                  ? t('productNew.axisValueN', { axis: axisLabel, n: vi + 1 })
                  : v.trim(),
            })}
            className="prd-chip__x"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <Button type="button" variant="ghost" size="sm" icon={<Plus size={13} />} onClick={onAdd}>
        {t('productNew.addValue')}
      </Button>
    </div>
  );
}

/**
 * Pick images for a variant that does not exist yet.
 *
 * Deliberately NOT the variant page's uploader: that one uploads on drop,
 * which it can, because its variant already has an id and an image is
 * stored against one. Here the files are held and sent after the save, so
 * this shows what is queued and nothing more. Thumbnails come from an
 * object URL revoked on unmount — without that, every re-pick leaks a
 * blob for as long as the tab is open.
 */
function VariantImagePicker({
  label,
  files,
  onAdd,
  onRemove,
}: {
  readonly label: string;
  readonly files: readonly File[];
  readonly onAdd: (files: FileList | null) => void;
  readonly onRemove: (index: number) => void;
}): ReactElement {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  return (
    <div className="prd-picks">
      {previews.map((url, i) => (
        <span key={url} className="prd-pick">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="prd-pick__img" />
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label={t('productNew.removeImageFor', { i: i + 1, label })}
            className="prd-pick__x"
          >
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
      {files.length < MAX_IMAGES_PER_VARIANT && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<ImagePlus size={14} />}
            onClick={() => inputRef.current?.click()}
            aria-label={t('productNew.addImagesFor', { label })}
          >
            {files.length === 0 ? t('productNew.add') : ''}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              onAdd(e.target.files);
              // Clear it, so picking the same file twice still fires.
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

export function NewProductForm(): ReactElement {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [options, setOptions] = useState<ProductOption[]>([]);
  /** Per-row SKU overrides and exclusions, keyed by the row key. */
  const [skuEdits, setSkuEdits] = useState<Record<string, string>>({});
  /**
   * Images chosen BEFORE the variants exist.
   *
   * An image is stored against a variant id — the presigned key is
   * `sellers/<seller>/variants/<variant>/…` — and on this page no variant
   * has one yet. So the files are held here in memory, keyed by row, and
   * uploaded once each variant comes back with its id. Nothing is sent to
   * storage for a product that is never created.
   */
  const [rowImages, setRowImages] = useState<Record<string, File[]>>({});
  /**
   * Declared value per row, where a variant is worth something different
   * from its siblings — a gold-plated frame beside a plastic one. Blank
   * inherits the product default above, which stays the right answer when
   * they are all worth the same.
   */
  const [rowDeclared, setRowDeclared] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createProduct = useCreateProduct();
  const createVariant = useCreateVariant();
  const presignImage = usePresignImage();
  const registerImage = useRegisterImage();

  // Look the code up as it is typed. `search` matches externalRef among
  // other columns, so the exact-match filter below is what makes this an
  // identity lookup rather than a fuzzy one.
  const codeQuery = form.externalRef.trim();
  const lookup = useProductsList(
    { search: codeQuery, page: 1, pageSize: 5 },
    { enabled: codeQuery.length >= 2 },
  );
  const matched =
    lookup.data?.items.find(
      (p) => (p.externalRef ?? '').toLowerCase() === codeQuery.toLowerCase(),
    ) ?? null;
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  /** SKUs already accepted by the server, so a retry does not re-send them. */
  const [savedSkus, setSavedSkus] = useState<Record<string, true>>({});

  // What the physical block SHOWS once a product is matched: its values,
  // so a seller adding a size sees what that size will inherit. Shown
  // rather than copied — the variant stores nothing and the product
  // stays the single place these live (M4).
  const inherited = matched;

  const rows = useMemo(() => buildRows(form.name, options), [form.name, options]);
  /** The first axis's values — what a per-value second axis is keyed on. */
  const parentValues = useMemo(
    () => (options[0] === undefined ? [] : clean(options[0].values)),
    [options],
  );
  const skuFor = (r: VariantRow): string => skuEdits[r.key] ?? r.suggestedSku;

  /**
   * Give every value of the first axis a list on the second.
   *
   * A NEW value is seeded from the first sibling that already has one, so
   * adding Yellow after typing Red 38-42 hands you 38-42 to edit down
   * rather than an empty row to retype — which is the whole benefit the
   * removed toggle used to provide, now unconditional.
   */
  useEffect(() => {
    setOptions((prev) => {
      const second = prev[1];
      if (second === undefined || second.perParent === null) return prev;
      const first = prev[0];
      const parents = first === undefined ? [] : clean(first.values);
      const missing = parents.filter((pv) => second.perParent?.[pv] === undefined);
      if (missing.length === 0) return prev;
      const template = parents
        .map((pv) => second.perParent?.[pv] ?? [])
        .find((vs) => vs.some((v) => v.trim() !== '')) ?? [''];
      const nextPerParent = { ...second.perParent };
      for (const pv of missing) nextPerParent[pv] = [...template];
      return prev.map((o, idx) => (idx === 1 ? { ...o, perParent: nextPerParent } : o));
    });
  }, [options]);

  /**
   * Upload one row's held files, now that its variant exists.
   *
   * The same three steps the variant page uses — presign, PUT straight to
   * Spaces, register — because they are the same operation and a second
   * implementation would drift. The PUT deliberately bypasses ApiClient:
   * the presigned URL points at Spaces, not our origin.
   *
   * Returns the failures rather than throwing. A picture that did not
   * upload must not undo a variant that did: the SKU is the thing orders
   * and stock hang off, and an image can be added afterwards from the
   * variant page.
   */
  async function uploadImagesFor(
    variantId: string,
    files: File[],
    label: string,
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const file of files) {
      try {
        const presigned = await presignImage.mutateAsync({
          variantId,
          body: { mimeType: file.type },
        });
        const put = await fetch(presigned.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'content-type': file.type },
        });
        if (!put.ok) throw new Error(`storage returned ${put.status}`);
        await registerImage.mutateAsync({
          variantId,
          body: {
            spacesKey: presigned.spacesKey,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        });
      } catch (err) {
        failures.push(`${label === '' ? file.name : `${label}: ${file.name}`} — ${fmtError(err)}`);
      }
    }
    return failures;
  }

  /** Accept files for one row, filtering the types the API refuses. */
  function addImages(rowKey: string, incoming: FileList | null): void {
    if (incoming === null) return;
    const ok = Array.from(incoming).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (ok.length === 0) return;
    setRowImages((p) => ({
      ...p,
      [rowKey]: [...(p[rowKey] ?? []), ...ok].slice(0, MAX_IMAGES_PER_VARIANT),
    }));
  }

  function removeImage(rowKey: string, index: number): void {
    setRowImages((p) => ({
      ...p,
      [rowKey]: (p[rowKey] ?? []).filter((_, i) => i !== index),
    }));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function validate(): string | null {
    if (matched === null && !form.name.trim()) return t('productNew.productNameIsRequired');
    if (rows.length === 0) return t('productNew.keepAtLeastOne');

    const axisNames = options.map((o) => o.name.trim().toLowerCase()).filter((n) => n !== '');
    if (new Set(axisNames).size !== axisNames.length) {
      // Two axes with one name overwrite each other in the attributes
      // map, so the rows would multiply while recording only the last
      // one — the SKUs would look right and the data would be wrong.
      return t('productNew.twoOptionsShareA');
    }

    const seen = new Set<string>();
    for (const r of rows) {
      const sku = skuFor(r).trim();
      if (sku === '') {
        return r.label
          ? t('productNew.variantNeedsSkuNamed', { label: r.label })
          : t('productNew.variantNeedsSku');
      }
      if (seen.has(sku.toLowerCase())) {
        return t('productNew.skuIsUsedTwice', { sku });
      }
      seen.add(sku.toLowerCase());
    }

    for (const r of rows) {
      const d = (rowDeclared[r.key] ?? '').trim();
      if (d !== '' && (!Number.isFinite(Number(d)) || Number(d) < 0)) {
        return r.label === ''
          ? t('productNew.declaredValueUnnamed')
          : t('productNew.declaredValueNamed', { label: r.label });
      }
    }

    for (const [label, v] of [
      [t('productNew.weight'), form.weightGrams],
      [t('productNew.length'), form.lengthCm],
      [t('productNew.width'), form.widthCm],
      [t('productNew.height'), form.heightCm],
      [t('productNew.declaredValueShort'), form.declaredValueInr],
    ] as const) {
      const value = v.trim();
      if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return t('productNew.mustBeANumber', { label });
      }
    }
    return null;
  }

  function fmtError(err: unknown): string {
    // FE-2: the server's verdict, verbatim.
    return verdict(err, t, t('productNew.somethingWentWrong'));
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const bad = validate();
    if (bad !== null) {
      setError(bad);
      return;
    }
    setError(null);
    setBusy(true);

    // An existing code ATTACHES: the product is already there, so the
    // variants below join it and nothing is created. This is what stops
    // a second product with the same name appearing.
    let productId = createdProductId ?? matched?.id ?? null;
    try {
      // Skip re-creating the product if a previous attempt got that far
      // and only a variant failed — otherwise a retry leaves a duplicate
      // product behind every time.
      if (productId === null) {
        const product = await createProduct.mutateAsync({
          name: form.name.trim(),
          ...(text(form.externalRef) ? { externalRef: text(form.externalRef)! } : {}),
          ...(text(form.description) ? { description: text(form.description)! } : {}),
          // Asked once; every variant inherits these (M4).
          ...(num(form.weightGrams) !== undefined
            ? { defaultWeightGrams: num(form.weightGrams)! }
            : {}),
          ...(num(form.lengthCm) !== undefined ? { defaultLengthCm: num(form.lengthCm)! } : {}),
          ...(num(form.widthCm) !== undefined ? { defaultWidthCm: num(form.widthCm)! } : {}),
          ...(num(form.heightCm) !== undefined ? { defaultHeightCm: num(form.heightCm)! } : {}),
          ...(num(form.declaredValueInr) !== undefined
            ? { defaultDeclaredValueInr: num(form.declaredValueInr)! }
            : {}),
        });
        productId = product.id;
        setCreatedProductId(product.id);
      }
    } catch (err) {
      setError(fmtError(err));
      setBusy(false);
      return;
    }

    const failures: string[] = [];
    const landed: Record<string, true> = { ...savedSkus };
    for (const r of rows) {
      const sku = skuFor(r).trim();
      if (landed[sku] === true) continue;
      try {
        const created = await createVariant.mutateAsync({
          productId,
          body: {
            skuCode: sku,
            ...(r.label !== '' ? { variantLabel: r.label } : {}),
            // The option values, structured — this is what makes the
            // catalogue answerable by colour or size later. Physical
            // fields are deliberately absent: blank means inherit.
            ...(Object.keys(r.values).length > 0 ? { attributes: r.values } : {}),
            // Only when this variant differs. Sending the product's own
            // number here would freeze it: changing the default later
            // would then move nothing.
            ...(num(rowDeclared[r.key] ?? '') !== undefined
              ? { declaredValueInr: num(rowDeclared[r.key] ?? '')! }
              : {}),
          },
        });
        landed[sku] = true;

        // The variant finally has an id, which is the thing an image is
        // stored against. Failures are collected, not thrown: a picture
        // that did not upload must not make a created SKU look failed and
        // get re-sent on retry.
        const held = rowImages[r.key] ?? [];
        if (held.length > 0) {
          const imageFailures = await uploadImagesFor(created.id, held, r.label);
          if (imageFailures.length === 0) {
            setRowImages((p) => ({ ...p, [r.key]: [] }));
          } else {
            failures.push(...imageFailures);
          }
        }
      } catch (err) {
        failures.push(`${sku}: ${fmtError(err)}`);
      }
    }
    setSavedSkus(landed);

    if (failures.length === 0) {
      toast.success(
        rows.length === 1
          ? t('productNew.productCreated')
          : t('productNew.productCreatedWithVariants', { rows: rows.length }),
      );
      router.push(`/products/${productId}`);
      return;
    }

    // The product EXISTS, and so do any variants that landed. Say which
    // failed — a bare error here would send the seller back to add the
    // whole thing again, and saving again would then duplicate it.
    const ok = Object.keys(landed).length;
    setError(
      t(
        ok === 0
          ? 'productNew.createdPartialNone'
          : ok === 1
            ? 'productNew.createdPartialOne'
            : 'productNew.createdPartialMany',
        { ok, count: failures.length, failures: failures.join('\n') },
      ),
    );
    setBusy(false);
  }

  function addOption(): void {
    // The SECOND axis is always per-value: a size range differs by colour
    // often enough that asking every time was a question with a
    // predictable answer, and a toggle for it was one more control to
    // understand before the form could be used. Axes 3+ stay plain.
    setOptions((p) => [...p, { name: '', values: [''], perParent: p.length === 1 ? {} : null }]);
  }

  function setParentValue(i: number, parent: string, vi: number, value: string): void {
    setOptions((p) =>
      p.map((o, idx) => {
        if (idx !== i || o.perParent === null) return o;
        const list = [...(o.perParent[parent] ?? [])];
        list[vi] = value;
        return { ...o, perParent: { ...o.perParent, [parent]: list } };
      }),
    );
  }

  function addParentValue(i: number, parent: string): void {
    setOptions((p) =>
      p.map((o, idx) => {
        if (idx !== i || o.perParent === null) return o;
        return {
          ...o,
          perParent: { ...o.perParent, [parent]: [...(o.perParent[parent] ?? []), ''] },
        };
      }),
    );
  }
  function setOptionName(i: number, name: string): void {
    setOptions((p) => p.map((o, idx) => (idx === i ? { ...o, name } : o)));
  }
  function setOptionValue(i: number, vi: number, value: string): void {
    setOptions((p) =>
      p.map((o, idx) =>
        idx === i ? { ...o, values: o.values.map((v, j) => (j === vi ? value : v)) } : o,
      ),
    );
  }
  function addOptionValue(i: number): void {
    setOptions((p) => p.map((o, idx) => (idx === i ? { ...o, values: [...o.values, ''] } : o)));
  }
  function removeOptionValue(i: number, vi: number): void {
    setOptions((p) =>
      p.map((o, idx) => {
        if (idx !== i) return o;
        // Never leave an option with no input at all — an empty list
        // gives the seller nothing to type into and no obvious way back.
        const next = o.values.filter((_, j) => j !== vi);
        return { ...o, values: next.length === 0 ? [''] : next };
      }),
    );
  }

  function removeParentValue(i: number, parent: string, vi: number): void {
    setOptions((p) =>
      p.map((o, idx) => {
        if (idx !== i || o.perParent === null) return o;
        const next = (o.perParent[parent] ?? []).filter((_, j) => j !== vi);
        return { ...o, perParent: { ...o.perParent, [parent]: next } };
      }),
    );
  }

  function removeOption(i: number): void {
    setOptions((p) => p.filter((_, idx) => idx !== i));
  }

  // The save button's words and phase, kept together so its element fits
  // on one line (the attributes above are pinned by new-product.test.tsx).
  const saveLook = {
    icon: <PackagePlus size={16} />,
    labels: {
      idle:
        createdProductId === null
          ? t('productNew.createProduct')
          : t('productNew.addTheMissingVariants'),
      busy: t('productNew.creating'),
    },
    state: busyPhase(busy),
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="inv-page prd-form">
      {error !== null && (
        <div style={{ whiteSpace: 'pre-line' }}>
          <InlineError message={error} />
        </div>
      )}

      <AreaSection title={t('productNew.product')} note={t('productNew.whatTheThingIs')}>
        <Panel>
          <FieldGrid columns={2}>
            <TextField
              label={t('productNew.productName')}
              required={matched === null}
              hint={matched === null ? undefined : t('productNew.setByTheProduct')}
              value={matched === null ? form.name : matched.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={200}
              disabled={matched !== null}
            />
            <TextField
              label={t('productNew.yourProductId')}
              hint={
                matched !== null
                  ? t('productNew.thisCodeBelongsTo', { matched: matched.name })
                  : codeQuery.length >= 2 && !lookup.isFetching
                    ? t('productNew.noProductHasThis')
                    : t('productNew.optionalYourOwnReference')
              }
              value={form.externalRef}
              onChange={(e) => set('externalRef', e.target.value)}
              maxLength={120}
              inputClassName="sk-ident"
            />
            <div className="inv-span-all">
              <TextArea
                label={t('productNew.description')}
                hint={t('productNew.optionalShownOnYour')}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </FieldGrid>
        </Panel>
      </AreaSection>

      <AreaSection
        title={t('productNew.appliesToEveryVariant')}
        note={t('productNew.askedOnceInheritedBy')}
      >
        <Panel>
          <div className="inv-stack">
            <Note>
              {inherited === null
                ? t('productNew.askedOnceAVariant')
                : t('productNew.alreadySetOnAnd', { inherited: inherited.name })}
            </Note>
            <FieldGrid columns={3}>
              <TextField
                label={t('productNew.weightG')}
                hint={t('productNew.whatTheCourierBills')}
                value={inherited === null ? form.weightGrams : (inherited.defaultWeightGrams ?? '')}
                onChange={(e) => set('weightGrams', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
              <TextField
                label={t('productNew.declaredValue')}
                hint={t('productNew.customsAndRtoWrite')}
                value={
                  inherited === null
                    ? form.declaredValueInr
                    : (inherited.defaultDeclaredValueInr ?? '')
                }
                onChange={(e) => set('declaredValueInr', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
              <TextField
                label={t('productNew.lengthCm')}
                value={inherited === null ? form.lengthCm : (inherited.defaultLengthCm ?? '')}
                onChange={(e) => set('lengthCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
              <TextField
                label={t('productNew.widthCm')}
                value={inherited === null ? form.widthCm : (inherited.defaultWidthCm ?? '')}
                onChange={(e) => set('widthCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
              <TextField
                label={t('productNew.heightCm')}
                value={inherited === null ? form.heightCm : (inherited.defaultHeightCm ?? '')}
                onChange={(e) => set('heightCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FieldGrid>
          </div>
        </Panel>
      </AreaSection>

      {/* ── STEP 1 — Options ───────────────────────────────────────── */}
      <AreaSection title={t('productNew.options')} note={t('productNew.whatItVariesBy')}>
        <Panel>
          <div className="inv-stack">
            {options.length === 0 && <Note>{t('productNew.aSingleItemNeeds')}</Note>}

            {options.map((o, i) => {
              // An option only multiplies the variants once it has a name
              // AND at least one value. Until then it is ignored, and
              // saying so is the whole point: a grey placeholder reads as
              // a filled-in field, so an empty option looks exactly like a
              // declared one and the seller is left wondering why they got
              // a single variant.
              const named = o.name.trim() !== '';
              const filled =
                o.perParent === null
                  ? o.values.some((v) => v.trim() !== '')
                  : Object.values(o.perParent).some((vs) => vs.some((v) => v.trim() !== ''));
              const incomplete = !named || !filled;
              const axisLabel = named ? o.name.trim() : t('productNew.optionN', { n: i + 1 });

              return (
                <section
                  key={i}
                  className="prd-option"
                  data-incomplete={incomplete ? '1' : undefined}
                  aria-label={axisLabel}
                >
                  <div className="prd-option__head">
                    <TextField
                      label={t('productNew.option')}
                      id={`option-${i}-name`}
                      value={o.name}
                      onChange={(e) => setOptionName(i, e.target.value)}
                      placeholder={t('productNew.eGColour')}
                      maxLength={40}
                      className="prd-option__name"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon={<X size={14} />}
                      aria-label={t('productNew.remove', { axisLabel })}
                      title={t('productNew.remove', { axisLabel })}
                      onClick={() => removeOption(i)}
                    >
                      <span className="prd-hide-sm">{t('productNew.remove2')}</span>
                    </Button>
                  </div>

                  {o.perParent === null ? (
                    <ValueChips
                      values={o.values}
                      axisLabel={axisLabel}
                      placeholderFor={(vi) =>
                        vi === 0 ? t('productNew.egRed') : t('productNew.egBlue')
                      }
                      onChange={(vi, value) => setOptionValue(i, vi, value)}
                      onAdd={() => addOptionValue(i)}
                      onRemove={(vi) => removeOptionValue(i, vi)}
                    />
                  ) : parentValues.length === 0 ? (
                    <Note>
                      {richMessage(t('productNew.fillIn'), {
                        options:
                          options[0]?.name.trim() === ''
                            ? t('productNew.theFirstOption')
                            : options[0]?.name.trim(),
                        t: t('productNew.firstTheseListsAre'),
                      })}
                    </Note>
                  ) : (
                    <div className="inv-stack inv-stack--tight">
                      {parentValues.map((pv) => {
                        const list = o.perParent?.[pv] ?? [];
                        const any = list.some((v) => v.trim() !== '');
                        return (
                          <div key={pv} className="prd-parent">
                            <span className="prd-parent__name">{pv}</span>
                            <div>
                              <ValueChips
                                values={list}
                                axisLabel={t('productNew.axisFor', { axis: axisLabel, parent: pv })}
                                placeholderFor={() => '—'}
                                onChange={(vi, value) => setParentValue(i, pv, vi, value)}
                                onAdd={() => addParentValue(i, pv)}
                                onRemove={(vi) => removeParentValue(i, pv, vi)}
                              />
                              {!any && (
                                <p className="inv-sub">
                                  {richMessage(t('productNew.nothingListedWillMake'), { pv })}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {incomplete && (
                    <p className="prd-incomplete">
                      {richMessage(t('productNew.notCountedYet'), {
                        t:
                          !named && !filled
                            ? t('productNew.typeANameAnd')
                            : !named
                              ? t('productNew.thisOptionNeedsA')
                              : t('productNew.thisOptionNeedsAt'),
                        t2: t('productNew.theGreyedOutText'),
                      })}
                    </p>
                  )}
                </section>
              );
            })}

            {options.length < MAX_OPTIONS ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  icon={<Plus size={15} />}
                  onClick={addOption}
                >
                  {t('productNew.addAnOption')}
                </Button>
              </div>
            ) : (
              <Note>{t('productNew.twoOptionsIsThe')}</Note>
            )}
          </div>
        </Panel>
      </AreaSection>

      {/* ── STEP 2 — the variants those options produce ─────────────── */}
      <AreaSection
        title={t('productNew.variants')}
        note={t('productNew.oneRowPerOrderable')}
        action={
          <span className="inv-fact sk-figure">
            {rows.length === 1
              ? t('productNew.1Variant')
              : t('productNew.variants2', { rows: rows.length })}
          </span>
        }
      >
        <div className="inv-stack">
          {options.length > 0 && rows.length === 1 && rows[0]?.label === '' && (
            <Note>{t('productNew.noOptionIsComplete')}</Note>
          )}

          <Table caption={t('productNew.variantsToCreate')}>
            <THead>
              <Tr>
                <Th>{t('productNew.variant')}</Th>
                <Th>{t('productNew.sku')}</Th>
                <Th align="right">{t('productNew.declared')}</Th>
                <Th>{t('productNew.images')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.key}>
                  <Td>
                    {r.label === '' ? (
                      <span className="inv-muted">{t('productNew.singleVariant')}</span>
                    ) : (
                      <span>{r.label}</span>
                    )}
                  </Td>
                  <Td>
                    <TextField
                      value={skuFor(r)}
                      onChange={(e) => setSkuEdits((p) => ({ ...p, [r.key]: e.target.value }))}
                      aria-label={
                        r.label === ''
                          ? t('productNew.sku')
                          : t('productNew.skuFor', { label: r.label })
                      }
                      maxLength={80}
                      className="prd-cell-field"
                      inputClassName="sk-ident"
                    />
                  </Td>
                  <Td align="right">
                    <TextField
                      value={rowDeclared[r.key] ?? ''}
                      onChange={(e) => setRowDeclared((p) => ({ ...p, [r.key]: e.target.value }))}
                      aria-label={
                        r.label === ''
                          ? t('productNew.declaredValue2')
                          : t('productNew.declaredValueFor', { label: r.label })
                      }
                      inputMode="decimal"
                      placeholder={form.declaredValueInr === '' ? '—' : form.declaredValueInr}
                      className="prd-cell-field prd-cell-field--num"
                      inputClassName="sk-figure"
                    />
                  </Td>
                  <Td>
                    <VariantImagePicker
                      label={r.label === '' ? t('productNew.thisVariant') : r.label}
                      files={rowImages[r.key] ?? []}
                      onAdd={(files) => addImages(r.key, files)}
                      onRemove={(index) => removeImage(r.key, index)}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>

          <Note>{t('productNew.skusAreSuggestedFrom')}</Note>
        </div>
      </AreaSection>

      {/*
        The save action is the point of the page, and it was rendering as
        a small bordered button identical to Cancel — Button defaults to
        variant 'secondary', size 'sm', so "Create product" looked like a
        second way to leave rather than the way to finish.

        Sticky, because the form is long: once options generate a dozen
        rows the actions sit well below the fold, and a seller who has
        filled everything in should never have to hunt for Save. Its
        bottom padding folds in the safe-area inset as a single
        declaration — a separate inline `env()` style would silently erase
        the padding utility beside it (FE-7).

        The primary is the rolling-label button, wired to the SAME submit:
        busy exactly while the N calls run.
      */}
      <div className="prd-savebar sticky bottom-0 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <AsyncButton type="submit" variant="primary" size="md" {...saveLook} />
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => router.push('/products')}
          disabled={busy}
        >
          {t('productNew.cancel')}
        </Button>
        <span className="prd-savebar__count">
          {rows.length === 1
            ? t('productNew.creates1Variant')
            : t('productNew.createsVariants', { rows: rows.length })}
        </span>
      </div>
    </form>
  );
}
