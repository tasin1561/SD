'use client';

import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import type { AddressCheckResult } from '@skydrop/ui/app/address-check';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useUiT } from '@skydrop/ui/app/i18n-client';
import type { UiMessageKey } from '@skydrop/ui/app/i18n';
import { useT } from '@/i18n/client';
import { CopyButton } from './copy-button';
import { Disclosure } from './detail-card';

/**
 * The address check, READ-ONLY — the seller-local copy of the shared
 * `AddressCheckPanel` (`readOnly`, `embedded`). Nothing here is pressable but
 * the copy button on the label address: it is reading material, never a gate
 * (FE-2). Every branch of the original is kept: the unavailable state, the
 * issues, the questions with their candidates, the suggestions, the label
 * address (only at high confidence), the return-risk line (only when the model
 * says `shown`), the parsed fields with their source tags, the provider line.
 *
 * Differences, all visual: the heading is built from the REAL verdict and
 * score, each list is printed once (a suggestion whose candidates already sit
 * under a question is not repeated), and the parsed fields fold into a
 * disclosure.
 */

const ACTION_KIND = {
  approve: 'confirmed',
  confirm_with_customer: 'pending',
  reject: 'failed',
} as const;

const ACTION_ICON: Record<AddressCheckResult['action'], LucideIcon> = {
  approve: CheckCircle2,
  confirm_with_customer: AlertTriangle,
  reject: XCircle,
};

const ACTION_HEADING = {
  approve: 'orderPage.ac.approve',
  confirm_with_customer: 'orderPage.ac.confirm',
  reject: 'orderPage.ac.reject',
} as const;

const ACTION_WORD: Record<AddressCheckResult['action'], UiMessageKey> = {
  approve: 'ui.ac.action.approve',
  confirm_with_customer: 'ui.ac.action.confirm',
  reject: 'ui.ac.action.reject',
};

const SOURCE_WORD: Readonly<Record<string, UiMessageKey>> = {
  customer: 'ui.ac.src.customer',
  pincode: 'ui.ac.src.pincode',
  inferred: 'ui.ac.src.inferred',
};

const FIELD_WORD: Readonly<Record<string, UiMessageKey>> = {
  house: 'ui.ac.field.house',
  street: 'ui.ac.field.street',
  locality: 'ui.ac.field.locality',
  village_city: 'ui.ac.field.village_city',
  landmark: 'ui.ac.field.landmark',
  post_office: 'ui.ac.field.post_office',
  police_station: 'ui.ac.field.police_station',
  sub_district: 'ui.ac.field.sub_district',
  district: 'ui.ac.field.district',
  state: 'ui.ac.field.state',
  pincode: 'ui.ac.field.pincode',
};

/** Does the check have something to fix? Drives the card's warning edge and the summary line. */
export function addressNeedsFix(result: AddressCheckResult | null | undefined): boolean {
  return result !== null && result !== undefined && result.available && result.issues.length > 0;
}

