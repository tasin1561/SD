'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  FormField,
  LoadingState,
  Section,
  Select,
  useToast,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  ACTION_CAPABILITIES,
  useSetStoreActionPolicy,
  useStoreActionPolicy,
  type ActionCapability,
  type StoreActionMode,
} from '@/lib/reseller-store-hooks';

/**
 * What a Reseller store may do about a live order, asked the way the owner
 * asks it (2026-09-17): TWO questions per task.
 *
 *   1. Can the Reseller store do this?  Yes / No
 *   2. Only when Yes — How?            Directly / Needs my approval
 *
 * Stored as one of three values (No = OFF, Yes + Needs my approval =
 * ASK_SELLER, Yes + Directly = DIRECT); only the screen changed. Every
 * answer here is one the server honours for all seven tasks: "Needs my
 * approval" always sends the request to Seller staff to approve or reject.
 *
 * The whole policy is sent on save because the server takes all seven.
 */

type How = 'DIRECT' | 'ASK_SELLER';

const HOW_OPTIONS: ReadonlyArray<{ value: How; label: string }> = [
  { value: 'DIRECT', label: 'Directly' },
  { value: 'ASK_SELLER', label: 'Needs my approval' },
];

/**
 * What each task IS, and what "Directly" actually does — which differs by
 * task, and used to be described wrongly for sending a parcel back.
 */
const CAPABILITIES: ReadonlyArray<{
  key: ActionCapability;
  label: string;
  what: string;
  direct: string;
}> = [
  {
    key: 'recall',
    label: 'Call the customer again',
    what: 'Our call centre rings the customer back and writes down what they said.',
    direct: 'Directly: the call is queued with our call centre the moment the store asks.',
  },
  {
    key: 'addressFix',
    label: 'Correct the address',
    what: 'Fix the delivery details before the order is confirmed.',
    direct: 'Directly: the new details are written onto the order as soon as the store sends them.',
  },
  {
    key: 'cancel',
    label: 'Call the order off',
    what: 'Cancel it before it is packed.',
    direct: 'Directly: the order is cancelled as soon as the store asks.',
  },
  {
    key: 'callCapDecision',
    label: 'Answer “keep trying?”',
    what: 'When we cannot reach the customer after several attempts, decide whether to keep calling or give up.',
    direct:
      'Directly: the store’s answer is applied straight away — giving up releases the stock and rejects the order.',
  },
  {
    key: 'chaseSkydrop',
    label: 'Raise it with Skydrop',
    what: 'Tell Skydrop a parcel is damaged, lost or late in its hands.',
    direct: 'Directly: the issue reaches Skydrop admin as soon as the store raises it.',
  },
  {
    key: 'reattempt',
    label: 'Try delivering again',
    what: 'Ask the courier for another delivery attempt.',
    direct:
      'Directly: a ticket opens straight away and Skydrop admin passes the request to the courier.',
  },
  {
    key: 'sendBack',
    label: 'Send the parcel back',
    what: 'Turn a parcel round rather than keep trying. The return fee is split by your terms.',
    direct:
      'Directly: the courier is asked to return the parcel the moment the store clicks — nobody checks it first.',
  },
];

const APPROVAL_NOTE =
  'Needs my approval: the request comes to Seller staff to approve or reject, and nothing happens until then. A request nobody answers closes after a few days and the store is told.';

type Draft = Record<ActionCapability, StoreActionMode>;

function howOf(mode: StoreActionMode): How {
  return mode === 'DIRECT' ? 'DIRECT' : 'ASK_SELLER';
}

