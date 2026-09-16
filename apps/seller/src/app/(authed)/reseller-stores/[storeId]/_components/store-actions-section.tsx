'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
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
 * 2026-09-16 — what this store may do about a live order on its own, and
 * what has to come to the seller first.
 *
 * One row per capability, three choices each. The whole policy is sent on
 * save because the server takes all seven: a partial save would leave the
 * question of what an absent field meant, and the screen already knows
 * every answer it is showing.
 */

const MODES: ReadonlyArray<{ value: StoreActionMode; label: string }> = [
  { value: 'OFF', label: 'They cannot' },
  { value: 'ASK_SELLER', label: 'Ask me first' },
  { value: 'DIRECT', label: 'They can do it' },
];

/**
 * What each capability IS, in the seller's terms.
 *
 * `note` is the part a seller would otherwise have to find out by
 * watching it happen — that two of these still pass through Skydrop
 * whatever this page says, and that one of them is what the store has
 * been doing all along.
 */
const CAPABILITIES: ReadonlyArray<{
  key: ActionCapability;
  label: string;
  what: string;
  note?: string;
}> = [
  {
    key: 'recall',
    label: 'Call the customer again',
    what: 'Our call centre rings the customer back and writes down what they said.',
  },
  {
    key: 'addressFix',
    label: 'Correct the address',
    what: 'Fix the delivery details before the order is confirmed.',
  },
  {
    key: 'cancel',
    label: 'Call the order off',
    what: 'Cancel it before it is packed.',
    note: 'Stores can already do this today, so leaving it on changes nothing.',
  },
  {
    key: 'callCapDecision',
    label: 'Answer “keep trying?”',
    what: 'When we cannot reach the customer after several attempts, decide whether to keep calling or give up.',
  },
  {
    key: 'chaseSkydrop',
    label: 'Raise it with Skydrop',
    what: 'Tell us a parcel is damaged, lost or late in our hands.',
  },
  {
    key: 'reattempt',
    label: 'Try delivering again',
    what: 'Ask the courier for another delivery attempt.',
    note: '“They can do it” means the store asks us directly instead of asking you — Skydrop still carries it out.',
  },
  {
    key: 'sendBack',
    label: 'Send the parcel back',
    what: 'Turn a parcel round rather than keep trying. The return fee is split by your terms.',
    note: '“They can do it” means the store asks us directly instead of asking you — Skydrop still carries it out.',
  },
];

type Draft = Record<ActionCapability, StoreActionMode>;

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
  const [error, setError] = useState<string | null>(null);

  // The server's answer is the starting point; a later refetch must not
  // throw away what the seller has changed since, so this only seeds.
  useEffect(() => {
    if (policy.data === undefined || draft !== null) return;
    const seeded = {} as Draft;
    for (const c of ACTION_CAPABILITIES) seeded[c] = policy.data[c];
    setDraft(seeded);
  }, [policy.data, draft]);

  // COSMETIC (FE-2): the API refuses a save without `stores.manage`.
  const canSave = can(identity, 'stores.manage') && !final;

  if (policy.isPending) return <LoadingState label="Loading what they can do" rows={4} />;
  if (policy.isError) {
    return <ErrorState message={serverVerdict(policy.error)} retry={() => void policy.refetch()} />;
  }
  if (draft === null) return <LoadingState label="Loading what they can do" rows={4} />;

  const dirty = ACTION_CAPABILITIES.some((c) => draft[c] !== policy.data[c]);

  async function submit(): Promise<void> {
    if (draft === null) return;
    setError(null);
    try {
      await save.mutateAsync({ storeId, policy: draft });
      toast.success('Saved. The store sees this the next time it asks for something.');
    } catch (err) {
      // Verbatim (FE-2): STORE_NOT_FOUND, and anything else the server says.
      setError(serverVerdict(err));
    }
  }

  return (
    <Section
      title="What they can do"
      subtitle="Each of these is something the store might need doing about a live order. You decide which ones go straight through."
    >
      <Card>
        <CardHeader
          title={
            policy.data.set
              ? 'Your settings for this store'
              : 'Running on the defaults — you have not set this store yet'
          }
          subtitle="Whatever you choose, the store is emailed what happened: we tell them when you approve something, and when you turn it down we send them your reason."
        />
        <CardBody>
          <div className="space-y-4">
            {CAPABILITIES.map((c) => (
              <div
                key={c.key}
                className="border-border/60 flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="text-text-bright text-sm font-medium">{c.label}</p>
                  <p className="text-text-muted mt-0.5 text-xs">{c.what}</p>
                  {c.note === undefined ? null : (
                    <p className="text-text-faint mt-1 text-xs">{c.note}</p>
                  )}
                </div>
                <div className="sm:w-56 sm:shrink-0">
                  <Select
                    aria-label={c.label}
                    value={draft[c.key]}
                    disabled={!canSave}
                    onChange={(e) =>
                      setDraft({ ...draft, [c.key]: e.target.value as StoreActionMode })
                    }
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
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
