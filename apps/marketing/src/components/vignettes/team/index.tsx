'use client';

import type { CSSProperties, ReactElement } from 'react';
import { Bell, Building2, KeyRound, Lock, Users } from 'lucide-react';
import { DrawToggle } from '@/components/micro/touches';
import { tourTeam as c } from '@/content/sections/tour-team';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './team.css';

export const __SD_VIGNETTE__ = 'team';

const ORDER = c.beats.map((b) => b.id);

/** A child's place in its stagger; the delay arithmetic is in the CSS. */
const at = (k: number): CSSProperties => ({ '--i': k }) as CSSProperties;

/**
 * Four sample people on three roles — two of them share one, which is
 * what makes "a role is a set of permissions" mean something: change
 * Ops and both of them change with it.
 */
const MEMBERS: ReadonlyArray<{ initials: string; name: string; role: string }> = [
  { initials: 'TR', name: 'Tanvir R.', role: 'Owner' },
  { initials: 'SA', name: 'Sadia A.', role: 'Ops' },
  { initials: 'MH', name: 'Mahin H.', role: 'Ops' },
  { initials: 'NK', name: 'Nusrat K.', role: 'Finance' },
];

/** The role register's own names, as the member rows carry them. */
const ROLES = ['Owner', 'Ops', 'Finance'] as const;
/** Which of the three the permission list below belongs to. */
const ROLE_SHOWN = 1;

/**
 * Three of the thirty-five permission labels, straight out of the
 * seller catalogue's Orders group — never a restatement, because the
 * label is what somebody reads before granting it.
 */
const PERMISSIONS: ReadonlyArray<{ label: string; on: boolean }> = [
  { label: 'See orders', on: true },
  { label: 'Place an order', on: true },
  { label: 'Cancel an order', on: false },
];

/** `/notifications/settings` · 01 — a PERSON's own topics, by group. */
const TOPICS: ReadonlyArray<{ label: string; topic: string }> = [
  { label: 'Order dispatched', topic: 'seller.order_dispatched' },
  { label: 'Delivery attempt failed', topic: 'seller.order_delivery_failed' },
];

/** `/notifications/settings` · 02 — the COMPANY's categories. */
const CATEGORIES: ReadonlyArray<{ label: string; on: boolean }> = [
  { label: 'Order updates', on: true },
  { label: 'Stock alerts', on: false },
];

/**
 * The four terms, in the panel's own shape: the setting's display name,
 * the value, and the sentence that says what it does. No control beside
 * any of them, because there is none behind them either — these are set
 * per account by us, and a seller who could raise their own cap would
 * not have one.
 */
const LIMITS: ReadonlyArray<{ label: string; value: string; hint: string }> = [
  {
    label: 'Delivery fee — currency',
    value: 'BDT',
    hint: 'Agreed in taka, charged in rupees at the rate on the day.',
  },
  {
    label: 'Who picks the courier',
    value: 'Cheapest within 5 days',
    hint: 'The lowest rate among the ones that still arrive in time.',
  },
  {
    label: 'Call attempts before NDR',
    value: '3 attempts',
    hint: 'After that the order stops and waits on your decision.',
  },
  {
    label: 'COD credited',
    value: '7 days after delivery',
    hint: 'Once the courier has settled that parcel with us.',
  },
];

/**
 * 13 · Platform tour — YOUR TEAM. Three beats in one 4:3 frame: the
 * member register beside the role whose permissions it is carrying; the
 * notification page's two grains, one above the other, each saying whose
 * decision it is; and the read-only limits panel.
 *
 * Every beat's state is an attribute on the mock root — `data-beat`
 * picks the scene and re-runs its entrance, `data-reduced` switches
 * every animation off. The CSS base state IS each beat's finished
 * frame, so reduced motion lands there with no second set of rules.
 *
 * The switches are the real `DrawToggle`, `readOnly` and out of the tab
 * order: the mock is a picture made of DOM, inside the frame's
 * `aria-hidden` box, and the same words are in the caption strip and
 * the checklist beside it.
 */
