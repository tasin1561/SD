'use client';

import { clsx } from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Lightbulb,
  MapPin,
  RefreshCw,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { ComboSelect } from '../combo-select';
import './address-check.css';

/**
 * The address check, as the operator sees it.
 *
 * ── IT IS READING MATERIAL, NOT A GATE ───────────────────────────────
 * Nothing here disables a button or blocks a save. Whether a verdict
 * stops an order is the server's decision (`address_check.mode`), and
 * mirroring that rule in the browser would be exactly the FE-2 mistake:
 * a client-side copy of a server policy that drifts from it silently.
 * This panel shows what was found and offers the two actions a person
 * can take about it — apply a suggestion, or say they rang the customer.
 *
 * ── WHAT IT REFUSES TO SHOW ──────────────────────────────────────────
 * A return-risk number unless their model says `shown` (today it never
 * does, and an invented figure would be acted on); a "suggested label
 * address" unless post-office confidence is `high`, because only then
 * may it reach a courier label; and a serviceability verdict at all,
 * because that field comes back null from them and null is unknown, not
 * no. The console's own Delhivery check still answers that question.
 */

export type AddressCheckAction = 'approve' | 'confirm_with_customer' | 'reject';

/** sessionStorage key holding the draft id of the order being filled in. */
const DRAFT_KEY = 'sd-order-v2-draft';

/**
 * The draft id an order form checks its address under.
 *
 * ONE PER ORDER FORM, in sessionStorage, because Solustation bills a
 * unit per `reference_id` per month: minting a fresh one on every mount
 * would charge again for the same address every time an operator
 * refreshed mid-order.
 *
 * `clear()` is called once an order is created, and that half matters
 * more than the billing. Carrying a spent reference into the NEXT order
 * is worse than paying twice — a repeat `/v1/validate` on it returns
 * their STORED answer, so the second customer would be shown the
 * verdict on the first customer's address.
 *
 * Minted in an effect rather than a lazy initialiser: these forms
 * server-render first, and a uuid generated there would not match the
 * one the browser makes.
 *
 * It lives HERE, not in each console, deliberately. Three v2 forms need
 * it and the logic is subtle in three different ways; three copies is
 * three chances for one of them to quietly stop clearing.
 */
export function useDraftReference(): { referenceId: string; clear: () => void } {
  const [referenceId, setReferenceId] = useState('');
  useEffect(() => {
    try {
      const held = window.sessionStorage.getItem(DRAFT_KEY);
      if (held !== null && held !== '') {
        setReferenceId(held);
        return;
      }
      const fresh = `draft-${crypto.randomUUID()}`;
      window.sessionStorage.setItem(DRAFT_KEY, fresh);
      setReferenceId(fresh);
    } catch {
      // Private browsing, blocked site data: the check still works for
      // this mount, it just cannot survive a refresh. Better than no
      // check at all, and nothing here may throw at an operator.
      setReferenceId(`draft-${crypto.randomUUID()}`);
    }
  }, []);
  const clear = (): void => {
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to do — the next mount mints a new one anyway */
    }
  };
  return { referenceId, clear };
}

export interface AddressCheckResult {
  readonly available: boolean;
  readonly status: string;
  readonly action: AddressCheckAction;
  readonly score: number | null;
  readonly poConfidence: string | null;
  readonly completedAddress: string | null;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;
  readonly suggestions: ReadonlyArray<{
    field: string;
    candidates: readonly string[];
    reason?: string;
  }>;
  readonly extracted: Readonly<Record<string, string | null>>;
  readonly fieldSource: Readonly<Record<string, string>>;
  readonly rtoRisk: number | null;
  readonly rtoRiskStatus: string | null;
  readonly rechecked: boolean;
}

