'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ErrorState,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
    <Section
      title="Courier accounts"
      subtitle={
        rows.length === 0
          ? "No links: this seller's parcels go to each courier's default account."
          : "This seller's parcels are split across these accounts by weight. Unlinking returns them to the default account."
      }
      action={
        canManage ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add link
          </Button>
        ) : undefined
      }
    >
      <Card>
        {links.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={2} />
          </div>
        ) : links.isError ? (
          <ErrorState
            message={serverVerdict(links.error, 'Failed to load courier links.')}
            retry={() => void links.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Uses the default accounts"
            description={
              canManage
                ? 'Add a link to route this seller to a specific courier account.'
                : 'A person with the courier-links permission can route this seller to a specific account.'
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Courier</Th>
                <Th align="right">Weight</Th>
                <Th align="right">Share</Th>
                <Th>State</Th>
                {canManage && <Th align="right">Actions</Th>}
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
      </Card>

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
    </Section>
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
      toast.success(link.isActive ? 'Link paused.' : 'Link active again.');
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td>
        <div className="text-text-body">{accountName(account)}</div>
        {account !== null && (
          <div className="text-text-faint font-mono text-xs">{account.environment}</div>
        )}
      </Td>
      <Td className="text-text-muted text-xs uppercase">{account?.courierCode ?? '—'}</Td>
      <Td align="right" className="font-mono text-xs">
        {link.distributionWeight}
      </Td>
      <Td align="right" className="font-mono text-xs">
        {share}
      </Td>
      <Td>
        <StatusBadge
          kind={link.isActive ? 'confirmed' : 'cancelled'}
          label={link.isActive ? 'Active' : 'Paused'}
        />
      </Td>
      {canManage && (
        <Td align="right">
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onReweigh}>
              Change weight
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => void toggleActive()}
            >
              {link.isActive ? 'Pause' : 'Activate'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onUnlink}>
              Unlink
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
      toast.success('Courier account linked.');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Link a courier account">
      <div className="space-y-3">
        {available.length === 0 ? (
          <p className="text-text-muted text-sm">
            Every courier account is already linked to this seller.
          </p>
        ) : (
          <>
            <FormField label="Account" htmlFor="courier-link-account" required>
              <Select
                id="courier-link-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {available.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} — {a.courierCode} · {a.environment}
                    {a.isActive ? '' : ' (switched off)'}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Weight"
              htmlFor="courier-link-weight"
              hint="Relative share of this seller's parcels sent to this account. Two links at 100 split evenly."
              required
            >
              <Input
                id="courier-link-weight"
                inputMode="numeric"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </FormField>
          </>
        )}
        {error !== null && <ErrorNote message={error} />}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={available.length === 0 || accountId === '' || link.isPending}
          onClick={() => void submit()}
        >
          {link.isPending ? 'Linking…' : 'Link account'}
        </Button>
      </ModalFooter>
    </Modal>
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
      toast.success('Weight updated.');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Weight for ${name}`}>
      <div className="space-y-3">
        <FormField
          label="Weight"
          htmlFor="courier-link-weight-edit"
          hint="0 keeps the link but sends it nothing."
          required
        >
          <Input
            id="courier-link-weight-edit"
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </FormField>
        {error !== null && <ErrorNote message={error} />}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={weight.trim() === '' || update.isPending}
          onClick={() => void submit()}
        >
          {update.isPending ? 'Saving…' : 'Save weight'}
        </Button>
      </ModalFooter>
    </Modal>
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
  const unlink = useUnlinkSellerCourierAccount();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await unlink.mutateAsync({ sellerId, courierAccountId: link.courierAccountId });
      toast.success('Link removed.');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Unlink ${name}?`}>
      <p className="text-text-body text-sm">
        New parcels for this seller stop going to {name}. If no other link remains, they go to the
        courier&apos;s default account. Parcels already booked keep the account that carried them.
      </p>
      {error !== null && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          size="md"
          disabled={unlink.isPending}
          onClick={() => void submit()}
        >
          {unlink.isPending ? 'Unlinking…' : 'Unlink'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
