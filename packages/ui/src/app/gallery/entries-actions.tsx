'use client';

import {
  ArrowRight,
  Download,
  Package,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { Accordion, AccordionItem } from '../accordion';
import { AsyncButton } from '../async-button';
import { Button, ButtonLink } from '../button';
import { ConfirmDialog, Dialog, DialogFooter, SuccessDialog } from '../dialog';
import { LabelIntoParcel } from '../label-into-parcel';
import { MotionSwitch } from '../motion-switch';
import { PaperPlaneSendButton } from '../paper-plane-send';
import { ParachuteProgress } from '../parachute-progress';
import { Snackbar } from '../snackbar';
import { ThemeSwitch } from '../theme-switch';
import { ToastProvider, useToast } from '../toast';
import { GlossaryTerm, TooltipCard } from '../tooltip-card';
import { VanDriveOffButton } from '../van-drive-off';
import type { GalleryEntry } from './types';

/**
 * DEMO ONLY: a fake request that settles after ~900 ms. The primitives
 * never fake a result themselves — the gallery hands them this in place of
 * a real API call so every state can be reviewed.
 */
function demoRequest(ok: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (ok) resolve('ok');
      else reject(new Error('Demo: the server refused'));
    }, 900);
  });
}

const row = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } as const;

// ── Button ───────────────────────────────────────────────────────────
function ButtonRow({
  variant,
}: {
  variant: 'primary' | 'secondary' | 'ghost' | 'destructive';
}): ReactElement {
  return (
    <div style={row}>
      <Button variant={variant} size="sm">
        Small
      </Button>
      <Button variant={variant} icon={<Plus size={16} />} iconRight={<ArrowRight size={16} />}>
        Create order
      </Button>
      <Button variant={variant} size="lg">
        Large
      </Button>
      <Button variant={variant} disabled>
        Disabled
      </Button>
      <Button variant={variant} loading>
        Saving
      </Button>
    </div>
  );
}

// ── AsyncButton ──────────────────────────────────────────────────────
function AsyncDemo({ ok }: { ok: boolean }): ReactElement {
  return (
    <AsyncButton
      icon={<Send size={16} />}
      labels={{ idle: 'Publish', busy: 'Publishing', done: 'Published', error: 'Failed, retry' }}
      onAction={() => demoRequest(ok)}
    />
  );
}

// ── Storytelling: van, plane ─────────────────────────────────────────
/** DEMO ONLY: the storytelling buttons get a 700 ms fake request. */
function storyRequest(ok: boolean, delayMs = 700): Promise<string> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (ok) resolve('ok');
      else reject(new Error('Demo: the server refused'));
    }, delayMs);
  });
}

function VanDemo({ ok, whileBusy = false }: { ok: boolean; whileBusy?: boolean }): ReactElement {
  return (
    <VanDriveOffButton
      icon={<Truck size={16} />}
      label="Create order"
      busyLabel="Creating…"
      doneLabel="Order created"
      errorLabel="Not created, retry"
      {...(whileBusy ? { mode: 'while-busy' as const } : {})}
      onAction={() => storyRequest(ok, whileBusy ? 1800 : undefined)}
    />
  );
}

function PlaneDemo({ ok }: { ok: boolean }): ReactElement {
  const [text, setText] = useState('Thanks — the parcel was re-attempted today.');
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        aria-label="Reply"
        style={{ font: 'inherit', padding: 8, borderRadius: 8 }}
      />
      <PaperPlaneSendButton
        icon={<Send size={16} />}
        label="Send reply"
        busyLabel="Sending…"
        doneLabel="Reply sent"
        errorLabel="Not sent, retry"
        disabled={text.trim() === ''}
        onAction={() => storyRequest(ok)}
        onSettled={(outcome) => {
          if (outcome.ok) setText('');
        }}
      />
    </div>
  );
}

const reducedNote =
  'Reduced motion (Motion: reduced, or the OS setting): no morph — the button returns at once and a small green pill appears beside it.';

function ParachuteDemo(): ReactElement {
  const [value, setValue] = useState(0);
  const [state, setState] = useState<'running' | 'done' | 'failed'>('running');
  useEffect(() => {
    if (state !== 'running') return;
    const t = window.setInterval(() => {
      setValue((v) => {
        const next = Math.min(100, v + 7);
        if (next === 100) setState('done');
        return next;
      });
    }, 400);
    return () => window.clearInterval(t);
  }, [state]);
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <ParachuteProgress
        label="Importing 240 orders (demo)"
        value={value}
        state={state}
        detail={`${Math.round((value / 100) * 240)} of 240 rows`}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setValue(0);
          setState('running');
        }}
      >
        Run again
      </Button>
    </div>
  );
}