export interface AddressCheckPanelProps {
  /** Null before the first check has been asked for. */
  readonly result: AddressCheckResult | null;
  readonly busy?: boolean;
  /** Enabled only when there is enough address to check. */
  readonly canCheck?: boolean;
  readonly onCheck?: () => void;
  readonly onApplySuggestion?: (field: string, value: string) => void;
  /**
   * EVERY post office of the typed pincode, from the free
   * `/v1/pincode/{pincode}` lookup the page already holds.
   *
   * Their suggestion caps its candidate list — 10 offered for a
   * pincode with 26 — so without this the operator's only way to pick
   * the 11th is to type it from memory, which is how a post office
   * gets misspelt into an address that then scores worse. Optional:
   * when the lookup has not answered, the candidates still work.
   */
  readonly allPostOffices?: ReadonlyArray<{ name: string; type: string | null }> | undefined;
  readonly confirmedWithCustomer?: boolean;
  readonly onConfirmedWithCustomerChange?: (next: boolean) => void;
  readonly className?: string;
}

/** The three verdicts mapped onto the status kinds the brand already
 *  owns — no new palette, no hex here (FE-6). */
const ACTION_KIND: Record<AddressCheckAction, string> = {
  approve: 'confirmed',
  confirm_with_customer: 'pending',
  reject: 'failed',
};

const ACTION_ICON: Record<AddressCheckAction, LucideIcon> = {
  approve: CheckCircle2,
  confirm_with_customer: AlertTriangle,
  reject: XCircle,
};

const ACTION_WORD: Record<AddressCheckAction, string> = {
  approve: 'Looks deliverable',
  confirm_with_customer: 'Confirm with the customer',
  reject: 'Do not ship as written',
};

/**
 * Fields whose suggestion is ADVICE ONLY — never one click away.
 *
 * A district, city or state suggestion means the address and the
 * pincode disagree (`district_conflicts_with_pincode`), and the
 * service cannot know WHICH of the two is wrong. Verified live
 * 2026-10-26: "Vill Raydighi, Dist Howrah" + 743383 offers
 * ["South 24 Parganas"] because the pincode says so — but the customer
 * may have given the right district and the wrong pincode, and
 * applying the suggestion would then quietly make a wrong address
 * self-consistent, which is the one outcome worse than an obviously
 * wrong one. It goes to the customer, not to a button.
 */
const CONFIRM_ONLY_FIELDS: ReadonlySet<string> = new Set(['district', 'city', 'state']);

/** `customer` / `pincode` / `inferred`, said the way a person would. */
const SOURCE_WORD: Readonly<Record<string, string>> = {
  customer: 'from customer',
  pincode: 'from pincode',
  inferred: 'inferred',
};

const FIELD_WORD: Readonly<Record<string, string>> = {
  house: 'House',
  street: 'Street',
  locality: 'Locality',
  village_city: 'Village / city',
  landmark: 'Landmark',
  post_office: 'Post office',
  police_station: 'Police station',
  sub_district: 'Sub-district',
  district: 'District',
  state: 'State',
  pincode: 'PIN code',
};

export function AddressCheckPanel({
  result,
  busy = false,
  canCheck = true,
  onCheck,
  onApplySuggestion,
  allPostOffices,
  confirmedWithCustomer = false,
  onConfirmedWithCustomerChange,
  className,
}: AddressCheckPanelProps): ReactElement {
  const kind = result === null ? 'neutral' : result.available ? ACTION_KIND[result.action] : 'held';
  const style = {
    '--ac-fg': `var(--st-${kind}-fg)`,
    '--ac-bg': `var(--st-${kind}-bg)`,
    '--ac-line': `var(--st-${kind}-line)`,
  } as CSSProperties;

  return (
    <section className={clsx('sk-ac', className)} style={style} aria-label="Address check">
      <header className="sk-ac__head">
        <span className="sk-ac__title">
          <MapPin size={15} aria-hidden="true" />
          Address check
        </span>
        {result !== null && result.available && result.score !== null ? (
          <Score value={result.score} />
        ) : null}
        {onCheck !== undefined ? (
          <button
            type="button"
            className="sk-ac__go"
            onClick={onCheck}
            disabled={busy || !canCheck}
            aria-busy={busy}
          >
            <RefreshCw size={14} aria-hidden="true" className={busy ? 'sk-ac__spin' : undefined} />
            {busy ? 'Checking…' : result === null ? 'Check address' : 'Check again'}
          </button>
        ) : null}
      </header>

      {/* One live region for the whole panel: the verdict is what a
          screen reader needs announced, not every field under it. */}
      <div aria-live="polite" className="sk-ac__body">
        {result === null ? (
          <p className="sk-ac__hint">
            <CircleHelp size={14} aria-hidden="true" />
            Fill in the address and PIN code, then check it. The customer sees nothing of this.
          </p>
        ) : !result.available ? (
          <Unavailable confirmed={confirmedWithCustomer} onChange={onConfirmedWithCustomerChange} />
        ) : (
          <Verdict
            result={result}
            onApplySuggestion={onApplySuggestion}
            allPostOffices={allPostOffices}
            confirmed={confirmedWithCustomer}
            onConfirmedChange={onConfirmedWithCustomerChange}
          />
        )}
      </div>
    </section>
  );
}

