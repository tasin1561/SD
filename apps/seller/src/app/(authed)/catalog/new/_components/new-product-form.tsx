'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  Label,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Textarea,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { useCreateProduct, useCreateVariant, useProductsList } from '@/lib/api-hooks';

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

  const [first, second, ...rest] = usable;
  if (first === undefined) return single();
  const firstName = first.name.trim();

  // Axis 1 x axis 2, where axis 2 may differ per axis-1 value. Axes 3+
  // are a plain cartesian on top: only the SECOND axis is per-value,
  // because "per colour, or per colour-and-size?" has no obvious answer,
  // and a rule nobody can predict is worse than one they cannot use.
  let combos: Array<Record<string, string>> = [];
  for (const v0 of clean(first.values)) {
    if (second === undefined) {
      combos.push({ [firstName]: v0 });
      continue;
    }
    const secondValues = secondaryFor(second, v0);
    if (secondValues.length === 0) continue; // this one stocks nothing
    for (const v1 of secondValues) combos.push({ [firstName]: v0, [second.name.trim()]: v1 });
  }

  for (const axis of rest) {
    const values = clean(axis.values);
    if (values.length === 0) continue;
    const nextCombos: Array<Record<string, string>> = [];
    for (const c of combos) {
      for (const v of values) nextCombos.push({ ...c, [axis.name.trim()]: v });
    }
    combos = nextCombos;
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((v, vi) => (
        <span
          key={vi}
          className="border-border bg-surface focus-within:ring-accent inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 focus-within:ring-2"
        >
          <input
            value={v}
            onChange={(e) => onChange(vi, e.target.value)}
            placeholder={placeholderFor(vi)}
            aria-label={`${axisLabel} value ${vi + 1}`}
            maxLength={40}
            size={Math.max(4, Math.min(14, v.length || 6))}
            className="text-text-body min-w-0 bg-transparent py-1 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => onRemove(vi)}
            aria-label={`Remove ${v.trim() === '' ? `${axisLabel} value ${vi + 1}` : v.trim()}`}
            className="text-text-muted hover:bg-surface-hover hover:text-text-bright inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
        <Plus size={12} aria-hidden />
        Add value
      </Button>
    </div>
  );
}

export function NewProductForm(): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [options, setOptions] = useState<ProductOption[]>([]);
  /** Per-row SKU overrides and exclusions, keyed by the row key. */
  const [skuEdits, setSkuEdits] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createProduct = useCreateProduct();
  const createVariant = useCreateVariant();

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
  const active = rows.filter((r) => excluded[r.key] !== true);

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

  const allIncluded = rows.length > 0 && rows.every((r) => excluded[r.key] !== true);

  /** Include or exclude every generated row at once. */
  function setAllIncluded(on: boolean): void {
    setExcluded(() => {
      if (on) return {};
      const next: Record<string, true> = {};
      for (const r of rows) next[r.key] = true;
      return next;
    });
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function validate(): string | null {
    if (matched === null && !form.name.trim()) return 'Product name is required.';
    if (active.length === 0)
      return 'Keep at least one variant — a product with none cannot be sold.';

    const axisNames = options.map((o) => o.name.trim().toLowerCase()).filter((n) => n !== '');
    if (new Set(axisNames).size !== axisNames.length) {
      // Two axes with one name overwrite each other in the attributes
      // map, so the rows would multiply while recording only the last
      // one — the SKUs would look right and the data would be wrong.
      return 'Two options share a name. Give each one its own — Colour and Size, not Colour twice.';
    }

    const seen = new Set<string>();
    for (const r of active) {
      const sku = skuFor(r).trim();
      if (sku === '') {
        return `Every variant needs a SKU${r.label ? ` — ${r.label} has none.` : '.'}`;
      }
      if (seen.has(sku.toLowerCase())) {
        return `SKU "${sku}" is used twice. Each variant needs its own — it is how stock and orders tell them apart.`;
      }
      seen.add(sku.toLowerCase());
    }

    for (const [label, v] of [
      ['Weight', form.weightGrams],
      ['Length', form.lengthCm],
      ['Width', form.widthCm],
      ['Height', form.heightCm],
      ['Declared value', form.declaredValueInr],
    ] as const) {
      const t = v.trim();
      if (t !== '' && (!Number.isFinite(Number(t)) || Number(t) < 0)) {
        return `${label} must be a number of 0 or more.`;
      }
    }
    return null;
  }

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const body = err.body as { code?: string; message?: string } | undefined;
      // FE-2: the server's verdict, verbatim.
      return body?.code ? `[${body.code}] ${body.message ?? err.message}` : err.message;
    }
    return err instanceof Error ? err.message : 'Something went wrong.';
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
    for (const r of active) {
      const sku = skuFor(r).trim();
      if (landed[sku] === true) continue;
      try {
        await createVariant.mutateAsync({
          productId,
          body: {
            skuCode: sku,
            ...(r.label !== '' ? { variantLabel: r.label } : {}),
            // The option values, structured — this is what makes the
            // catalogue answerable by colour or size later. Physical
            // fields are deliberately absent: blank means inherit.
            ...(Object.keys(r.values).length > 0 ? { attributes: r.values } : {}),
          },
        });
        landed[sku] = true;
      } catch (err) {
        failures.push(`${sku}: ${fmtError(err)}`);
      }
    }
    setSavedSkus(landed);

    if (failures.length === 0) {
      toast.success(
        active.length === 1
          ? 'Product created.'
          : `Product created with ${active.length} variants.`,
      );
      router.push(`/catalog/products/${productId}`);
      return;
    }

    // The product EXISTS, and so do any variants that landed. Say which
    // failed — a bare error here would send the seller back to add the
    // whole thing again, and saving again would then duplicate it.
    const ok = Object.keys(landed).length;
    setError(
      `The product was created${ok > 0 ? ` with ${ok} variant${ok === 1 ? '' : 's'}` : ''}, but ${failures.length} could not be added:\n${failures.join('\n')}\nFix and save again — only the missing ones are sent.`,
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

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {error !== null && (
        <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical rounded-md border px-3 py-2 text-sm whitespace-pre-line">
          {error}
        </div>
      )}

      <Card>
        <CardBody>
          <h2 className="text-text-bright mb-3 text-sm font-medium">Product</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Product name"
              required={matched === null}
              className="col-span-2 sm:col-span-1"
              hint={
                matched === null
                  ? undefined
                  : 'Set by the product this code belongs to — edit it on the product itself.'
              }
            >
              <Input
                value={matched === null ? form.name : matched.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={200}
                required={matched === null}
                disabled={matched !== null}
              />
            </FormField>
            <FormField
              label="Your product ID"
              className="col-span-2 sm:col-span-1"
              hint={
                matched !== null
                  ? `This code belongs to "${matched.name}". The variants below will be ADDED to it — no second product is created, and they inherit its weight and dimensions.`
                  : codeQuery.length >= 2 && !lookup.isFetching
                    ? 'No product has this code yet, so a new one will be created.'
                    : 'Optional. Your own reference — reuse the code of an existing product to add variants to it instead of creating another, and a CSV re-upload matches on it too.'
              }
            >
              <Input
                value={form.externalRef}
                onChange={(e) => set('externalRef', e.target.value)}
                maxLength={120}
              />
            </FormField>
            <FormField
              label="Description"
              className="col-span-2"
              hint="Optional. Shown on your invoice line."
            >
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium">Applies to every variant</h2>
          <p className="text-text-muted mt-1 mb-3 text-xs">
            {inherited === null
              ? 'Asked once. A variant that differs — a size that weighs more, say — can override its own value on the variant page.'
              : `Already set on ${inherited.name}, and shown here so you can see what these variants inherit. Change them on the product itself — editing one product from two screens is how the two come to disagree.`}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FormField label="Weight (g)" hint="What the courier bills on.">
              <Input
                value={inherited === null ? form.weightGrams : (inherited.defaultWeightGrams ?? '')}
                onChange={(e) => set('weightGrams', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FormField>
            <FormField label="Declared value (₹)" hint="Customs and RTO write-offs.">
              <Input
                value={
                  inherited === null
                    ? form.declaredValueInr
                    : (inherited.defaultDeclaredValueInr ?? '')
                }
                onChange={(e) => set('declaredValueInr', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FormField>
            <FormField label="Length (cm)">
              <Input
                value={inherited === null ? form.lengthCm : (inherited.defaultLengthCm ?? '')}
                onChange={(e) => set('lengthCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FormField>
            <FormField label="Width (cm)">
              <Input
                value={inherited === null ? form.widthCm : (inherited.defaultWidthCm ?? '')}
                onChange={(e) => set('widthCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FormField>
            <FormField label="Height (cm)">
              <Input
                value={inherited === null ? form.heightCm : (inherited.defaultHeightCm ?? '')}
                onChange={(e) => set('heightCm', e.target.value)}
                inputMode="decimal"
                disabled={inherited !== null}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {/* ── STEP 1 — Options ───────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Options"
          subtitle="What this product varies by. Names and values only — nothing here is a quantity."
        />
        <CardBody className="space-y-3">
          {options.length === 0 && (
            <p className="text-text-muted text-sm">
              A single item needs no options — it gets one SKU below. Add one for a product that
              comes in more than one colour, size or pack.
            </p>
          )}

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
            const axisLabel = named ? o.name.trim() : `Option ${i + 1}`;

            return (
              <section
                key={i}
                className="border-border bg-surface-raised/40 rounded-[6px] border"
                aria-label={axisLabel}
              >
                <header className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Label htmlFor={`option-${i}-name`} className="shrink-0">
                      Option
                    </Label>
                    <Input
                      id={`option-${i}-name`}
                      value={o.name}
                      onChange={(e) => setOptionName(i, e.target.value)}
                      placeholder="e.g. Colour"
                      maxLength={40}
                      className="w-44"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${axisLabel}`}
                    title={`Remove ${axisLabel}`}
                    onClick={() => removeOption(i)}
                  >
                    <X size={14} aria-hidden />
                    <span className="sr-only sm:not-sr-only">Remove</span>
                  </Button>
                </header>

                <div className="p-3">
                  {o.perParent === null ? (
                    <ValueChips
                      values={o.values}
                      axisLabel={axisLabel}
                      placeholderFor={(vi) => (vi === 0 ? 'e.g. Red' : 'e.g. Blue')}
                      onChange={(vi, value) => setOptionValue(i, vi, value)}
                      onAdd={() => addOptionValue(i)}
                      onRemove={(vi) => removeOptionValue(i, vi)}
                    />
                  ) : parentValues.length === 0 ? (
                    <p className="text-text-muted text-xs">
                      Fill in{' '}
                      {options[0]?.name.trim() === ''
                        ? 'the first option'
                        : options[0]?.name.trim()}{' '}
                      first — these lists are one per value of it.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {parentValues.map((pv) => {
                        const list = o.perParent?.[pv] ?? [];
                        const any = list.some((v) => v.trim() !== '');
                        return (
                          <div
                            key={pv}
                            className="grid grid-cols-[minmax(4rem,6rem)_1fr] items-start gap-x-3 gap-y-1"
                          >
                            <span className="text-text-body pt-1.5 text-xs font-medium">{pv}</span>
                            <div>
                              <ValueChips
                                values={list}
                                axisLabel={`${axisLabel} for ${pv}`}
                                placeholderFor={() => '—'}
                                onChange={(vi, value) => setParentValue(i, pv, vi, value)}
                                onAdd={() => addParentValue(i, pv)}
                                onRemove={(vi) => removeParentValue(i, pv, vi)}
                              />
                              {!any && (
                                <p className="text-text-muted mt-1 text-xs">
                                  Nothing listed — {pv} will make no variant.
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {incomplete && (
                    <p className="text-text-muted mt-3 text-xs">
                      Not counted yet —{' '}
                      {!named && !filled
                        ? 'type a name and at least one value.'
                        : !named
                          ? 'this option needs a name.'
                          : 'this option needs at least one value.'}{' '}
                      The greyed-out text is an example, not something you have entered.
                    </p>
                  )}
                </div>
              </section>
            );
          })}

          <Button type="button" variant="secondary" size="md" onClick={addOption}>
            <Plus size={14} aria-hidden />
            Add an option
          </Button>
        </CardBody>
      </Card>

      {/* ── STEP 2 — the variants those options produce ─────────────── */}
      <Card>
        <CardHeader
          title="Variants"
          subtitle="One row per orderable item. Stock and orders are counted against these, never against the product."
          action={
            <span className="border-border text-text-muted rounded-full border px-2 py-0.5 text-xs">
              {rows.length === 1 && rows[0]?.label === ''
                ? '1 variant'
                : `${active.length} of ${rows.length} kept`}
            </span>
          }
        />
        <CardBody>
          {options.length > 0 && rows.length === 1 && rows[0]?.label === '' && (
            <p className="text-text-muted mb-3 text-xs">
              No option is complete yet, so nothing is being multiplied — this is the single variant
              the product would ship as.
            </p>
          )}

          <Table>
            <THead>
              <Tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Include every variant"
                    checked={allIncluded}
                    ref={(el) => {
                      // Neither all nor none: the header box shows the
                      // in-between state rather than lying in one
                      // direction, which a plain checked/unchecked would.
                      if (el) el.indeterminate = !allIncluded && active.length > 0;
                    }}
                    onChange={(e) => setAllIncluded(e.target.checked)}
                    className="h-4 w-4 align-middle"
                    disabled={rows.length < 2}
                  />
                </Th>
                <Th>Variant</Th>
                <Th>SKU</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const on = excluded[r.key] !== true;
                return (
                  <Tr key={r.key} className={on ? undefined : 'opacity-55'}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={`Include ${r.label === '' ? 'this variant' : r.label}`}
                        onChange={() =>
                          setExcluded((p) => {
                            const next = { ...p };
                            if (on) next[r.key] = true;
                            else delete next[r.key];
                            return next;
                          })
                        }
                        className="h-4 w-4 align-middle"
                        disabled={rows.length < 2}
                      />
                    </Td>
                    <Td>
                      {r.label === '' ? (
                        <span className="text-text-muted">Single variant</span>
                      ) : (
                        <span className="text-text-body">{r.label}</span>
                      )}
                    </Td>
                    <Td>
                      <Input
                        value={skuFor(r)}
                        onChange={(e) => setSkuEdits((p) => ({ ...p, [r.key]: e.target.value }))}
                        aria-label={r.label === '' ? 'SKU' : `SKU for ${r.label}`}
                        maxLength={80}
                        className="w-full max-w-[18rem] font-mono text-xs"
                        disabled={!on}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>

          <p className="text-text-muted mt-2 text-xs">
            SKUs are suggested from the product name — edit any of them. A SKU is permanent once
            saved, because every order, pick and stock count refers to it.
          </p>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy
            ? 'Creating…'
            : createdProductId === null
              ? 'Create product'
              : 'Add the missing variants'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/catalog')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