export function AddressCheckView({
  result,
}: {
  readonly result: AddressCheckResult;
}): ReactElement {
  const t = useT();
  const ui = useUiT();
  const word = (
    table: Readonly<Record<string, UiMessageKey>>,
    key: string,
    fallback?: UiMessageKey,
  ) => {
    const k = table[key];
    if (k !== undefined) return ui(k);
    return fallback === undefined ? key : ui(fallback);
  };

  if (!result.available) {
    return (
      <div className="cod-ac" data-kind="held">
        <p className="cod-ac__verdict">
          <AlertTriangle size={18} aria-hidden />
          <span>{ui('ui.ac.unavailable')}</span>
        </p>
        <p className="cod-muted">{ui('ui.ac.unavailableBody')}</p>
      </div>
    );
  }

  const Icon = ACTION_ICON[result.action];
  const kind = ACTION_KIND[result.action];
  const heading =
    result.score === null
      ? t(ACTION_HEADING[result.action])
      : `${t(ACTION_HEADING[result.action])} · ${t('orderPage.ac.outOf', { score: result.score })}`;
  const questionHas = (field: string): boolean =>
    result.questions.some((q) => q.field === field && (q.options?.length ?? 0) > 0);
  const parsed = Object.entries(result.extracted).filter(([, v]) => v !== null && v !== '');

  return (
    <div className="cod-ac" data-kind={kind}>
      <p className="cod-ac__verdict">
        <Icon size={18} aria-hidden />
        <span>{heading}</span>
      </p>
      <div className="cod-ac__chips">
        <StatusChip kind={kind} label={ui(ACTION_WORD[result.action])} size="sm" />
        {result.rechecked ? <span className="cod-ac__re">{ui('ui.ac.rechecked')}</span> : null}
      </div>
      {result.score !== null ? (
        <div
          className="cod-ac__meter"
          role="meter"
          aria-valuenow={result.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={ui('ui.ac.score', { n: result.score })}
        >
          <span
            className="cod-ac__meterfill"
            style={{ transform: `scaleX(${Math.max(0, Math.min(100, result.score)) / 100})` }}
          />
        </div>
      ) : null}

      {result.issues.length > 0 ? (
        <section className="cod-ac__block">
          <h3 className="cod-ac__h">{t('orderPage.ac.issues')}</h3>
          <ul className="cod-ac__issues">
            {result.issues.map((i) => (
              <li key={i.code}>
                <AlertTriangle size={16} aria-hidden />
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.questions.length > 0 ? (
        <section className="cod-ac__block">
          <h3 className="cod-ac__h">{t('orderPage.ac.questions')}</h3>
          <ol className="cod-ac__qs">
            {result.questions.map((q, i) => (
              <li key={`${q.field}-${i}`}>
                {result.questions.length > 1 ? (
                  <span className="cod-ac__qn" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                ) : null}
                <span className="cod-ac__qbody">
                  <span>{q.text}</span>
                  {q.options !== undefined && q.options.length > 0 ? (
                    <span className="cod-chips">
                      {q.options.map((o) => (
                        <span key={o} className="cod-chip">
                          {o}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {result.suggestions
        // Read-only: a field whose candidates already sit under a question is
        // not listed a second time under its suggestion.
        .filter((s) => !questionHas(s.field))
        .map((s) => (
          <section className="cod-ac__block" key={s.field}>
            <h3 className="cod-ac__h">
              {ui('ui.ac.confirmOnly', { field: word(FIELD_WORD, s.field) })}
            </h3>
            <p className="cod-muted">
              {s.reason ?? ui('ui.ac.pincodeSays', { candidates: s.candidates.join(', ') })}
            </p>
            <span className="cod-chips">
              {s.candidates.map((c) => (
                <span key={c} className="cod-chip">
                  {c}
                </span>
              ))}
            </span>
          </section>
        ))}

      {/* ONLY at high confidence. Anything less and the customer's own words
          go on the parcel — a label address we are unsure of is how a
          deliverable parcel reaches the wrong post office. */}
      {result.poConfidence === 'high' && result.completedAddress !== null ? (
        <section className="cod-ac__block cod-ac__label">
          <h3 className="cod-ac__h">
            <ShieldCheck size={16} aria-hidden />
            {t('orderPage.ac.labelAddress')}
          </h3>
          <p className="cod-ac__labeltext">
            <span className="cod-wrap">{result.completedAddress}</span>
            <CopyButton value={result.completedAddress} label={t('orderPage.ac.labelAddress')} />
          </p>
        </section>
      ) : null}

      {parsed.length > 0 ? (
        <Disclosure title={t('orderPage.ac.parsed', { count: parsed.length })}>
          <dl className="cod-ac__fields">
            {parsed.map(([k, v]) => (
              <div className="cod-ac__field" key={k}>
                <dt>{word(FIELD_WORD, k)}</dt>
                <dd>
                  <span className="cod-wrap">{v}</span>
                  <span className="cod-ac__src">
                    {word(SOURCE_WORD, result.fieldSource[k] ?? '', 'ui.ac.src.unknown')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      ) : null}

      <p className="cod-ac__rto">
        {result.rtoRiskStatus === 'shown' && result.rtoRisk !== null
          ? t('orderPage.ac.rto', { pct: Math.round(result.rtoRisk * 100) })
          : t('orderPage.ac.rtoNone')}
      </p>
      {/* OUR provider, never theirs (owner, 2026-11-12). */}
      {result.providersUsed.length > 0 ? (
        <p className="cod-ac__attr">{ui('ui.ac.attribution.provider')}</p>
      ) : null}
    </div>
  );
}
