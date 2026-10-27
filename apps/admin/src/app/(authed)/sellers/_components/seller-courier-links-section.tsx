'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Link2, Link2Off, Pause, Play, Scale } from 'lucide-react';
// The legacy toast on purpose: the component tests mount this section
// under the legacy <Toaster> only, and the shell mounts both.
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, Table, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcAlert, AcSection, phaseOf } from '../../settings/_components/ac-parts';
import {
  useCourierAccounts,
  useLinkSellerCourierAccount,
  useSellerCourierLinks,
  useUnlinkSellerCourierAccount,
  useUpdateSellerCourierLink,
  type CourierAccountView,
  type SellerCourierAccountLinkView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

/**
 * Which courier accounts carry THIS seller's parcels (CACC-1, R1).
 *
 * The routing existed from R1 — `SellerCourierAccountLink.distributionWeight`
 * splits a seller's parcels across accounts, and every shipment records
 * the account that carried it — but no screen could create a link, so
 * every seller rode the pair's default account whatever had been agreed.
 *
 * A seller with no link routes to the default account for the courier,
 * which is why an empty list is a normal state and says so. The share
 * column is arithmetic over the ACTIVE weights, for reading; the server
 * decides the routing and validates the weight (FE-2), so nothing here
 * mirrors its bounds.
 *
 * Reading needs `courier.accounts.view` (the controller's class gate);
 * every change needs `sellers.courier_links.manage`. Both are cosmetic
 * here — the API refuses regardless.
 */
export function SellerCourierLinksSection({
  sellerId,
}: {
  readonly sellerId: string;
}): ReactElement | null {
  const tr = useT();
  const canView = usePermission('courier.accounts.view');
  const canManage = usePermission('sellers.courier_links.manage');
  const links = useSellerCourierLinks(canView ? sellerId : null);
  const accounts = useCourierAccounts();
  const [adding, setAdding] = useState(false);
  const [reweighing, setReweighing] = useState<SellerCourierAccountLinkView | null>(null);
  const [unlinking, setUnlinking] = useState<SellerCourierAccountLinkView | null>(null);

  const byId = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );

  if (!canView) return null;

  const rows = links.data ?? [];
  const activeWeight = rows.filter((l) => l.isActive).reduce((t, l) => t + l.distributionWeight, 0);

  return (
    <AcSection
      title={tr('sellersSellerCourierLinksSection.courierAccounts')}
      note={
        rows.length === 0
          ? tr('sellersSellerCourierLinksSection.noLinksThisClientS')
          : tr('sellersSellerCourierLinksSection.thisClientSParcelsAre')
      }
      action={
        canManage ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Link2 size={14} />}
            onClick={() => setAdding(true)}
          >
            {tr('sellersSellerCourierLinksSection.addLink')}
          </Button>
        ) : undefined
      }
      flush
    >
      {links.isLoading ? (
        <SkeletonRows rows={2} />
      ) : links.isError ? (
        <ErrorState
          message={serverVerdict(
            links.error,
            tr('sellersSellerCourierLinksSection.failedToLoadCourierLinks'),
          )}
          retry={() => void links.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          bare
          title={tr('sellersSellerCourierLinksSection.usesTheDefaultAccounts')}
          description={
            canManage
              ? tr('sellersSellerCourierLinksSection.addALinkToRoute')
              : tr('sellersSellerCourierLinksSection.aPersonWithTheCourier')
          }
        />
      ) : (
        <Table caption={tr('sellersSellerCourierLinksSection.courierAccountsForThisClient')}>
          <THead>
            <Tr>
              <Th>{tr('sellersSellerCourierLinksSection.account')}</Th>
              <Th>{tr('sellersSellerCourierLinksSection.courier')}</Th>
              <Th align="right">{tr('sellersSellerCourierLinksSection.weight')}</Th>
              <Th align="right">{tr('sellersSellerCourierLinksSection.share')}</Th>
              <Th>{tr('sellersSellerCourierLinksSection.state')}</Th>
              {canManage && <Th align="right">{tr('sellersSellerCourierLinksSection.actions')}</Th>}
            </Tr>
          </THead>
          <TBody>
            {rows.map((link) => (
              <LinkRow
                key={link.id}
                sellerId={sellerId}
                link={link}
                account={byId.get(link.courierAccountId) ?? null}
                activeWeight={activeWeight}
                canManage={canManage}
                onReweigh={() => setReweighing(link)}
                onUnlink={() => setUnlinking(link)}
              />
            ))}
          </TBody>
        </Table>
      )}

      {adding && (
        <AddLinkModal
          sellerId={sellerId}
          accounts={accounts.data ?? []}
          linkedIds={new Set(rows.map((l) => l.courierAccountId))}
          onClose={() => setAdding(false)}
        />
      )}
      {reweighing !== null && (
        <WeightModal
          sellerId={sellerId}
          link={reweighing}
          accountName={accountName(byId.get(reweighing.courierAccountId) ?? null)}
          onClose={() => setReweighing(null)}
        />
      )}
      {unlinking !== null && (
        <UnlinkModal
          sellerId={sellerId}
          link={unlinking}
          accountName={accountName(byId.get(unlinking.courierAccountId) ?? null)}
          onClose={() => setUnlinking(null)}
        />
      )}
    </AcSection>
  );
}