// ── Toast / snackbar ─────────────────────────────────────────────────
function ToastButtons(): ReactElement {
  const toast = useToast();
  return (
    <div style={row}>
      <Button variant="secondary" onClick={() => toast.success('Invitation resent')}>
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.error('[WALLET_TRANSFER_CAPITAL_SHORT] Our capital in HDFC cannot cover this.', {
            title: 'Transfer refused',
          })
        }
      >
        Error
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.info('Order SD-2026-38-000101 was moved to manual placement.', {
            title: 'Courier refused the parcel',
            action: { label: 'Open', onClick: () => undefined },
          })
        }
      >
        Info with action
      </Button>
    </div>
  );
}

function ToastDemo(): ReactElement {
  return (
    <ToastProvider>
      <ToastButtons />
    </ToastProvider>
  );
}

function SnackbarDemo({ sticky }: { sticky: boolean }): ReactElement {
  const [open, setOpen] = useState(true);
  return open ? (
    <Snackbar
      inline
      open={open}
      onClose={() => setOpen(false)}
      title="Courier rates updated"
      body="Shiprocket published new rates for 12 lanes."
      action={{ label: 'Review', onClick: () => undefined }}
      duration={sticky ? 0 : 7000}
    />
  ) : (
    <Button variant="secondary" onClick={() => setOpen(true)}>
      Show again
    </Button>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────
function DialogDemo({ critical }: { critical: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={critical ? 'Suspend this seller?' : 'Edit pickup window'}
        description="Changes apply from tomorrow's van."
        tone={critical ? 'critical' : 'default'}
        icon={critical ? <Trash2 size={18} /> : <Package size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={critical ? 'destructive' : 'primary'} onClick={() => setOpen(false)}>
              {critical ? 'Suspend' : 'Save'}
            </Button>
          </DialogFooter>
        }
      >
        <p style={{ margin: 0 }}>The body scrolls on its own; header and footer stay pinned.</p>
      </Dialog>
    </>
  );
}

function ConfirmDemo({ ok }: { ok: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <>
      <Button
        variant={ok ? 'primary' : 'destructive'}
        icon={<Wallet size={16} />}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {ok ? 'Refund ₹1,250' : 'Debit wallet'}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={ok ? 'Refund this ticket?' : 'Debit this wallet?'}
        entity="Menev Store"
        amount={<span>₹1,250.00</span>}
        consequence={
          ok
            ? "The seller's wallet is credited at once. (Demo: this one succeeds.)"
            : 'Their held cash becomes ours; beyond it the wallet goes negative. (Demo: this one is refused.)'
        }
        confirmLabel={ok ? 'Refund ₹1,250' : 'Debit ₹1,250'}
        destructive={!ok}
        error={error}
        onConfirm={() =>
          demoRequest(ok).catch((e: unknown) => {
            setError(`[DEMO_REFUSED] ${e instanceof Error ? e.message : 'Refused'}`);
            throw e;
          })
        }
      />
    </>
  );
}

function SuccessDemo(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Show success
      </Button>
      <SuccessDialog
        open={open}
        onOpenChange={setOpen}
        title="Consignment booked"
        body="CN-2026-09-000014 is expected at the Dhaka intake on Friday."
      />
    </>
  );
}

// ── Entries ──────────────────────────────────────────────────────────
export const ACTION_ENTRIES: readonly GalleryEntry[] = [
  {
    id: 'button',
    name: 'Button',
    patterns: ['u28'],
    usedFor: 'Every action: primary CTAs, table-row actions, dialog footers.',
    states: [
      {
        label: 'Primary (hover: gradient sweep, arrow steps right, glow)',
        render: () => <ButtonRow variant="primary" />,
      },
      { label: 'Secondary', render: () => <ButtonRow variant="secondary" /> },
      { label: 'Ghost', render: () => <ButtonRow variant="ghost" /> },
      { label: 'Destructive', render: () => <ButtonRow variant="destructive" /> },
      {
        label: 'ButtonLink (an <a>)',
        render: () => (
          <ButtonLink href="#button" iconRight={<ArrowRight size={16} />}>
            View all orders
          </ButtonLink>
        ),
      },
      {
        label: 'Full width',
        render: () => (
          <div style={{ maxWidth: 360 }}>
            <Button fullWidth icon={<ShieldCheck size={16} />}>
              Sign in
            </Button>
          </div>
        ),
      },
    ],
  },
  {
    id: 'async-button',
    name: 'Async button',
    patterns: ['rolling-label'],
    usedFor: 'Any button wired to a request that is not given a bigger sequence.',
    states: [
      { label: 'Idle → busy → done (demo request succeeds)', render: () => <AsyncDemo ok /> },
      { label: 'Idle → busy → error (demo request fails)', render: () => <AsyncDemo ok={false} /> },
      {
        label: 'Controlled phases',
        render: () => (
          <div style={row}>
            {(['idle', 'busy', 'success', 'error'] as const).map((p) => (
              <AsyncButton
                key={p}
                state={p}
                variant="secondary"
                icon={<Download size={16} />}
                labels={{ idle: 'Export', busy: 'Exporting', done: 'Exported', error: 'Failed' }}
              />
            ))}
          </div>
        ),
      },
    ],
  },
  {
    id: 'label-into-parcel',
    name: 'Label into parcel',
    patterns: ['label-into-icon'],
    usedFor: "Hover feedback on each app's one primary CTA; never delays the click.",
    states: [
      {
        label: 'Hover or focus it',
        render: () => (
          <LabelIntoParcel>
            <Button iconRight={<ArrowRight size={16} />}>Create order</Button>
          </LabelIntoParcel>
        ),
      },
      {
        label: 'On a link',
        render: () => (
          <LabelIntoParcel>
            <ButtonLink href="#label-into-parcel">Book a consignment</ButtonLink>
          </LabelIntoParcel>
        ),
      },
    ],
  },
  {
    id: 'van-drive-off',
    name: 'Van drive-off',
    patterns: ['van-drive-off'],
    usedFor:
      '"Create order": while-busy — the van IS the busy state and the page navigates on success; after-success — the van drives off once the request has succeeded.',
    states: [
      {
        label: 'While busy, success (the create-order mode; here the page stays, so it drives off)',
        render: () => <VanDemo ok whileBusy />,
      },
      {
        label: 'While busy, error: the van reverses into the red button',
        render: () => <VanDemo ok={false} whileBusy />,
      },
      { label: 'Success: 700 ms demo request, then the van', render: () => <VanDemo ok /> },
      { label: 'Error: shake + red, no van', render: () => <VanDemo ok={false} /> },
      { label: 'Reduced motion', render: () => <p style={{ maxWidth: 320 }}>{reducedNote}</p> },
    ],
  },
  {
    id: 'paper-plane-send',
    name: 'Paper-plane send',
    patterns: ['paper-plane-send'],
    usedFor: 'Ticket reply sent — the button folds into a plane after the real send.',
    states: [
      { label: 'Success: 700 ms demo send, then the plane', render: () => <PlaneDemo ok /> },
      { label: 'Error: shake + red, no plane', render: () => <PlaneDemo ok={false} /> },
      { label: 'Reduced motion', render: () => <p style={{ maxWidth: 320 }}>{reducedNote}</p> },
    ],
  },
  {
    id: 'parachute-progress',
    name: 'Parachute progress',
    patterns: ['parachute-progress'],
    usedFor: 'CSV import, bulk actions, any long operation with real progress.',
    states: [
      { label: 'Running → done (demo progress)', render: () => <ParachuteDemo /> },
      { label: 'Indeterminate', render: () => <ParachuteProgress label="Preparing the export" /> },
      {
        label: 'Failed',
        render: () => (
          <ParachuteProgress
            label="Importing 240 orders"
            value={42}
            state="failed"
            detail="[CSV_ROW_INVALID] Row 101: the PIN code has 5 digits."
          />
        ),
      },
    ],
  },
  {
    id: 'toast',
    name: 'Toast',
    patterns: ['u32'],
    usedFor: 'Fire-and-forget results: success, error verdicts, notices.',
    states: [
      {
        label: 'Hover a toast to pause it; four at most, newest on top',
        render: () => <ToastDemo />,
      },
    ],
  },
  {
    id: 'snackbar',
    name: 'Snackbar',
    patterns: ['u22'],
    usedFor: 'A system message that asks for one decision.',
    states: [
      {
        label: 'Auto-dismiss (7 s, pauses on hover)',
        render: () => <SnackbarDemo sticky={false} />,
      },
      { label: 'Sticky', render: () => <SnackbarDemo sticky /> },
    ],
  },
  {
    id: 'dialog',
    name: 'Dialog',
    patterns: ['u11'],
    usedFor: 'Forms and decisions that need the page to wait.',
    states: [
      { label: 'Default', render: () => <DialogDemo critical={false} /> },
      { label: 'Critical tone', render: () => <DialogDemo critical /> },
    ],
  },
  {
    id: 'confirm-dialog',
    name: 'Confirm dialog',
    patterns: ['u11'],
    usedFor: 'Money-moving and irreversible acts: restates entity, amount, consequence.',
    states: [
      { label: 'Confirm succeeds (demo) and closes', render: () => <ConfirmDemo ok /> },
      {
        label: 'Confirm refused (demo): verdict shown verbatim',
        render: () => <ConfirmDemo ok={false} />,
      },
    ],
  },
  {
    id: 'success-dialog',
    name: 'Success dialog',
    patterns: ['u11'],
    usedFor: 'A milestone worth a moment: a consignment booked, a store opened.',
    states: [{ label: 'Open it', render: () => <SuccessDemo /> }],
  },
  {
    id: 'tooltip-card',
    name: 'Tooltip card',
    patterns: ['u35'],
    usedFor: 'Glossary terms: RTO, Instant Pay, volumetric weight, STRICT, hidden share.',
    states: [
      {
        label: 'Glossary term in a sentence (hover, focus or tap)',
        render: () => (
          <p style={{ margin: 0, maxWidth: 460 }}>
            A parcel the customer refuses comes back as an{' '}
            <GlossaryTerm
              title="RTO — return to origin"
              description="The courier brings the parcel back to our warehouse. You pay delivery plus the return fee."
              points={['Charged when it is received back', 'Stock returns once inspected']}
            >
              RTO
            </GlossaryTerm>
            , and is inspected before it is sold again.
          </p>
        ),
      },
      {
        label: 'With an action',
        render: () => (
          <TooltipCard
            title="Instant Pay"
            description="COD is credited the moment a parcel is delivered, not when the courier pays."
            points={['A small fee on each COD', 'Switch it off any time']}
            action={
              <ButtonLink href="#tooltip-card" size="sm" variant="secondary">
                How it is charged
              </ButtonLink>
            }
          >
            <Button variant="ghost" size="sm">
              What is Instant Pay?
            </Button>
          </TooltipCard>
        ),
      },
    ],
  },
  {
    id: 'accordion',
    name: 'Accordion',
    patterns: ['u19'],
    usedFor: 'Help and FAQ, settings sections, grouped detail.',
    states: [
      {
        label: 'Single (one open at a time)',
        render: () => (
          <div style={{ maxWidth: 520 }}>
            <Accordion defaultValue="returns">
              <AccordionItem value="returns" title="Return policy" icon={<ShieldCheck size={18} />}>
                A returned parcel is received, inspected and put back into sellable stock or kept
                aside.
              </AccordionItem>
              <AccordionItem value="shipping" title="Shipping time" icon={<Truck size={18} />}>
                Delivery in 3–5 business days across India.
              </AccordionItem>
            </Accordion>
          </div>
        ),
      },
      {
        label: 'Multiple, with meta',
        render: () => (
          <div style={{ maxWidth: 520 }}>
            <Accordion type="multiple" defaultValue={['a']}>
              <AccordionItem value="a" title="Pickup" meta="2 vans" icon={<Truck size={18} />}>
                Delhivery at 16:00, Shiprocket at 17:30.
              </AccordionItem>
              <AccordionItem
                value="b"
                title="Labels"
                meta="12 to print"
                icon={<Package size={18} />}
              >
                Print from Warehouse → Printing.
              </AccordionItem>
              <AccordionItem value="c" title="Disabled" icon={<Package size={18} />} disabled>
                Not reachable.
              </AccordionItem>
            </Accordion>
          </div>
        ),
      },
    ],
  },
  {
    id: 'theme-switch',
    name: 'Theme switch',
    patterns: ['u14'],
    usedFor: 'The shell: System / Light / Dark. (Acts on this page for real.)',
    states: [{ label: 'Arrow keys move the knob', render: () => <ThemeSwitch /> }],
  },
  {
    id: 'motion-switch',
    name: 'Motion switch',
    patterns: [],
    usedFor: 'Per-user "Motion: full / reduced" in account settings. (Acts on this page for real.)',
    states: [{ label: 'Toggle it', render: () => <MotionSwitch /> }],
  },
];
