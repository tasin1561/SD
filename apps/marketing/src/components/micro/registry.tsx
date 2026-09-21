'use client';

import { useRef, useState, type ReactElement } from 'react';
import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import { sleep } from './motion';
import { useAsyncState } from './use-async-state';
import { ParachuteProgress } from './parachute-progress';
import { VanSubmitButton } from './van-drive-off';
import { PaperPlaneSend } from './paper-plane-send';
import { GlowField } from './glow-field';
import { RollingLabelButton } from './rolling-label-button';
import { LabelIntoParcel } from './label-into-parcel';
import { ExpandingTrackField } from './expanding-track-field';
import { LiquidBead } from './liquid-bead';
import { RadialContactFan } from './radial-contact-fan';
import { SegmentedCode, type CodeVerdict } from './segmented-code';
import { SceneSwitcher } from './scene-switcher';
import { Odometer } from './odometer';
import { ReactiveMascot } from './reactive-mascot';
import { DoorLink } from './door-hover';
import { ConnectorDraw } from './connector-draw';

/**
 * Every micro pattern, with a DEMO that drives it through its states. The
 * gallery renders this list; `check-micro-size.mjs` reads the folders.
 * "Where it ships" is the contract with the page — a pattern used
 * anywhere else needs the same argument the plan made for it.
 */
export interface MicroEntry {
  id: string;
  n: number;
  name: string;
  where: string;
  Demo: () => ReactElement;
}

const fakeTask =
  (ok: boolean, ms = 900) =>
  async (): Promise<string> => {
    await sleep(ms);
    if (!ok) throw new Error('refused');
    return 'ok';
  };

