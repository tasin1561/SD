'use client';

import type { CSSProperties, ReactElement } from 'react';
import { Check, Coins, FileText, Landmark, Receipt, Truck, UserCheck, Zap } from 'lucide-react';
import { DrawToggle } from '@/components/micro/touches';
import { tourMoney as c } from '@/content/sections/tour-money';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './money.css';

/** `--i` drives every stagger; one cast, reused. */
function step(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}

/**
 * Three ledger lines, labelled exactly as `walletDirectionLabel` does.
 * The sign is in the string and the colour is on the row, so neither
 * carries the direction alone.
 */
const LEDGER: ReadonlyArray<{ label: string; amount: string; credit: boolean }> = [
  { label: 'COD collected', amount: '+ ₹2,450.00', credit: true },
  { label: 'Order charges', amount: '− ₹185.00', credit: false },
  { label: 'Inbound freight', amount: '− ₹640.00', credit: false },
];

/** The top-up wizard's three steps, in its own order. */
const STEPS = ['Choose account', 'Payment details', 'Submitted'] as const;

/**
 * The two ways a COD order can reach the wallet — one at a time, never
 * both (`wallet.cod_credit_mode` is an enum). The Instant Pay fee is a
 * real commercial rate, so the chip says one applies and names none.
 */
const MODES: ReadonlyArray<{ hot: boolean; title: string; note: string }> = [
  { hot: false, title: 'On settlement', note: 'Credited when the courier pays us' },
  { hot: true, title: 'Instant Pay', note: 'Instant, at delivery (Instant Pay fee applies)' },
];

/** One parcel's charge lines, under the order screen's own `Charge | Amount`. */
const CHARGES: ReadonlyArray<{ label: string; amount: string; total?: true }> = [
  { label: 'Base shipping', amount: '₹185.00' },
  { label: 'Total', amount: '₹185.00', total: true },
];

/**
 * 13 · Platform tour — MONEY. Five beats in one 4:3 frame: the wallet
 * in both currencies with its ledger; a bank transfer waiting for a
 * person to see it on our statement and then being credited; the
 * automatic-withdrawal switch and the sentence it changes; the two ways
 * a COD order can reach the wallet; and one parcel's charges beside its
 * invoice.
 *
 * Every beat's state is an attribute on the mock root — `data-beat`
 * picks the scene and re-runs its entrance, `data-reduced` switches
 * every animation off. The CSS base state IS each beat's finished
 * frame, so reduced motion lands there with no second set of rules;
 * that is why the "Waiting" chip's base opacity is 0 and only its
 * entrance animation ever shows it.
 *
 * The rupee and taka figures are illustrative constants rather than
 * `dummy()` values: one sample wallet inside the frame's `aria-hidden`
 * box, not a rate, an average or a published price — the same
 * judgement the Returns and Orders vignettes' sample figures got.
 */
