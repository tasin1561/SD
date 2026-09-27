'use client';

import { useId, type ReactElement } from 'react';
import { Info } from 'lucide-react';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { TooltipCard } from '@skydrop/ui/app/tooltip-card';
import { useWarehouses } from '@/lib/api-hooks';
import { useCourierAccounts, useCouriers } from '@/lib/ops-hooks';
import {
  FREE_TEXT_SETTINGS,
  SETTING_GROUP_ORDER,
  SETTING_GUIDE,
  fallbackSettingName,
  parseList,
  settingGuide,
  type OptionSource,
  type SettingGuide,
  type SettingOption,
} from '@/lib/system-setting-guide';
import './setting-guide-ui.css';

/**
 * The words from `system-setting-guide`, drawn the same way on both
 * setting screens (global /settings and a seller's overrides): the plain
 * name with its (i), the explanation box, and ONE value editor
 * (`SettingValueEditor`) that both edit dialogs render, so the two
 * cannot drift — a number is typed into a number input, a switch is
 * On/Off, a STRING with known choices is a dropdown whose selected
 * choice says what it does with an example, a list of known codes is
 * checkboxes, and only the named free-text settings are typed.
 *
 * Words and pickers only. What a value may be is still the server's call
 * (FE-2); a value the guide does not know is shown and kept, never hidden.
 */

const MASK = '••••••••';

/**
 * The value editor both setting dialogs use. The value travels as the
 * text the dialog already keeps: 'true' / 'false' for a switch, the code
 * for a choice, JSON text for a list, the typed text otherwise.
 */