function ParachuteDemo(): ReactElement {
  return (
    <div className="flex flex-wrap gap-6">
      <ParachuteProgress
        label="Calculate"
        task={fakeTask(true, 1200)}
        successLabel={() => 'Estimated ৳650'}
      />
      <ParachuteProgress
        label="Calculate (fails)"
        task={fakeTask(false, 1200)}
        successLabel={() => ''}
        errorLabel="Could not price this — talk to us"
      />
    </div>
  );
}
function VanDemo(): ReactElement {
  const ok = useAsyncState({ minBusyMs: 700, settleMs: Infinity });
  const bad = useAsyncState({ minBusyMs: 700, settleMs: Infinity });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ok.run(fakeTask(true));
        }}
      >
        <VanSubmitButton
          phase={ok.phase}
          label="Request an invite"
          successLabel="Request received"
          errorLabel="Could not send"
        />
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void bad.run(fakeTask(false));
        }}
      >
        <VanSubmitButton
          phase={bad.phase}
          label="Request (fails)"
          successLabel="Request received"
          errorLabel="email must be an email"
        />
      </form>
      <button
        type="button"
        className="text-sm text-blue-text underline"
        onClick={() => {
          ok.reset();
          bad.reset();
        }}
      >
        reset
      </button>
    </div>
  );
}
function PlaneDemo(): ReactElement {
  const [email, setEmail] = useState('');
  const s = useAsyncState({ minBusyMs: 1100, settleMs: Infinity });
  const valid = /.+@.+\..+/.test(email);
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(fakeTask(true));
      }}
    >
      <GlowField
        valid={valid}
        type="email"
        placeholder="you@store.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email"
        action={<PaperPlaneSend phase={s.phase} valid={valid} />}
      />
      <p className="text-xs text-fg-muted">
        Gallery only — `features.newsletter` is off until an endpoint exists. Type a valid address
        to enable the button.
      </p>
    </form>
  );
}
function GlowDemo(): ReactElement {
  const [v, setV] = useState('');
  return (
    <GlowField
      valid={v.trim().length >= 6}
      placeholder="Waybill (≥ 6 chars turns it green)"
      value={v}
      onChange={(e) => setV(e.target.value)}
      aria-label="Waybill"
      action={
        <span className="pr-3 text-xs text-fg-muted">
          {v.trim().length >= 6 ? 'valid' : 'typing…'}
        </span>
      }
    />
  );
}
function RollDemo(): ReactElement {
  const ok = useAsyncState({ minBusyMs: 900, settleMs: 1600 });
  const bad = useAsyncState({ minBusyMs: 900, settleMs: 1600 });
  return (
    <div className="flex flex-wrap gap-4">
      <RollingLabelButton
        phase={ok.phase}
        labels={{ idle: 'Publish', busy: 'Publishing…', success: 'Published', error: 'Failed' }}
        onClick={() => void ok.run(fakeTask(true))}
      />
      <RollingLabelButton
        phase={bad.phase}
        labels={{
          idle: 'Publish (fails)',
          busy: 'Publishing…',
          success: 'Published',
          error: 'Failed — try again',
        }}
        onClick={() => void bad.run(fakeTask(false))}
      />
    </div>
  );
}
function LipDemo(): ReactElement {
  return (
    <LabelIntoParcel
      href="mailto:hello@skydrop.online"
      label="Send message"
      packedLabel="Opening your mail app…"
    />
  );
}
function EtfDemo(): ReactElement {
  const [last, setLast] = useState('');
  return (
    <div className="flex items-center gap-4">
      <ExpandingTrackField onSubmit={setLast} />
      <span className="text-xs text-fg-muted">
        {last
          ? `would navigate to track.skydrop.online?awb=${last}`
          : 'submits by navigation — nothing is faked'}
      </span>
    </div>
  );
}
const BEAD_TABS = [
  { id: 'stock', label: 'Stock-in', hue: 'teal' },
  { id: 'cat', label: 'Catalogue', hue: 'violet' },
  { id: 'orders', label: 'Orders', hue: 'saffron' },
  { id: 'returns', label: 'Returns', hue: 'magenta' },
  { id: 'money', label: 'Money', hue: 'green' },
  { id: 'team', label: 'Team', hue: 'blue' },
];
function BeadDemo(): ReactElement {
  const [v, setV] = useState('stock');
  return <LiquidBead tabs={BEAD_TABS} value={v} onChange={setV} label="Platform groups" />;
}
function FanDemo(): ReactElement {
  return (
    <div className="flex h-44 items-end justify-end pr-2">
      <RadialContactFan
        items={[
          {
            id: 'wa',
            icon: <MessageCircle size={18} />,
            label: 'WhatsApp',
            href: '#',
            external: true,
          },
          { id: 'call', icon: <Phone size={18} />, label: 'Call', href: '#' },
          { id: 'mail', icon: <Mail size={18} />, label: 'Email', href: '#' },
          {
            id: 'copy',
            icon: <Copy size={18} />,
            label: 'Copy hotline',
            doneLabel: 'Number copied',
            failLabel: 'Could not copy',
            action: async () => navigator.clipboard.writeText('+880 1XXX-XXXXXX'),
          },
        ]}
      />
    </div>
  );
}
function SegDemo(): ReactElement {
  const [len, setLen] = useState(6);
  const verify = (code: string): CodeVerdict =>
    code.startsWith('9')
      ? { ok: false, detail: 'Not yet — talk to us' }
      : { ok: true, detail: len === 6 ? '4–7 days to this PIN' : '3–5 days to this postcode' };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`rounded-md border px-2 py-1 ${len === 6 ? 'border-blue-text text-blue-text' : 'border-line text-fg-muted'}`}
          onClick={() => setLen(6)}
        >
          India PIN (6)
        </button>
        <button
          type="button"
          className={`rounded-md border px-2 py-1 ${len === 4 ? 'border-blue-text text-blue-text' : 'border-line text-fg-muted'}`}
          onClick={() => setLen(4)}
        >
          BD postcode (4)
        </button>
        <span className="self-center text-fg-faint">a code starting with 9 is refused</span>
      </div>
      <SegmentedCode length={len} verify={verify} />
    </div>
  );
}
function SceneDemo(): ReactElement {
  const box = (hue: string): ReactElement => (
    <svg viewBox="0 0 120 120" className="mx-auto h-40 w-40">
      <polygon points="60,10 110,35 60,60 10,35" fill={`var(--${hue}-300)`} />
      <polygon points="10,35 60,60 60,110 10,85" fill={`var(--${hue}-600)`} />
      <polygon points="60,60 110,35 110,85 60,110" fill={`var(--${hue}-800)`} />
    </svg>
  );
  const scenes = [
    {
      id: 'in',
      hue: 'saffron',
      label: 'Send to India',
      ghost: 'INDIA',
      art: box('saffron'),
      content: (
        <div>
          <h3 className="text-2xl font-bold text-fg-strong">Send to India</h3>
          <p className="mt-2 text-fg-body">
            Stock waits in our warehouse; orders are confirmed by phone and delivered by India's
            couriers.
          </p>
        </div>
      ),
    },
    {
      id: 'bd',
      hue: 'green',
      label: 'Send to Bangladesh',
      ghost: 'DHAKA',
      art: box('green'),
      content: (
        <div>
          <h3 className="text-2xl font-bold text-fg-strong">Send to Bangladesh</h3>
          <p className="mt-2 text-fg-body">The corridor the other way.</p>
        </div>
      ),
    },
    {
      id: 'imp',
      hue: 'teal',
      label: 'Import',
      ghost: 'IMPORT',
      art: box('teal'),
      content: (
        <div>
          <h3 className="text-2xl font-bold text-fg-strong">Import</h3>
          <p className="mt-2 text-fg-body">Straight to India or via our Dhaka warehouse.</p>
        </div>
      ),
    },
    {
      id: 'exp',
      hue: 'violet',
      label: 'Export',
      ghost: 'EXPORT',
      art: box('violet'),
      content: (
        <div>
          <h3 className="text-2xl font-bold text-fg-strong">Export</h3>
          <p className="mt-2 text-fg-body">Your catalogue, on sale in another country.</p>
        </div>
      ),
    },
  ];
  return <SceneSwitcher scenes={scenes} label="Services" />;
}
function OdoDemo(): ReactElement {
  const [v, setV] = useState(18240);
  return (
    <div className="flex items-center gap-6">
      <Odometer value={v} className="text-5xl font-bold text-fg-strong" />
      <button
        type="button"
        className="text-sm text-blue-text underline"
        onClick={() => setV((x) => x + 1137)}
      >
        +1,137
      </button>
    </div>
  );
}
function MascotDemo(): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  const [mood, setMood] = useState<'neutral' | 'happy'>('neutral');
  return (
    <div className="flex items-end gap-4">
      <ReactiveMascot watch={ref} mood={mood} />
      <input
        ref={ref}
        className="h-11 rounded-md border border-border-control bg-surface-input px-3 text-fg-strong"
        placeholder="Type — the eyes follow the caret"
        aria-label="Demo field"
      />
      <button
        type="button"
        className="text-sm text-blue-text underline"
        onClick={() => {
          setMood('happy');
          window.setTimeout(() => setMood('neutral'), 1200);
        }}
      >
        success
      </button>
    </div>
  );
}
function DoorDemo(): ReactElement {
  return (
    <div className="flex gap-4">
      <DoorLink href="#" label="Seller sign-in" />
      <DoorLink href="#" label="Store sign-in" />
    </div>
  );
}
function ConnDemo(): ReactElement {
  return (
    <div className="max-w-xl">
      <ConnectorDraw steps={4} className="h-6 w-full" />
      <div className="mt-1 grid grid-cols-4 text-center text-xs text-fg-muted">
        <span>Stock in</span>
        <span>Call</span>
        <span>Pick & pack</span>
        <span>Deliver</span>
      </div>
    </div>
  );
}