export function StoreActionsSection({
  storeId,
  final,
}: {
  storeId: string;
  final: boolean;
}): ReactElement {
  const policy = useStoreActionPolicy(storeId);
  const save = useSetStoreActionPolicy();
  const identity = useSellerIdentity();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  // What "How?" was last set to per task, so answering No and then Yes
  // again brings the earlier choice back rather than silently picking one.
  const [lastHow, setLastHow] = useState<Record<ActionCapability, How> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The server's answer is the starting point; a later refetch must not
  // throw away what the seller has changed since, so this only seeds.
  useEffect(() => {
    if (policy.data === undefined || draft !== null) return;
    const seeded = {} as Draft;
    const hows = {} as Record<ActionCapability, How>;
    for (const c of ACTION_CAPABILITIES) {
      seeded[c] = policy.data[c];
      hows[c] = howOf(policy.data[c]);
    }
    setDraft(seeded);
    setLastHow(hows);
  }, [policy.data, draft]);

  // COSMETIC (FE-2): the API refuses a save without `stores.manage`.
  const canSave = can(identity, 'stores.manage') && !final;

  if (policy.isPending) return <LoadingState label="Loading what they can do" rows={4} />;
  if (policy.isError) {
    return <ErrorState message={serverVerdict(policy.error)} retry={() => void policy.refetch()} />;
  }
  if (draft === null || lastHow === null) {
    return <LoadingState label="Loading what they can do" rows={4} />;
  }

  const dirty = ACTION_CAPABILITIES.some((c) => draft[c] !== policy.data[c]);

  async function submit(): Promise<void> {
    if (draft === null) return;
    setError(null);
    try {
      await save.mutateAsync({ storeId, policy: draft });
      toast.success('Saved. The Reseller store sees this the next time it asks for something.');
    } catch (err) {
      // Verbatim (FE-2): STORE_NOT_FOUND, and anything else the server says.
      setError(serverVerdict(err));
    }
  }

  return (
    <Section
      title="What they can do"
      subtitle="For each task: can the Reseller store do it, and if so, does it happen directly or does it need Seller staff's approval first?"
    >
      <Card>
        <CardHeader
          title={
            policy.data.set
              ? 'Your settings for this store'
              : 'Running on the defaults — you have not set this store yet'
          }
          subtitle="Whatever you choose, the store is emailed what happened: when Seller staff approve something it is told whether it was carried out, and when they turn it down it is sent the reason."
        />
        <CardBody>
          <div className="space-y-4">
            {CAPABILITIES.map((c) => {
              const mode = draft[c.key];
              const allowed = mode !== 'OFF';
              const how: How = allowed ? howOf(mode) : lastHow[c.key];
              return (
                <div
                  key={c.key}
                  className="border-border/60 flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <p className="text-text-bright text-sm font-medium">{c.label}</p>
                    <p className="text-text-muted mt-0.5 text-xs">{c.what}</p>
                    <p className="text-text-faint mt-1 text-xs">
                      {!allowed
                        ? 'No: the Reseller store is not offered this. Seller staff do it instead.'
                        : how === 'DIRECT'
                          ? c.direct
                          : APPROVAL_NOTE}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:w-64 sm:shrink-0">
                    <FormField label="Can the Reseller store do this?" htmlFor={`can-${c.key}`}>
                      <Select
                        id={`can-${c.key}`}
                        value={allowed ? 'YES' : 'NO'}
                        disabled={!canSave}
                        onChange={(e) => {
                          const yes = e.target.value === 'YES';
                          if (!yes && allowed) setLastHow({ ...lastHow, [c.key]: howOf(mode) });
                          setDraft({ ...draft, [c.key]: yes ? lastHow[c.key] : 'OFF' });
                        }}
                      >
                        <option value="YES">Yes</option>
                        <option value="NO">No</option>
                      </Select>
                    </FormField>
                    {allowed ? (
                      <FormField label="How?" htmlFor={`how-${c.key}`}>
                        <Select
                          id={`how-${c.key}`}
                          value={how}
                          disabled={!canSave}
                          onChange={(e) => {
                            const next = e.target.value === 'DIRECT' ? 'DIRECT' : 'ASK_SELLER';
                            setLastHow({ ...lastHow, [c.key]: next });
                            setDraft({ ...draft, [c.key]: next });
                          }}
                        >
                          {HOW_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {error !== null ? (
            <p role="alert" className="text-critical mt-4 text-sm">
              {error}
            </p>
          ) : null}

          {canSave ? (
            <div className="mt-5 flex items-center gap-3">
              <Button
                variant="primary"
                size="md"
                disabled={!dirty || save.isPending}
                onClick={() => void submit()}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {dirty ? (
                <span className="text-text-muted text-xs">You have unsaved changes.</span>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </Section>
  );
}