export default function TeamVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });

  return (
    <div className="vg vg-team">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={ORDER}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-team__mock" data-beat={beats.index} data-reduced={beats.reducedMotion}>
          {/* 1 · the member register, and the role behind it */}
          <div className="vg-team__scene" data-scene="0">
            <p className="vg-team__h">
              <span className="vg-team__ico">
                <Users size={11} strokeWidth={2.5} />
              </span>
              Member register
              <i className="vg-team__note tabular">4 people</i>
            </p>
            <div className="vg-team__split">
              <ul className="vg-team__card vg-team__list">
                {MEMBERS.map((m, k) => (
                  <li key={m.initials} className="vg-team__who" style={at(k)}>
                    <span className="vg-team__av" aria-hidden>
                      {m.initials}
                    </span>
                    <b className="vg-team__name">{m.name}</b>
                    <span className="vg-team__chip">{m.role}</span>
                  </li>
                ))}
              </ul>

              <div className="vg-team__card vg-team__roles">
                <span className="vg-team__th">
                  <span className="vg-team__ico">
                    <KeyRound size={11} strokeWidth={2.5} />
                  </span>
                  <b>Roles</b>
                </span>
                <p className="vg-team__tabs" style={{ '--at': ROLE_SHOWN } as CSSProperties}>
                  {ROLES.map((r, k) => (
                    <span key={r} className="vg-team__tab" data-on={k === ROLE_SHOWN || undefined}>
                      {r}
                    </span>
                  ))}
                  <i className="vg-team__bead" />
                </p>
                <p className="vg-team__say">A role is a set of permissions.</p>
                <span className="vg-team__grp">Orders</span>
                <ul className="vg-team__perms">
                  {PERMISSIONS.map((p, k) => (
                    <li key={p.label} className="vg-team__perm" style={at(k)} data-on={p.on}>
                      <span>{p.label}</span>
                      <DrawToggle
                        label=""
                        aria-label={p.label}
                        checked={p.on}
                        readOnly
                        tabIndex={-1}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="vg-team__foot">
              Owners and admins can change roles or remove members — and everyone on that role
              changes with it.
            </p>
          </div>

          {/* 2 · two grains of notification setting, on one page */}
          <div className="vg-team__scene" data-scene="1">
            <div className="vg-team__card" style={at(0)}>
              <span className="vg-team__th">
                <span className="vg-team__ico">
                  <Bell size={11} strokeWidth={2.5} />
                </span>
                <b>What reaches you</b>
              </span>
              <p className="vg-team__say">Your own choices, for your own inbox.</p>
              <span className="vg-team__grp">
                Shipments
                <em className="tabular">2 of 2 on</em>
              </span>
              <ul className="vg-team__perms">
                {TOPICS.map((t, k) => (
                  <li key={t.topic} className="vg-team__perm" style={at(k)} data-on>
                    <span>
                      {t.label}
                      <code className="vg-team__key">{t.topic}</code>
                    </span>
                    <DrawToggle label="" aria-label={t.label} checked readOnly tabIndex={-1} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="vg-team__card" style={at(1)}>
              <span className="vg-team__th">
                <span className="vg-team__ico">
                  <Building2 size={11} strokeWidth={2.5} />
                </span>
                <b>The company&rsquo;s email</b>
              </span>
              <p className="vg-team__say">Applies to everyone here, not only you.</p>
              <ul className="vg-team__perms">
                {CATEGORIES.map((x, k) => (
                  <li key={x.label} className="vg-team__perm" style={at(k)} data-on={x.on}>
                    <span>{x.label}</span>
                    <span className="vg-team__email">
                      Email
                      <DrawToggle
                        label=""
                        aria-label={`Email ${x.label}`}
                        checked={x.on}
                        readOnly
                        tabIndex={-1}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="vg-team__foot">
              Changing one here does not change what anybody else receives.
            </p>
          </div>

          {/* 3 · the terms set for this account, read-only */}
          <div className="vg-team__scene" data-scene="2">
            <p className="vg-team__h">
              <span className="vg-team__ico">
                <Lock size={11} strokeWidth={2.5} />
              </span>
              Your limits
              <i className="vg-team__note">Read only</i>
            </p>
            <p className="vg-team__say">
              Set by Skydrop &mdash; shown so a limit is never a surprise.
            </p>
            <dl className="vg-team__card vg-team__terms">
              {LIMITS.map((t, k) => (
                <div key={t.label} className="vg-team__term" style={at(k)}>
                  <dt>
                    {t.label}
                    <small>{t.hint}</small>
                  </dt>
                  <dd className="tabular">{t.value}</dd>
                </div>
              ))}
            </dl>
            <p className="vg-team__foot">Ask us if one of these looks wrong for your account.</p>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}