export default function MoneyVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });

  return (
    <div className="vg vg-mon">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={c.beats.map((b) => b.id)}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-mon__mock" data-beat={beats.index} data-reduced={beats.reducedMotion}>
          {/* 1 · the balance, and what moved it */}
          <div className="vg-mon__scene" data-scene="0">
            <div className="vg-mon__tiles">
              <div className="vg-mon__card vg-mon__tile">
                <span className="vg-mon__th">
                  <span className="vg-mon__ico">
                    <Landmark size={11} />
                  </span>
                  <b>Balance · INR</b>
                </span>
                <b className="vg-mon__big tabular">₹48,320.00</b>
              </div>
              <div className="vg-mon__card vg-mon__tile" data-soft="true">
                <span className="vg-mon__th">
                  <span className="vg-mon__ico">
                    <Coins size={11} />
                  </span>
                  <b>Your balance in BDT</b>
                </span>
                <b className="vg-mon__big tabular">৳63,782.40</b>
                <i className="vg-mon__hint tabular">₹1 = ৳1.32</i>
              </div>
            </div>
            <ul className="vg-mon__list">
              {LEDGER.map((l, k) => (
                <li
                  key={l.label}
                  className="vg-mon__row"
                  style={step(k)}
                  data-dir={l.credit ? 'credit' : 'debit'}
                >
                  <span>{l.label}</span>
                  <b className="tabular">{l.amount}</b>
                </li>
              ))}
            </ul>
            <p className="vg-mon__foot">The same money, counted twice — never two balances.</p>
          </div>

          {/* 2 · a transfer somebody has to see first */}
          <div className="vg-mon__scene" data-scene="1">
            <p className="vg-mon__h">Top up your wallet</p>
            <ol className="vg-mon__steps">
              {STEPS.map((s, k) => (
                <li key={s} className="vg-mon__stp" style={step(k)}>
                  <span className="vg-mon__dot">{k + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="vg-mon__card">
              <span className="vg-mon__th">
                <b>You sent</b>
                <i className="tabular">৳50,000.00</i>
              </span>
              <span className="vg-mon__slot">
                <span className="vg-mon__stamp">
                  <UserCheck size={11} />
                </span>
                <span className="vg-mon__sts">
                  <span className="vg-mon__chip" data-st="wait">
                    Waiting for Skydrop to see it
                  </span>
                  <span className="vg-mon__chip" data-st="ok">
                    <Check size={10} strokeWidth={3} /> Credited
                  </span>
                </span>
              </span>
            </div>
            <p className="vg-mon__foot">
              Nothing reaches your balance until we match it against our statement.
            </p>
          </div>

          {/* 3 · the switch, and the sentence it changes */}
          <div className="vg-mon__scene" data-scene="2">
            <p className="vg-mon__h">Withdrawal settings</p>
            <div className="vg-mon__card vg-mon__wd">
              <span className="vg-mon__th">
                <span className="vg-mon__ico">
                  <Landmark size={11} />
                </span>
                <b>Automatic withdrawals</b>
              </span>
              <span className="vg-mon__tg">
                <DrawToggle label="" checked readOnly tabIndex={-1} />
              </span>
            </div>
            <p className="vg-mon__swap">
              <s>Withdrawals are yours to request.</s>
              <b>We raise the request for you on a schedule.</b>
            </p>
            <p className="vg-mon__foot">
              It passes exactly the same checks as a request you make by hand.
            </p>
          </div>

          {/* 4 · when a COD order reaches the wallet */}
          <div className="vg-mon__scene" data-scene="3">
            <p className="vg-mon__h">When COD reaches you</p>
            <ul className="vg-mon__pair">
              {MODES.map((m, k) => (
                <li
                  key={m.title}
                  className="vg-mon__card vg-mon__opt"
                  style={step(k)}
                  data-hot={m.hot}
                >
                  <span className="vg-mon__th">
                    <span className="vg-mon__ico">
                      {m.hot ? <Zap size={11} /> : <Truck size={11} />}
                    </span>
                    <b>{m.title}</b>
                  </span>
                  <span className="vg-mon__note">{m.note}</span>
                </li>
              ))}
            </ul>
            <p className="vg-mon__foot">One or the other, set on your account — never both.</p>
          </div>

          {/* 5 · one parcel's money */}
          <div className="vg-mon__scene" data-scene="4">
            <div className="vg-mon__card vg-mon__band">
              <span className="vg-mon__th">
                <span className="vg-mon__ico">
                  <Receipt size={11} />
                </span>
                <b>Charges</b>
              </span>
              <span className="vg-mon__note">What this parcel costs you.</span>
              <span className="vg-mon__hd">
                <span>Charge</span>
                <span>Amount</span>
              </span>
              {CHARGES.map((r, k) => (
                <span
                  key={r.label}
                  className="vg-mon__row"
                  style={step(k)}
                  data-total={r.total ?? false}
                >
                  <span>{r.label}</span>
                  <b className="tabular">{r.amount}</b>
                </span>
              ))}
            </div>
            <div className="vg-mon__card vg-mon__inv">
              <span className="vg-mon__th">
                <span className="vg-mon__ico">
                  <FileText size={11} />
                </span>
                <b>Invoice</b>
              </span>
              <span className="vg-mon__note">The tax document for this sale.</span>
            </div>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}

export const __SD_VIGNETTE__ = 'money';