function accountName(a: CourierAccountView | null): string {
  return a === null ? 'Unknown account' : a.label;
}

function LinkRow({
  sellerId,
  link,
  account,
  activeWeight,
  canManage,
  onReweigh,
  onUnlink,
}: {
  readonly sellerId: string;
  readonly link: SellerCourierAccountLinkView;
  readonly account: CourierAccountView | null;
  readonly activeWeight: number;
  readonly canManage: boolean;
  readonly onReweigh: () => void;
  readonly onUnlink: () => void;
}): ReactElement {
  const tr = useT();
  const update = useUpdateSellerCourierLink();
  const toast = useToast();
  const share =
    link.isActive && activeWeight > 0
      ? `${Math.round((link.distributionWeight / activeWeight) * 100)}%`
      : '—';

  async function toggleActive(): Promise<void> {
    try {
      await update.mutateAsync({
        sellerId,
        courierAccountId: link.courierAccountId,
        isActive: !link.isActive,
      });
      toast.success(
        link.isActive
          ? tr('sellersSellerCourierLinksSection.linkPaused')
          : tr('sellersSellerCourierLinksSection.linkActiveAgain'),
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td>
        <span className="ac-cell-main">{accountName(account)}</span>
        {account !== null && <span className="ac-cell-sub">{account.environment}</span>}
      </Td>
      <Td>{account?.courierCode ?? '—'}</Td>
      <Td align="right">
        <span className="sk-figure">{link.distributionWeight}</span>
      </Td>
      <Td align="right">
        <span className="sk-figure">{share}</span>
      </Td>
      <Td>
        <StatusChip
          kind={link.isActive ? 'confirmed' : 'cancelled'}
          label={
            link.isActive
              ? tr('sellersSellerCourierLinksSection.active')
              : tr('sellersSellerCourierLinksSection.paused')
          }
          size="sm"
        />
      </Td>
      {canManage && (
        <Td align="right">
          <div className="ac-buttons">
            <Button variant="ghost" size="sm" icon={<Scale size={14} />} onClick={onReweigh}>
              {tr('sellersSellerCourierLinksSection.changeWeight')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={link.isActive ? <Pause size={14} /> : <Play size={14} />}
              disabled={update.isPending}
              onClick={() => void toggleActive()}
            >
              {link.isActive
                ? tr('sellersSellerCourierLinksSection.pause')
                : tr('sellersSellerCourierLinksSection.activate')}
            </Button>
            <Button variant="ghost" size="sm" icon={<Link2Off size={14} />} onClick={onUnlink}>
              {tr('sellersSellerCourierLinksSection.unlink')}
            </Button>
          </div>
        </Td>
      )}
    </Tr>
  );
}

function AddLinkModal({
  sellerId,
  accounts,
  linkedIds,
  onClose,
}: {
  readonly sellerId: string;
  readonly accounts: readonly CourierAccountView[];
  readonly linkedIds: ReadonlySet<string>;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const link = useLinkSellerCourierAccount();
  const toast = useToast();
  const available = accounts.filter((a) => !linkedIds.has(a.id));
  const [accountId, setAccountId] = useState(available[0]?.id ?? '');
  const [weight, setWeight] = useState('100');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await link.mutateAsync({
        sellerId,
        courierAccountId: accountId,
        distributionWeight: Number(weight),
      });
      toast.success(tr('sellersSellerCourierLinksSection.courierAccountLinked'));
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={tr('sellersSellerCourierLinksSection.linkACourierAccount')}
      icon={<Link2 size={18} />}
      locked={link.isPending}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>
            {tr('sellersSellerCourierLinksSection.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            state={phaseOf(link.isPending, error)}
            labels={{
              idle: tr('sellersSellerCourierLinksSection.linkAccount'),
              busy: tr('sellersSellerCourierLinksSection.linking'),
              error: tr('sellersSellerCourierLinksSection.notLinked'),
            }}
            disabled={available.length === 0 || accountId === '' || link.isPending}
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        {available.length === 0 ? (
          <p className="ac-muted">
            {tr('sellersSellerCourierLinksSection.everyCourierAccountIsAlready')}
          </p>
        ) : (
          <>
            <Select
              label={tr('sellersSellerCourierLinksSection.account')}
              id="courier-link-account"
              requiredMark
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.courierCode} · {a.environment}
                  {a.isActive ? '' : tr('sellersSellerCourierLinksSection.switchedOff')}
                </option>
              ))}
            </Select>
            <TextField
              label={tr('sellersSellerCourierLinksSection.weight')}
              id="courier-link-weight"
              hint={tr('sellersSellerCourierLinksSection.relativeShareOfThisClient')}
              requiredMark
              inputMode="numeric"
              inputClassName="sk-figure"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </>
        )}
        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}

function WeightModal({
  sellerId,
  link,
  accountName: name,
  onClose,
}: {
  readonly sellerId: string;
  readonly link: SellerCourierAccountLinkView;
  readonly accountName: string;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const update = useUpdateSellerCourierLink();
  const toast = useToast();
  const [weight, setWeight] = useState(String(link.distributionWeight));
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({
        sellerId,
        courierAccountId: link.courierAccountId,
        distributionWeight: Number(weight),
      });
      toast.success(tr('sellersSellerCourierLinksSection.weightUpdated'));
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={tr('sellersSellerCourierLinksSection.weightFor', { name })}
      icon={<Scale size={18} />}
      locked={update.isPending}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>
            {tr('sellersSellerCourierLinksSection.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            state={phaseOf(update.isPending, error)}
            labels={{
              idle: tr('sellersSellerCourierLinksSection.saveWeight'),
              busy: tr('sellersSellerCourierLinksSection.saving'),
              error: tr('sellersSellerCourierLinksSection.notSaved'),
            }}
            disabled={weight.trim() === '' || update.isPending}
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <TextField
          label={tr('sellersSellerCourierLinksSection.weight')}
          id="courier-link-weight-edit"
          hint={tr('sellersSellerCourierLinksSection.0KeepsTheLinkBut')}
          requiredMark
          inputMode="numeric"
          inputClassName="sk-figure"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}

function UnlinkModal({
  sellerId,
  link,
  accountName: name,
  onClose,
}: {
  readonly sellerId: string;
  readonly link: SellerCourierAccountLinkView;
  readonly accountName: string;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const unlink = useUnlinkSellerCourierAccount();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await unlink.mutateAsync({ sellerId, courierAccountId: link.courierAccountId });
      toast.success(tr('sellersSellerCourierLinksSection.linkRemoved'));
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      // Rethrown so the confirm step stays open with the verdict on it.
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={tr('sellersSellerCourierLinksSection.unlink2', { name })}
      entity={name}
      consequence={tr('sellersSellerCourierLinksSection.newParcelsForThisClient', { name })}
      confirmLabel={tr('sellersSellerCourierLinksSection.unlink')}
      cancelLabel={tr('sellersSellerCourierLinksSection.keepIt')}
      destructive
      error={error}
      onConfirm={submit}
    />
  );
}
