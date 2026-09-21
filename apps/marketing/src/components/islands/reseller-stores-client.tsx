'use client';

import { ArrowLeftRight, Check, Lock, Store, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useBeats } from '@/components/vignettes/use-beats';
import { VignetteFrame } from '@/components/vignettes/vignette-frame';
import { reseller as r } from '@/content/sections/reseller';
import '@/components/sections/reseller-stores.css';

/** `check-bundle.mjs` finds this island's chunk by this string; it must stay referenced. */
export const __SD_ISLAND_PLATFORM__ = 'reseller-stores';

/** A child's place in its stagger; the delay arithmetic is in the CSS. */
const at = (k: number): CSSProperties => ({ '--k': k }) as CSSProperties;

/* ── Mock furniture ──────────────────────────────────────────────────
   ILLUSTRATIVE, every one of them. None of these figures is Skydrop's
   rate, price or stock: they live here, beside the markup that draws
   them, so no percentage on this page can be mistaken for a real one
   and nothing in `content/` has to be marked a placeholder. */

/** Store's share of each fee, against `reseller.fees` in the same order. */
const STORE_SHARE = [50, 100, 100, 50, 0, 0] as const;

/** Which credit timing each party is on — indices into `creditTriggers`. */
const TIMING = [
  { who: 'The store is credited', pick: 1, party: 'store' },
  { who: 'You are credited', pick: 0, party: 'seller' },
] as const;

/** Catalogue arithmetic, done honestly: floor(min(12, 40) × (100 − 30)%) = 8. */
const STOCK = { real: 40, aside: 12, hidden: 30, visible: 8 } as const;

/** One answer per capability, in `reseller.capabilities` order. */
const POLICY = [
  { can: true, how: 'direct' },
  { can: true, how: 'approval' },
  { can: true, how: 'direct' },
  { can: true, how: 'approval' },
  { can: true, how: 'direct' },
  { can: true, how: 'approval' },
  { can: false, how: null },
] as const;

/** The store's own catalogue rows — its price, never the seller's cost. */
const STORE_ROWS = [
  { p: 'Silk kurta · M', pay: '₹640', band: '₹900–₹1,400', rec: '₹1,150', free: 8 },
  { p: 'Silk kurta · L', pay: '₹640', band: '₹900–₹1,400', rec: '₹1,150', free: 5 },
  { p: 'Wool scarf', pay: '₹310', band: '₹480–₹750', rec: '₹590', free: 2 },
] as const;

/** The settlement the dispute beat shows crossing between the two wallets. */
const SETTLEMENT = '₹640';

/**
 * SECTION 14's island — the two-party demo. Five beats walk from the
 * SELLER's three screens (terms, catalogue, action policy) to the
 * STORE's own portal and the dispute between them, and the frame
 * cross-fades blue → violet as it crosses.
 *
 * The mock is `aria-hidden`: the steps beside it and the frame's caption
 * strip carry the same facts in words, so nothing is said by the picture
 * alone. The beat index drives the whole picture through `data-beat`, so
 * there is no per-element React state, and under reduced motion every
 * panel is already in its finished frame.
 */