export const MICRO_REGISTRY: readonly MicroEntry[] = [
  {
    id: 'parachute-progress',
    n: 1,
    name: 'Parachute progress',
    where: 'Quote "Calculate" · the general loading motif',
    Demo: ParachuteDemo,
  },
  {
    id: 'van-drive-off',
    n: 2,
    name: 'Van drive-off',
    where: 'The invite form — the ONE real in-page submit',
    Demo: VanDemo,
  },
  {
    id: 'paper-plane-send',
    n: 3,
    name: 'Paper-plane send',
    where: 'Newsletter (gallery only until an endpoint exists)',
    Demo: PlaneDemo,
  },
  {
    id: 'glow-field',
    n: 4,
    name: 'Glow field',
    where: 'Every field; the partner button enables on valid',
    Demo: GlowDemo,
  },
  {
    id: 'rolling-label-button',
    n: 5,
    name: 'Rolling-label state button',
    where: 'State buttons; ≤350 ms press feedback on Track',
    Demo: RollDemo,
  },
  {
    id: 'label-into-parcel',
    n: 6,
    name: 'Label-into-parcel',
    where: 'Contact "Send" (mailto / WhatsApp) — hover only',
    Demo: LipDemo,
  },
  {
    id: 'expanding-track-field',
    n: 7,
    name: 'Expanding track field',
    where: 'Compact Track control (header on mobile, utility bar)',
    Demo: EtfDemo,
  },
  {
    id: 'liquid-bead',
    n: 8,
    name: 'Liquid bead',
    where: 'Platform tabs · FAQ categories · freight-mode selector',
    Demo: BeadDemo,
  },
  {
    id: 'radial-contact-fan',
    n: 9,
    name: 'Radial contact fan',
    where: 'The floating contact control',
    Demo: FanDemo,
  },
  {
    id: 'segmented-code',
    n: 10,
    name: 'Segmented code → link-and-merge',
    where: 'The serviceability checker (6 digits IN, 4 BD)',
    Demo: SegDemo,
  },
  {
    id: 'scene-switcher',
    n: 11,
    name: 'Scene switcher',
    where: 'The services showcase — four scenes, one component',
    Demo: SceneDemo,
  },
  { id: 'odometer', n: 12, name: 'Odometer', where: 'Trust row + KPI card figures', Demo: OdoDemo },
  {
    id: 'reactive-mascot',
    n: 13,
    name: 'Reactive mascot',
    where: 'Optional, on the contact card (Phase 7 polish)',
    Demo: MascotDemo,
  },
  {
    id: 'door-hover',
    n: 14,
    name: 'Door hover',
    where: 'Store / seller sign-in links (Phase 7 polish)',
    Demo: DoorDemo,
  },
  {
    id: 'connector-draw',
    n: 15,
    name: 'Connector draw',
    where: 'How it works — the four steps join as you scroll',
    Demo: ConnDemo,
  },
];

/** A marker `check-bundle.mjs` uses to find the gallery chunk in a preview build. */
export const __SD_MICRO_GALLERY__ = 'micro-gallery';
