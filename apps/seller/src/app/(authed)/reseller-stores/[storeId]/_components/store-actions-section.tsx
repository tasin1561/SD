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
import { verdict } from '@/i18n/verdict';
import {
  ACTION_CAPABILITIES,
  useSetStoreActionPolicy,
  useStoreActionPolicy,
  type ActionCapability,
  type StoreActionMode,
} from '@/lib/reseller-store-hooks';
import { RsError, RsSection } from '../../_components/rs-parts';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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

const howOptionsOf = (t: Translate<MessageKey>): ReadonlyArray<{ value: How; label: string }> => [
  { value: 'DIRECT', label: t('resellerStoreDetail.directly') },
  { value: 'ASK_SELLER', label: t('resellerStoreDetail.needsMyApproval') },
];

/**
 * What each task IS, and what "Directly" actually does — which differs by
 * task, and used to be described wrongly for sending a parcel back.
 */
const capabilitiesOf = (
  t: Translate<MessageKey>,
): ReadonlyArray<{
  key: ActionCapability;
  label: string;
  what: string;
  direct: string;
}> => [
  {
    key: 'recall',
    label: t('resellerStoreDetail.callTheCustomerAgain'),
    what: t('resellerStoreDetail.ourCallCentreRings'),
    direct: t('resellerStoreDetail.directlyTheCallIs'),
  },
  {
    key: 'orderChange',
    label: t('resellerStoreDetail.changeTheOrder'),
    what:
      t('resellerStoreDetail.correctTheCustomerS') +
      t('resellerStoreDetail.onceTheOrderIs') +
      t('resellerStoreDetail.courierOnlyTheyCan'),
    direct: t('resellerStoreDetail.directlyTheChangeIs'),
  },
  {
    key: 'cancel',
    label: t('resellerStoreDetail.callTheOrderOff'),
    what: t('resellerStoreDetail.cancelItBeforeIt'),
    direct: t('resellerStoreDetail.directlyTheOrderIs'),
  },
  {
    key: 'callCapDecision',
    label: t('resellerStoreDetail.answerKeepTrying'),
    what: t('resellerStoreDetail.whenWeCannotReach'),
    direct: t('resellerStoreDetail.directlyTheStoreS'),
  },
  {
    key: 'chaseSkydrop',
    label: t('resellerStoreDetail.raiseItWithSkydrop'),
    what: t('resellerStoreDetail.tellSkydropAParcel'),
    direct: t('resellerStoreDetail.directlyTheIssueReaches'),
  },
  {
    key: 'reattempt',
    label: t('resellerStoreDetail.tryDeliveringAgain'),
    what: t('resellerStoreDetail.askTheCourierFor'),
    direct: t('resellerStoreDetail.directlyATicketOpens'),
  },
  {
    key: 'sendBack',
    label: t('resellerStoreDetail.sendTheParcelBack'),
    what: t('resellerStoreDetail.turnAParcelRound'),
    direct: t('resellerStoreDetail.directlyTheCourierIs'),
  },
];

type Draft = Record<ActionCapability, StoreActionMode>;

function howOf(mode: StoreActionMode): How {
  return mode === 'DIRECT' ? 'DIRECT' : 'ASK_SELLER';
}

/** One answer, in the screen's own words — for the confirmation's list of changes. */
function answerWords(t: Translate<MessageKey>, mode: StoreActionMode): string {
  if (mode === 'OFF') return 'No';
  return `Yes, ${
    howOptionsOf(t)
      .find((o) => o.value === howOf(mode))
      ?.label.toLowerCase() ?? ''
  }`;
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
  const t = useT();
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

  if (policy.isPending)
    return <SkeletonRows rows={4} cols={3} label={t('resellerStoreDetail.loadingWhatTheyCan')} />;
  if (policy.isError) {
    return <ErrorState message={verdict(policy.error, t)} retry={() => void policy.refetch()} />;
  }
  if (draft === null || lastHow === null) {
    return <SkeletonRows rows={4} cols={3} label={t('resellerStoreDetail.loadingWhatTheyCan')} />;
  }

  const dirty = ACTION_CAPABILITIES.some((c) => draft[c] !== policy.data[c]);
  const changed = capabilitiesOf(t).filter((c) => draft[c.key] !== policy.data[c.key]);

  async function submit(): Promise<void> {
    if (draft === null) return;
    setError(null);
    try {
      await save.mutateAsync({ storeId, policy: draft });
      toast.success(t('resellerStoreDetail.savedTheMemberStore'));
    } catch (err) {
      // Verbatim (FE-2): STORE_NOT_FOUND, and anything else the server says.
      setError(verdict(err, t));
      // Rethrown so the confirmation stays open with the verdict on it.
      throw err;
    }
  }

  return (
    <RsSection
      title={t('resellerStoreDetail.whatTheyCanDo')}
      note={
        policy.data.set
          ? t('resellerStoreDetail.yourSettingsForThis')
          : t('resellerStoreDetail.runningOnTheDefaults')
      }
      flush
    >
      <div className="rs-card__pad">
        <p className="rs-muted">{t('resellerStoreDetail.forEachTaskCan')}</p>
      </div>
      <Table caption={t('resellerStoreDetail.whatTheMemberStore')}>
        <THead>
          <Tr>
            <Th>{t('resellerStoreDetail.task')}</Th>
            <Th>{t('resellerStoreDetail.canTheMemberStore')}</Th>
            <Th>{t('resellerStoreDetail.how')}</Th>
          </Tr>
        </THead>
        <TBody>
          {capabilitiesOf(t).map((c) => {
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
                        ? t('resellerStoreDetail.noTheMemberStore')
                        : how === 'DIRECT'
                          ? c.direct
                          : t('resellerStoreDetail.approvalNote')}
                    </span>
                  </div>
                </Td>
                <Td>
                  <Switch
                    id={`can-${c.key}`}
                    aria-label={t('resellerStoreDetail.canTheMemberStore')}
                    aria-describedby={`task-${c.key}`}
                    checked={allowed}
                    onText={t('resellerStoreDetail.yes')}
                    offText={t('resellerStoreDetail.no')}
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
                      aria-label={t('resellerStoreDetail.how')}
                      className="rs-how"
                      value={how}
                      disabled={!canSave}
                      onChange={(e) => {
                        const next = e.target.value === 'DIRECT' ? 'DIRECT' : 'ASK_SELLER';
                        setLastHow({ ...lastHow, [c.key]: next });
                        setDraft({ ...draft, [c.key]: next });
                      }}
                    >
                      {howOptionsOf(t).map((o) => (
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
            {t('resellerStoreDetail.save')}
          </Button>
          {dirty ? (
            <span className="rs-dirty">
              <CircleDot size={12} aria-hidden />
              {t('resellerStoreDetail.youHaveUnsavedChanges')}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* A verdict stays under the matrix after "Back", as it always did;
          pressing Save again clears it. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('resellerStoreDetail.saveWhatThisStore')}
        entity={storeName}
        consequence={t('resellerStoreDetail.theMemberStoreSees')}
        confirmLabel={t('resellerStoreDetail.save')}
        onConfirm={submit}
        error={error}
      >
        {changed.length > 0 ? (
          <ul className="rs-confirm-list">
            {changed.map((c) => (
              <li key={c.key}>
                <b>{c.label}:</b> {answerWords(t, policy.data[c.key])} →{' '}
                {answerWords(t, draft[c.key])}
              </li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
    </RsSection>
  );
}