export function SettingValueEditor({
  settingKey,
  valueType,
  value,
  onChange,
  disabled,
  placeholder,
  keepValues,
  masked = false,
  numberHint,
}: {
  readonly settingKey: string;
  readonly valueType: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean | undefined;
  /** A "Choose…" entry for a dropdown that starts empty. */
  readonly placeholder?: string | undefined;
  /** Values the dropdown must keep offering (what is set now). */
  readonly keepValues?: readonly string[] | undefined;
  /** A sensitive value not revealed: shown as dots and not editable. */
  readonly masked?: boolean | undefined;
  /** Replaces the hint under a number input. */
  readonly numberHint?: string | undefined;
}): ReactElement {
  if (masked) {
    return valueType === 'JSON' ? (
      <TextArea label="Value (JSON)" rows={4} value={MASK} disabled readOnly />
    ) : (
      <TextField label="Value" value={MASK} disabled readOnly />
    );
  }
  if (hasChoiceList(settingKey, valueType)) {
    return (
      <SettingChoiceField
        settingKey={settingKey}
        valueType={valueType}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        keepValues={keepValues}
      />
    );
  }
  const list = hasMultiChoice(settingKey, valueType) ? parseList(value) : null;
  if (list !== null) {
    return (
      <SettingMultiField
        settingKey={settingKey}
        value={list.map(String)}
        onChange={(next) => onChange(JSON.stringify(next, null, 2))}
        disabled={disabled}
      />
    );
  }
  switch (valueType) {
    case 'JSON':
      return (
        <TextArea
          label="Value (JSON)"
          hint="Must parse as a JSON object or array."
          rows={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'INT':
    case 'DECIMAL':
      return (
        <TextField
          label="Value"
          hint={numberHint ?? (valueType === 'INT' ? 'A whole number' : 'A number, e.g. 18.00')}
          type="number"
          inputMode={valueType === 'INT' ? 'numeric' : 'decimal'}
          step={valueType === 'INT' ? 1 : 'any'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'DATE':
      return (
        <TextField
          label="Value"
          hint="ISO-8601 (YYYY-MM-DDTHH:mm:ss)"
          type="datetime-local"
          floatLabel
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    default:
      return (
        <TextField
          label="Value"
          hint={FREE_TEXT_SETTINGS[settingKey] ?? 'Plain text'}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }
}

/** The setting's plain name, an (i) with what + example, and the key beneath. */
export function SettingName({
  settingKey,
  showGroup = false,
}: {
  readonly settingKey: string;
  readonly showGroup?: boolean | undefined;
}): ReactElement {
  const guide = settingGuide(settingKey);
  const name = guide?.name ?? fallbackSettingName(settingKey);
  return (
    <div className="sss-name">
      <div className="sss-name__line">
        <span className="ac-cell-main">{name}</span>
        {guide !== null && (
          <TooltipCard
            layer="fixed"
            title={guide.name}
            description={
              <>
                <span className="sss-tip__what">{guide.what}</span>
                <span className="sss-tip__example">
                  <strong>Example:</strong> {guide.example}
                </span>
              </>
            }
          >
            <button type="button" className="sss-info" aria-label={`What "${name}" means`}>
              <Info size={14} aria-hidden />
            </button>
          </TooltipCard>
        )}
      </div>
      <span className="sss-name__meta">
        {showGroup && guide !== null && <span>{guide.group} · </span>}
        <code className="sk-ident">{settingKey}</code>
      </span>
    </div>
  );
}

/** What the setting decides, with its example — the top of an edit dialog. */
export function SettingExplanation({ guide }: { readonly guide: SettingGuide }): ReactElement {
  return (
    <div className="sss-explain">
      <p className="ac-text">{guide.what}</p>
      <p className="ac-muted">
        <strong>Example:</strong> {guide.example}
      </p>
    </div>
  );
}

/** Keys in the guide's group order, then the guide's own order, then by key. */
const GUIDE_ORDER = new Map(Object.keys(SETTING_GUIDE).map((key, i) => [key, i]));

export function guideRank(key: string): readonly [number, number] {
  const guide = settingGuide(key);
  const group =
    guide === null ? SETTING_GROUP_ORDER.length : SETTING_GROUP_ORDER.indexOf(guide.group);
  return [group, GUIDE_ORDER.get(key) ?? GUIDE_ORDER.size];
}

export function compareByGuide(a: string, b: string): number {
  const [ga, wa] = guideRank(a);
  const [gb, wb] = guideRank(b);
  return ga - gb || wa - wb || a.localeCompare(b);
}

/**
 * Whether a setting is edited by picking from a list: every switch, and
 * every STRING the guide lists choices for (in the file or from the live
 * system). Anything else is typed.
 */
export function hasChoiceList(settingKey: string, valueType: string): boolean {
  if (valueType === 'BOOLEAN') return true;
  if (valueType !== 'STRING') return false;
  const guide = settingGuide(settingKey);
  return guide?.values !== undefined || guide?.source !== undefined;
}

/** Whether a JSON setting is a list of known codes, edited as checkboxes. */
export function hasMultiChoice(settingKey: string, valueType: string): boolean {
  return valueType === 'JSON' && settingGuide(settingKey)?.multi !== undefined;
}

const SWITCH_FALLBACK: Readonly<Record<string, SettingOption>> = {
  true: { label: 'On', does: 'Turns this on.', example: 'The behaviour described above happens.' },
  false: {
    label: 'Off',
    does: 'Turns this off.',
    example: 'The behaviour described above does not happen.',
  },
};

type Choice = readonly [code: string, option: SettingOption];

/**
 * A dropdown of a setting's choices. Under it, the choice currently
 * selected says what it does and gives an example, updated as the
 * selection changes and announced politely; below that, every choice in
 * one line each so they can be compared.
 */
export function SettingChoiceField({
  settingKey,
  valueType,
  value,
  onChange,
  disabled,
  label = 'Value',
  placeholder,
  keepValues = [],
}: {
  readonly settingKey: string;
  readonly valueType: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean | undefined;
  readonly label?: string | undefined;
  /** A "Choose…" entry for an empty value that is not itself a choice. */
  readonly placeholder?: string | undefined;
  /** Values that must stay offered (what is set now), known or not. */
  readonly keepValues?: readonly string[] | undefined;
}): ReactElement {
  const guide = settingGuide(settingKey);
  const base: Readonly<Record<string, SettingOption>> =
    guide?.values ?? (valueType === 'BOOLEAN' ? SWITCH_FALLBACK : {});
  const source = guide?.source;
  const field = (extra: readonly Choice[], loading: boolean): ReactElement => (
    <ChoiceSelect
      label={label}
      choices={mergeChoices(base, extra, [value, ...keepValues])}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      loading={loading}
    />
  );
  if (source === undefined) return field([], false);
  return <SourcedChoices source={source} render={field} />;
}

function SourcedChoices({
  source,
  render,
}: {
  readonly source: OptionSource;
  readonly render: (extra: readonly Choice[], loading: boolean) => ReactElement;
}): ReactElement {
  switch (source) {
    case 'couriers':
      return <CourierChoices render={render} />;
    case 'fulfilling-warehouses':
      return <WarehouseChoices fulfils render={render} />;
    case 'intake-warehouses':
      return <WarehouseChoices fulfils={false} render={render} />;
    case 'delhivery-accounts':
      return <AccountChoices courierCode="delhivery" render={render} />;
    case 'shiprocket-accounts':
      return <AccountChoices courierCode="shiprocket" render={render} />;
    default: {
      const exhaustive: never = source;
      throw new Error(`Unhandled option source: ${String(exhaustive)}`);
    }
  }
}

type RenderChoices = (extra: readonly Choice[], loading: boolean) => ReactElement;

function CourierChoices({ render }: { readonly render: RenderChoices }): ReactElement {
  const couriers = useCouriers();
  const extra: Choice[] = (couriers.data ?? []).map((c) => [
    c.code,
    {
      label: c.name,
      does: `New parcels are booked with ${c.name}${c.isActive ? '' : ' (switched off for new parcels right now)'}.`,
      example: `An order confirmed today is handed to ${c.name} for its waybill.`,
    },
  ]);
  return render(extra, couriers.isLoading);
}

function WarehouseChoices({
  fulfils,
  render,
}: {
  readonly fulfils: boolean;
  readonly render: RenderChoices;
}): ReactElement {
  const warehouses = useWarehouses();
  const extra: Choice[] = (warehouses.data ?? [])
    .filter((w) => w.fulfilsOrders === fulfils)
    .map((w) => [
      w.id,
      {
        label: `${w.code} — ${w.name}`,
        does: fulfils
          ? `Requests that name no warehouse use ${w.code}.`
          : `Consignments sent via Bangladesh are received at ${w.code} first.`,
        example: fulfils
          ? `A consignment created without a warehouse is received at ${w.code} (${w.name}).`
          : `A seller choosing "via Bangladesh" delivers to ${w.name}, and it is counted there before flying.`,
      },
    ]);
  return render(extra, warehouses.isLoading);
}

function AccountChoices({
  courierCode,
  render,
}: {
  readonly courierCode: string;
  readonly render: RenderChoices;
}): ReactElement {
  const accounts = useCourierAccounts({ courierCode });
  const extra: Choice[] = (accounts.data ?? []).map((a) => [
    a.id,
    {
      label: `${a.label} (${a.environment.toLowerCase()}${a.isActive ? '' : ', inactive'})`,
      does: `Parcels of sellers without their own accounts go to the "${a.label}" account.`,
      example: `A default-routed parcel is booked, billed and tracked on "${a.label}".`,
    },
  ]);
  return render(extra, accounts.isLoading);
}

/** The file's choices, then the live ones it lacks, then any value that must stay. */
function mergeChoices(
  base: Readonly<Record<string, SettingOption>>,
  extra: readonly Choice[],
  keep: readonly string[],
): readonly Choice[] {
  const out: Choice[] = Object.entries(base);
  const seen = new Set(out.map(([code]) => code));
  for (const [code, option] of extra) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push([code, option]);
  }
  for (const code of keep) {
    if (code === '' || seen.has(code)) continue;
    seen.add(code);
    out.push([
      code,
      {
        label: `${code} (set now)`,
        does: 'This is what is set now. It is not one of the choices listed.',
        example: 'Pick one of the other choices to change it, or leave it as it is.',
      },
    ]);
  }
  return out;
}

function ChoiceSelect({
  label,
  choices,
  value,
  onChange,
  disabled,
  placeholder,
  loading,
}: {
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled: boolean | undefined;
  readonly placeholder: string | undefined;
  readonly loading: boolean;
}): ReactElement {
  const id = useId();
  const explainId = `${id}-explain`;
  const selected = choices.find(([code]) => code === value)?.[1] ?? null;
  const showPlaceholder = placeholder !== undefined && !choices.some(([code]) => code === '');
  return (
    <div className="scf">
      <Select
        label={label}
        id={`${id}-select`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={explainId}
        hint={loading ? 'Loading the choices…' : undefined}
      >
        {showPlaceholder && <option value="">{placeholder}</option>}
        {choices.map(([code, option]) => (
          <option key={code} value={code}>
            {option.label}
          </option>
        ))}
      </Select>
      <div id={explainId} className="scf-now" aria-live="polite">
        {selected === null ? (
          <p className="ac-muted">Pick a choice to see what it does.</p>
        ) : (
          <>
            <p className="ac-text">
              <strong>{selected.label}:</strong> {selected.does}
            </p>
            <p className="ac-muted">
              <strong>Example:</strong> {selected.example}
            </p>
          </>
        )}
      </div>
      <ChoiceList choices={choices} current={value} />
    </div>
  );
}

/** Every choice in one line each, so they can be compared side by side. */
function ChoiceList({
  choices,
  current,
}: {
  readonly choices: readonly Choice[];
  readonly current: string;
}): ReactElement | null {
  if (choices.length < 2) return null;
  const items = (
    <ul className="scf-list">
      {choices.map(([code, option]) => (
        <li key={code} data-current={code === current || undefined}>
          <span className="scf-list__label">{option.label}</span>
          <span className="scf-list__does">{option.does}</span>
        </li>
      ))}
    </ul>
  );
  if (choices.length <= 6) {
    return (
      <div className="scf-compare">
        <p className="scf-compare__title">The choices</p>
        {items}
      </div>
    );
  }
  return (
    <details className="scf-compare">
      <summary className="scf-compare__title">Compare all {choices.length} choices</summary>
      {items}
    </details>
  );
}

/**
 * A JSON list of known codes as checkboxes. Codes already in the list
 * that the guide does not know stay, ticked, so saving never drops them.
 */
export function SettingMultiField({
  settingKey,
  value,
  onChange,
  disabled,
  label = 'Value',
}: {
  readonly settingKey: string;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly disabled?: boolean | undefined;
  readonly label?: string | undefined;
}): ReactElement {
  const multi = settingGuide(settingKey)?.multi ?? {};
  const known = Object.entries(multi);
  const unknown = value.filter((code) => multi[code] === undefined);
  const compact = known.length > 8;
  const toggle = (code: string, on: boolean): void => {
    const next = on ? [...value, code] : value.filter((c) => c !== code);
    // Keep the guide's order so the saved list reads the same way each time.
    const order = new Map(known.map(([c], i) => [c, i]));
    onChange([...new Set(next)].sort((a, b) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6)));
  };
  return (
    <fieldset className="ac-fieldset scf-multi" data-compact={compact || undefined}>
      <legend>
        {label} — {value.length} of {known.length + unknown.length} ticked
      </legend>
      <div className="scf-multi__grid">
        {known.map(([code, option]) => (
          <Checkbox
            key={code}
            label={option.label}
            description={
              compact ? undefined : (
                <>
                  {option.does} <em>Example:</em> {option.example}
                </>
              )
            }
            checked={value.includes(code)}
            onChange={(e) => toggle(code, e.target.checked)}
            disabled={disabled}
          />
        ))}
        {unknown.map((code) => (
          <Checkbox
            key={code}
            label={`${code} (set now)`}
            description="Not one of the known choices; untick to remove it."
            checked
            onChange={(e) => toggle(code, e.target.checked)}
            disabled={disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}
