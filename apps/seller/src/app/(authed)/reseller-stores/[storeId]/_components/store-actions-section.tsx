'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { CircleDot } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Switch } from '@skydrop/ui/app/switch';
import { Select } from '@skydrop/ui/app/select';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  ACTION_CAPABILITIES,
  useSetStoreActionPolicy,
  useStoreActionPolicy,
  type ActionCapability,
  type StoreActionMode,
} from '@/lib/reseller-store-hooks';
import { RsError, RsSection } from '../../_components/rs-parts';

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
 * Drawn as a matrix: one row per task, the first question as a Yes/No
 * switch (the answer is a word in the track, not only a colour), the
 * second as a select that appears only on Yes — the same two questions,
 * in the same words, in the same order.
 *
 * The whole policy is sent on save because the server takes all seven.
 * Save asks first (owner's decision), restating the store and every task
 * whose answer changed; only the confirmation sends it.
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
    key: 'orderChange',
    label: 'Change the order',
    what:
      'Correct the customer’s details, change what is in the parcel or the money the customer pays. ' +
      'Once the order is confirmed only the customer’s details can change, and once it is with the ' +
      'courier only they can accept it.',
    direct: 'Directly: the change is written onto the order as soon as the store sends it.',
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

/** One answer, in the screen's own words — for the confirmation's list of changes. */
function answerWords(mode: StoreActionMode): string {
  if (mode === 'OFF') return 'No';
  return `Yes, ${HOW_OPTIONS.find((o) => o.value === howOf(mode))?.label.toLowerCase() ?? ''}`;
}

export function StoreActionsSection({
  storeId,
  storeName,
  final,
}: {
  storeId: string;
  storeName: string;
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
  const [confirming, setConfirming] = useState(false);

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

  if (policy.isPending) return <SkeletonRows rows={4} cols={3} label="Loading what they can do" />;
  if (policy.isError) {
    return <ErrorState message={serverVerdict(policy.error)} retry={() => void policy.refetch()} />;
  }
  if (draft === null || lastHow === null) {
    return <SkeletonRows rows={4} cols={3} label="Loading what they can do" />;
  }

  const dirty = ACTION_CAPABILITIES.some((c) => draft[c] !== policy.data[c]);
  const changed = CAPABILITIES.filter((c) => draft[c.key] !== policy.data[c.key]);

  async function submit(): Promise<void> {
    if (draft === null) return;
    setError(null);
    try {
      await save.mutateAsync({ storeId, policy: draft });
      toast.success('Saved. The Reseller store sees this the next time it asks for something.');
    } catch (err) {
      // Verbatim (FE-2): STORE_NOT_FOUND, and anything else the server says.
      setError(serverVerdict(err));
      // Rethrown so the confirmation stays open with the verdict on it.
      throw err;
    }
  }

  return (
    <RsSection
      title="What they can do"
      note={
        policy.data.set
          ? 'Your settings for this store.'
          : 'Running on the defaults — you have not set this store yet.'
      }
      flush
    >
      <div className="rs-card__pad">
        <p className="rs-muted">
          For each task: can the Reseller store do it, and if so, does it happen directly or does it
          need Seller staff&apos;s approval first? Whatever you choose, the store is emailed what
          happened — when Seller staff approve something it is told whether it was carried out, and
          when they turn it down it is sent the reason.
        </p>
      </div>
      <Table caption="What the Reseller store can do">
        <THead>
          <Tr>
            <Th>Task</Th>
            <Th>Can the Reseller store do this?</Th>
            <Th>How?</Th>
          </Tr>
        </THead>
        <TBody>
          {CAPABILITIES.map((c) => {
            const mode = draft[c.key];
            const allowed = mode !== 'OFF';
            const how: How = allowed ? howOf(mode) : lastHow[c.key];
            return (
              <Tr key={c.key}>
                <Td>
                  <div className="rs-task">
                    <span className="rs-task__label" id={`task-${c.key}`}>
                      {c.label}
                    </span>
                    <span className="rs-task__what">{c.what}</span>
                    <span className="rs-task__note">
                      {!allowed
                        ? 'No: the Reseller store is not offered this. Seller staff do it instead.'
                        : how === 'DIRECT'
                          ? c.direct
                          : APPROVAL_NOTE}
                    </span>
                  </div>
                </Td>
                <Td>
                  <Switch
                    id={`can-${c.key}`}
                    aria-label="Can the Reseller store do this?"
                    aria-describedby={`task-${c.key}`}
                    checked={allowed}
                    onText="Yes"
                    offText="No"
                    disabled={!canSave}
                    onCheckedChange={(yes) => {
                      if (!yes && allowed) setLastHow({ ...lastHow, [c.key]: howOf(mode) });
                      setDraft({ ...draft, [c.key]: yes ? lastHow[c.key] : 'OFF' });
                    }}
                  />
                </Td>
                <Td>
                  {allowed ? (
                    <Select
                      id={`how-${c.key}`}
                      aria-label="How?"
                      className="rs-how"
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
                  ) : null}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      {error !== null && !confirming ? (
        <div className="rs-card__pad">
          <RsError>{error}</RsError>
        </div>
      ) : null}

      {canSave ? (
        <div className="rs-savebar">
          <Button
            variant="primary"
            size="md"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Save
          </Button>
          {dirty ? (
            <span className="rs-dirty">
              <CircleDot size={12} aria-hidden />
              You have unsaved changes.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* A verdict stays under the matrix after "Back", as it always did;
          pressing Save again clears it. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save what this store can do?"
        entity={storeName}
        consequence="The Reseller store sees this the next time it asks for something."
        confirmLabel="Save"
        onConfirm={submit}
        error={error}
      >
        {changed.length > 0 ? (
          <ul className="rs-confirm-list">
            {changed.map((c) => (
              <li key={c.key}>
                <b>{c.label}:</b> {answerWords(policy.data[c.key])} → {answerWords(draft[c.key])}
              </li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
    </RsSection>
  );
}