export function ResellerStoresClient(): ReactElement {
  const [near, setNear] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), {
      rootMargin: '300px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const beats = useBeats({ beats: r.beats, enabled: near });
  const i = beats.index;
  // Beats 0–2 are the seller's screens; 3–4 are the store's side.
  const party = i >= 3 ? 'store' : 'seller';
  const hue = party === 'store' ? r.storeHue : r.sellerHue;
  const q = r.policyQuestions;

  return (
    <div ref={root} className="rs" data-island={__SD_ISLAND_PLATFORM__} data-party={party}>
      <div className="rs__aside">
        <p className="rs__legend">
          <span className="rs__key rs__key--seller">You, the seller</span>
          <span className="rs__key rs__key--store">The reseller store</span>
        </p>
        <ol className="rs__steps">
          {r.beats.map((b, k) => (
            <li
              key={b.id}
              className="rs__step"
              data-state={k < i ? 'done' : k === i ? 'current' : 'todo'}
              data-party={k >= 3 ? 'store' : 'seller'}
              aria-current={k === i ? 'step' : undefined}
            >
              <span className="rs__stepN" aria-hidden>
                {k < i ? <Check size={12} strokeWidth={3} /> : k + 1}
              </span>
              <span>{b.step}</span>
            </li>
          ))}
        </ol>
        <p className="rs__note">{r.note}</p>
      </div>

      <VignetteFrame beats={beats} title={r.title} hue={hue}>
        <div className="rs__mock" data-beat={i} data-reduced={beats.reducedMotion}>
          <div className="rs__scale">
            {/* 1 — the terms you publish */}
            <div className="rs__panel" data-on={i === 0 || undefined}>
              <p className="rs__bar">
                <b>Terms</b>
                <code>Version 3</code>
              </p>
              <div className="rs__box rs__fees">
                <i className="rs__walk" />
                {r.fees.map((f, k) => {
                  const store = STORE_SHARE[k] ?? 0;
                  return (
                    <span key={f} className="rs__fee" style={at(k)}>
                      <span className="rs__clip">{f} — store pays (%)</span>
                      <span className="rs__pct">{store}</span>
                      <span className="rs__split">
                        <i
                          className="rs__splitStore"
                          style={{ ...at(k), transform: `scaleX(${store / 100})` }}
                        />
                      </span>
                    </span>
                  );
                })}
              </div>
              <div className="rs__box rs__timing">
                {TIMING.map((t, k) => (
                  <span key={t.who} className="rs__time" style={at(k)} data-party={t.party}>
                    <b>{t.who}</b>
                    {r.creditTriggers[t.pick] ?? ''}
                  </span>
                ))}
              </div>
              <p className="rs__foot">
                The store pays the share you set; you pay the rest. Always.
              </p>
            </div>

            {/* 2 — what the store is shown */}
            <div className="rs__panel" data-on={i === 1 || undefined}>
              <p className="rs__bar">
                <b>Catalogue &amp; stock</b>
                <code>Silk kurta · M</code>
              </p>
              <div className="rs__dials">
                <span className="rs__dial" style={at(0)}>
                  <span className="rs__label">Units set aside</span>
                  <b className="rs__dialV">{STOCK.aside}</b>
                </span>
                <span className="rs__dial" style={at(1)}>
                  <span className="rs__label">Hidden share (%)</span>
                  <b className="rs__dialV">{STOCK.hidden}</b>
                </span>
              </div>
              <div className="rs__box rs__calc">
                <span className="rs__calcRow" data-party="seller">
                  <span className="rs__label">Really available</span>
                  <b>{STOCK.real}</b>
                  <i className="rs__track">
                    <i className="rs__trackReal" />
                  </i>
                </span>
                <span className="rs__calcRow" data-party="store">
                  <span className="rs__label">Visible to the store</span>
                  <b>{STOCK.visible}</b>
                  <i className="rs__track">
                    <i className="rs__trackSeen" />
                  </i>
                </span>
              </div>
              <p className="rs__foot">
                It never sees your cost, your real stock, your set-asides or your other stores.
              </p>
            </div>

            {/* 3 — what the store may do: the two questions, all seven tasks */}
            <div className="rs__panel" data-on={i === 2 || undefined}>
              <p className="rs__bar">
                <b>What this store may do</b>
                <code>{r.capabilities.length} tasks</code>
              </p>
              <div className="rs__box rs__policy">
                <span className="rs__pHead">
                  <span>Task</span>
                  <span>{q.can}</span>
                  <span>{q.how}</span>
                </span>
                <span className="rs__pBody">
                  <i className="rs__rowLit" />
                  {r.capabilities.map((c, k) => {
                    const a = POLICY[k];
                    return (
                      <span key={c.task} className="rs__pRow" style={at(k)}>
                        <span className="rs__clip">{c.task}</span>
                        <span className="rs__pA" data-yes={a?.can || undefined}>
                          {a?.can ? (
                            <Check size={10} strokeWidth={3} />
                          ) : (
                            <X size={10} strokeWidth={3} />
                          )}
                          {a?.can ? 'Yes' : 'No'}
                        </span>
                        <span className="rs__pB" data-ask={a?.how === 'approval' || undefined}>
                          {a?.how === 'direct'
                            ? q.direct
                            : a?.how === 'approval'
                              ? q.approval
                              : '—'}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </div>
            </div>

            {/* 4 — the store's own portal */}
            <div className="rs__panel" data-on={i === 3 || undefined}>
              <p className="rs__bar">
                <span className="rs__ico">
                  <Store size={11} strokeWidth={2.5} />
                </span>
                <b>Their store, their login</b>
                <code>Catalogue</code>
              </p>
              <div className="rs__box rs__storeTbl">
                <span className="rs__sHead">
                  {r.storeColumns.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                  {r.hiddenColumns.map((c) => (
                    <span key={c} className="rs__gone">
                      {c}
                    </span>
                  ))}
                </span>
                {STORE_ROWS.map((row, k) => (
                  <span key={row.p} className="rs__sRow" style={at(k)}>
                    <span>{row.p}</span>
                    <span>{row.pay}</span>
                    <span>{row.band}</span>
                    <span>{row.rec}</span>
                    <span>{row.free}</span>
                    <i className="rs__hatch" style={at(k)} />
                    <i className="rs__hatch" style={at(k)} />
                  </span>
                ))}
              </div>
              <p className="rs__foot">
                {r.hiddenColumns.join(' and ')} — hidden from the store, on every screen it has.
              </p>
            </div>

            {/* 5 — a disagreement, settled */}
            <div className="rs__panel" data-on={i === 4 || undefined}>
              <p className="rs__bar">
                <b>Store dispute</b>
                <code>Settled</code>
              </p>
              <div className="rs__wallets">
                <span className="rs__wallet" data-party="store">
                  <span className="rs__label">The store&apos;s wallet</span>
                  <b>−{SETTLEMENT}</b>
                </span>
                <span className="rs__arrow">
                  <i className="rs__bead" />
                  <ArrowLeftRight size={12} strokeWidth={2.5} />
                </span>
                <span className="rs__wallet" data-party="seller">
                  <span className="rs__label">Your wallet</span>
                  <b>+{SETTLEMENT}</b>
                </span>
              </div>
              <div className="rs__box rs__locked">
                <span className="rs__ico rs__ico--flat">
                  <Lock size={11} strokeWidth={2.5} />
                </span>
                <span>
                  <b>Skydrop&apos;s wallet</b> — untouched. The money moves between your two wallets
                  — never from ours.
                </span>
              </div>
            </div>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}