/** 0-100, with the bar filling from the left. Transform only. */
function Score({ value }: { value: number }): ReactElement {
  return (
    <span className="sk-ac__score" title={`Validity score ${value} out of 100`}>
      <span className="sk-ac__score-num">{value}</span>
      <span className="sk-ac__score-track" aria-hidden="true">
        <span
          className="sk-ac__score-fill"
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
        />
      </span>
    </span>
  );
}

function Unavailable({
  confirmed,
  onChange,
}: {
  confirmed: boolean;
  onChange?: ((next: boolean) => void) | undefined;
}): ReactElement {
  return (
    <>
      <p className="sk-ac__verdict">
        <AlertTriangle size={15} aria-hidden="true" />
        Address check unavailable
      </p>
      <p className="sk-ac__hint">
        We could not check this address just now, so nothing is known about it either way. The order
        saves exactly as it always has — ring the customer if anything about the address looks thin.
        We will check it again in the background.
      </p>
      {onChange !== undefined ? <ConfirmBox confirmed={confirmed} onChange={onChange} /> : null}
    </>
  );
}

function Verdict({
  result,
  onApplySuggestion,
  allPostOffices,
  confirmed,
  onConfirmedChange,
}: {
  result: AddressCheckResult;
  onApplySuggestion?: ((field: string, value: string) => void) | undefined;
  allPostOffices?: ReadonlyArray<{ name: string; type: string | null }> | undefined;
  confirmed: boolean;
  onConfirmedChange?: ((next: boolean) => void) | undefined;
}): ReactElement {
  const Icon = ACTION_ICON[result.action];
  const extracted = Object.entries(result.extracted).filter(([, v]) => v !== null && v !== '');

  return (
    <>
      <p className="sk-ac__verdict">
        <Icon size={15} aria-hidden="true" />
        {ACTION_WORD[result.action]}
        {result.rechecked ? <span className="sk-ac__re">re-checked</span> : null}
      </p>

      {result.issues.length > 0 ? (
        <ul className="sk-ac__issues">
          {result.issues.map((i) => (
            <li key={i.code}>{i.message}</li>
          ))}
        </ul>
      ) : null}

      {result.suggestions.map((s) =>
        CONFIRM_ONLY_FIELDS.has(s.field) ? (
          <div className="sk-ac__sugg sk-ac__sugg--confirm" key={s.field}>
            <span className="sk-ac__sugg-label">
              <AlertTriangle size={13} aria-hidden="true" />
              {FIELD_WORD[s.field] ?? s.field} — confirm with the customer
            </span>
            <span className="sk-ac__sugg-why">
              {s.reason ?? `The pincode says ${s.candidates.join(', ')}.`}
            </span>
            {/* Deliberately NOT buttons. Either half of the
                disagreement may be the wrong one, and only the
                customer can say which. */}
            <span className="sk-ac__sugg-list">
              {s.candidates.map((c) => (
                <span key={c} className="sk-ac__cand sk-ac__cand--static">
                  {c}
                </span>
              ))}
            </span>
          </div>
        ) : (
          <div className="sk-ac__sugg" key={s.field}>
            <span className="sk-ac__sugg-label">
              <Lightbulb size={13} aria-hidden="true" />
              {FIELD_WORD[s.field] ?? s.field}
              {s.reason === undefined ? null : <em> — {s.reason}</em>}
            </span>
            {/* Every candidate is offered and none is pre-chosen: the
                first is their best guess, not an answer, and a list
                that applied itself would make the operator's job
                "undo the wrong one". */}
            <span className="sk-ac__sugg-list">
              {s.candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="sk-ac__cand"
                  onClick={() => onApplySuggestion?.(s.field, c)}
                  disabled={onApplySuggestion === undefined}
                >
                  {c}
                </button>
              ))}
            </span>
            {s.field === 'post_office' ? (
              <OtherOffices
                all={allPostOffices}
                offered={s.candidates}
                onPick={(name) => onApplySuggestion?.('post_office', name)}
                disabled={onApplySuggestion === undefined}
              />
            ) : null}
          </div>
        ),
      )}

      {extracted.length > 0 ? (
        <dl className="sk-ac__fields">
          {extracted.map(([k, v]) => (
            <div className="sk-ac__field" key={k}>
              <dt>{FIELD_WORD[k] ?? k}</dt>
              <dd>
                {v}
                <span className="sk-ac__src">
                  {SOURCE_WORD[result.fieldSource[k] ?? ''] ?? 'unknown source'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* ONLY at high confidence. Anything less and the customer's own
          words go on the parcel — a label address we are unsure of is
          how a deliverable parcel reaches the wrong post office. */}
      {result.poConfidence === 'high' && result.completedAddress !== null ? (
        <p className="sk-ac__label-addr">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>
            <strong>Suggested label address</strong>
            {result.completedAddress}
          </span>
        </p>
      ) : null}

      <p className="sk-ac__rto">
        {result.rtoRiskStatus === 'shown' && result.rtoRisk !== null
          ? `Return risk: ${Math.round(result.rtoRisk * 100)}%`
          : 'Return risk: not enough data yet'}
      </p>

      {result.action === 'confirm_with_customer' && onConfirmedChange !== undefined ? (
        <ConfirmBox confirmed={confirmed} onChange={onConfirmedChange} />
      ) : null}
    </>
  );
}

/**
 * The rest of the pincode's post offices.
 *
 * Their candidate list is CAPPED — 10 offered for a pincode that has
 * 26 (verified live, 2026-10-26) — so the office the operator wants is
 * often simply not among the buttons. The free pincode lookup already
 * knows all of them and the page already holds it, so the remainder
 * goes here rather than into the operator's memory: typing a post
 * office from memory is how it gets misspelt into an address that then
 * scores worse than the one they started with.
 *
 * Offered candidates are excluded so the same office is never in two
 * places, and the control does not appear at all when there is nothing
 * left to offer.
 */
function OtherOffices({
  all,
  offered,
  onPick,
  disabled,
}: {
  all?: ReadonlyArray<{ name: string; type: string | null }> | undefined;
  offered: readonly string[];
  onPick: (name: string) => void;
  disabled: boolean;
}): ReactElement | null {
  const shown = new Set(offered.map((c) => c.toLowerCase()));
  const rest = (all ?? []).filter((o) => !shown.has(o.name.toLowerCase()));
  if (rest.length === 0) return null;
  return (
    <ComboSelect
      className="sk-ac__others"
      label={`Other offices of this pincode (${rest.length})`}
      placeholder="Type to search…"
      disabled={disabled}
      value={null}
      options={rest.map((o) => ({
        value: o.name,
        label: o.name,
        // `type` is null for every row today — a known gap at their
        // end. Shown only once it is not, rather than printing an
        // empty line under every name.
        ...(o.type === null || o.type === '' ? {} : { description: o.type }),
      }))}
      emptyText="No office of this pincode matches that."
      onChange={(value) => {
        if (value !== null && value !== '') onPick(value);
      }}
    />
  );
}

function ConfirmBox({
  confirmed,
  onChange,
}: {
  confirmed: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <label className="sk-ac__confirm">
      <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} />I
      confirmed this address with the customer
    </label>
  );
}
