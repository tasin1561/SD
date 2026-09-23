'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useCourierAccounts,
  useUpdateCourierAccount,
  type CourierAccountView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, Notice } from '@/app/(authed)/system/_components/af-parts';
import { EditCourierAccountModal } from './edit-courier-account-modal';
import { PortalLoginModal } from './portal-login-modal';
import { CreateCourierAccountModal } from './create-courier-account-modal';
import { CourierMasterSwitches } from './courier-master-switches';
import { usePermission } from '@/lib/use-permission';
import './courier-accounts.css';

/**
 * Courier accounts (R1).
 *
 * One courier can have several accounts; a shipment records WHICH one
 * carried it, so this list is the root of that traceability. Sellers
 * with no explicit link route to the pair's DEFAULT account, which is
 * why exactly one row per (courier, environment) may hold that flag.
 * A seller is linked to specific accounts, with weights, from the
 * "Courier accounts" section of that seller's own page (CACC-1).
 *
 * Credentials are write-only from here: they are encrypted at rest and
 * never returned by any endpoint (CUR-1). There is deliberately no
 * "view credential" affordance to build.
 */
export function CourierAccountsIndex(): ReactElement {
  const [creating, setCreating] = useState(false);
  const canWrite = usePermission('courier.accounts.manage');
  const list = useCourierAccounts();

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Courier accounts' }]}
        Link={Link}
        title="Courier accounts"
        subtitle="Multiple accounts per courier. Route a seller to specific accounts, by weight, from that seller's page; every shipment records the account that carried it."
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={16} />}
              onClick={() => setCreating(true)}
            >
              Add account
            </Button>
          ) : null
        }
      />

      <Notice tone="info">
        <p className="ca-shield">
          <ShieldCheck size={14} aria-hidden />
          <span>
            API credentials are encrypted at rest with a key held in the environment, never in the
            database. They are never returned by any endpoint — to change one, add a new account and
            deactivate the old.
          </span>
        </p>
      </Notice>

      {/* Above the accounts, because it decides whether any of them are
          used at all. */}
      <CourierMasterSwitches />

      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load courier accounts.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={3} cols={5} label="Loading courier accounts" />
        </AfCard>
      ) : (list.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No courier accounts yet"
          description="Add the Delhivery account whose credentials should be used for AWB generation. The first account for a courier becomes its default."
          action={
            canWrite ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                Add account
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Label</Th>
              <Th>Courier</Th>
              <Th>Environment</Th>
              <Th>Pickup location</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data?.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </TBody>
        </Table>
      )}

      <CreateCourierAccountModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

type RowAct = 'default' | 'active';

function AccountRow({ account }: { readonly account: CourierAccountView }): ReactElement {
  const toast = useToast();
  const update = useUpdateCourierAccount();
  const [editing, setEditing] = useState(false);
  const [portalLogin, setPortalLogin] = useState(false);
  // "Make default" re-routes every unlinked seller and "Deactivate" stops
  // an account being used; both ask first and then send the same PATCH.
  const [confirming, setConfirming] = useState<RowAct | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    patch: { isActive?: boolean; isDefault?: boolean },
    success: string,
  ): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({ accountId: account.id, ...patch });
      toast.success(success);
    } catch (err) {
      // FE-2 — the server owns "at most one default per pair" and
      // whatever else it enforces; show its refusal as written.
      const verdict = serverVerdict(err);
      toast.error(verdict);
      setError(verdict);
      throw err;
    }
  }

  const deactivating = account.isActive;

  return (
    <Tr>
      <Td>
        <span className="af-stack af-stack--tight">
          <span className="af-strong">{account.label}</span>
          {account.notes !== null && account.notes !== '' && (
            <span className="af-faint ca-notes">{account.notes}</span>
          )}
        </span>
      </Td>
      <Td>
        <span className="sk-ident">{account.courierCode}</span>
      </Td>
      <Td>
        {account.environment === 'PRODUCTION' ? (
          <span className="ca-env" data-prod="1">
            Production
          </span>
        ) : (
          <span className="ca-env">Sandbox</span>
        )}
      </Td>
      <Td>
        {account.pickupLocationName === null ? (
          // Worth calling out rather than showing a dash: with one
          // account the global setting is correct, and with two it is
          // the thing that silently sends parcels from the wrong
          // registration.
          <span className="af-faint">global setting</span>
        ) : (
          <span className="sk-ident af-small">{account.pickupLocationName}</span>
        )}
      </Td>
      <Td>
        <span className="af-row">
          <StatusChip
            size="sm"
            kind={account.isActive ? 'confirmed' : 'cancelled'}
            label={account.isActive ? 'Active' : 'Inactive'}
          />
          {account.isDefault && <StatusChip size="sm" kind="delivered" label="Default" />}
        </span>
      </Td>
      <Td align="right">
        <div className="af-row af-row--end">
          {!account.isDefault && account.isActive && (
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                setError(null);
                setConfirming('default');
              }}
            >
              Make default
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {/* Delhivery has no billing API, so reading what they actually
              charged means signing into their panel. Offered only where
              there is a credential to add to — a manual courier holds
              none. */}
          {(account.courierCode === 'delhivery' || account.courierCode === 'shiprocket') && (
            <Button variant="ghost" size="sm" onClick={() => setPortalLogin(true)}>
              Portal login
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onClick={() => {
              setError(null);
              if (deactivating) {
                setConfirming('active');
              } else {
                void run({ isActive: true }, `${account.label} reactivated.`).catch(
                  () => undefined,
                );
              }
            }}
          >
            {account.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
        <EditCourierAccountModal account={account} open={editing} onOpenChange={setEditing} />
        {portalLogin && (
          <PortalLoginModal
            accountId={account.id}
            accountLabel={account.label}
            courierCode={account.courierCode}
            onClose={() => setPortalLogin(false)}
          />
        )}
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(o) => {
            if (!o) setConfirming(null);
          }}
          title={
            confirming === 'default'
              ? 'Make this the default account?'
              : 'Deactivate this courier account?'
          }
          entity={`${account.label} · ${account.courierCode} · ${account.environment.toLowerCase()}`}
          consequence={
            confirming === 'default'
              ? 'Every seller with no explicit link to this courier routes their new parcels through this account from now on.'
              : 'No new parcel is booked on this account; parcels it already carried keep their record of it.'
          }
          confirmLabel={confirming === 'default' ? 'Make default' : 'Deactivate'}
          destructive={confirming === 'active'}
          error={error}
          onConfirm={() =>
            confirming === 'default'
              ? run({ isDefault: true }, `${account.label} is now the default.`)
              : run({ isActive: false }, `${account.label} deactivated.`)
          }
        />
      </Td>
    </Tr>
  );
}
