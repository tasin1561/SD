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
import { useT } from '@/i18n/client';

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
  const t = useT();
  const [creating, setCreating] = useState(false);
  const canWrite = usePermission('courier.accounts.manage');
  const list = useCourierAccounts();

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: t('courierAccountsCourierAccountsIndex.network') },
          { label: t('courierAccountsCourierAccountsIndex.courierAccounts') },
        ]}
        Link={Link}
        title={t('courierAccountsCourierAccountsIndex.courierAccounts')}
        subtitle={t('courierAccountsCourierAccountsIndex.multipleAccountsPerCourierRoute')}
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={16} />}
              onClick={() => setCreating(true)}
            >
              {t('courierAccountsCourierAccountsIndex.addAccount')}
            </Button>
          ) : null
        }
      />

      <Notice tone="info">
        <p className="ca-shield">
          <ShieldCheck size={14} aria-hidden />
          <span>{t('courierAccountsCourierAccountsIndex.apiCredentialsAreEncryptedAt')}</span>
        </p>
      </Notice>

      {/* Above the accounts, because it decides whether any of them are
          used at all. */}
      <CourierMasterSwitches />

      {list.isError ? (
        <ErrorState
          message={
            list.error?.message ??
            t('courierAccountsCourierAccountsIndex.failedToLoadCourierAccounts')
          }
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <AfCard flush>
          <SkeletonRows
            rows={3}
            cols={5}
            label={t('courierAccountsCourierAccountsIndex.loadingCourierAccounts')}
          />
        </AfCard>
      ) : (list.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={t('courierAccountsCourierAccountsIndex.noCourierAccountsYet')}
          description={t('courierAccountsCourierAccountsIndex.addTheDelhiveryAccountWhose')}
          action={
            canWrite ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                {t('courierAccountsCourierAccountsIndex.addAccount')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t('courierAccountsCourierAccountsIndex.label')}</Th>
              <Th>{t('courierAccountsCourierAccountsIndex.courier')}</Th>
              <Th>{t('courierAccountsCourierAccountsIndex.environment')}</Th>
              <Th>{t('courierAccountsCourierAccountsIndex.pickupLocation')}</Th>
              <Th>{t('courierAccountsCourierAccountsIndex.state')}</Th>
              <Th align="right">{t('courierAccountsCourierAccountsIndex.actions')}</Th>
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
  const t = useT();
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
            {t('courierAccountsCourierAccountsIndex.production')}
          </span>
        ) : (
          <span className="ca-env">{t('courierAccountsCourierAccountsIndex.sandbox')}</span>
        )}
      </Td>
      <Td>
        {account.pickupLocationName === null ? (
          // Worth calling out rather than showing a dash: with one
          // account the global setting is correct, and with two it is
          // the thing that silently sends parcels from the wrong
          // registration.
          <span className="af-faint">{t('courierAccountsCourierAccountsIndex.globalSetting')}</span>
        ) : (
          <span className="sk-ident af-small">{account.pickupLocationName}</span>
        )}
      </Td>
      <Td>
        <span className="af-row">
          <StatusChip
            size="sm"
            kind={account.isActive ? 'confirmed' : 'cancelled'}
            label={
              account.isActive
                ? t('courierAccountsCourierAccountsIndex.active')
                : t('courierAccountsCourierAccountsIndex.inactive')
            }
          />
          {account.isDefault && (
            <StatusChip
              size="sm"
              kind="delivered"
              label={t('courierAccountsCourierAccountsIndex.default')}
            />
          )}
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
              {t('courierAccountsCourierAccountsIndex.makeDefault')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t('courierAccountsCourierAccountsIndex.edit')}
          </Button>
          {/* Delhivery has no billing API, so reading what they actually
              charged means signing into their panel. Offered only where
              there is a credential to add to — a manual courier holds
              none. */}
          {(account.courierCode === 'delhivery' || account.courierCode === 'shiprocket') && (
            <Button variant="ghost" size="sm" onClick={() => setPortalLogin(true)}>
              {t('courierAccountsCourierAccountsIndex.portalLogin')}
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
            {account.isActive
              ? t('courierAccountsCourierAccountsIndex.deactivate')
              : t('courierAccountsCourierAccountsIndex.reactivate')}
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
              ? t('courierAccountsCourierAccountsIndex.makeThisTheDefaultAccount')
              : t('courierAccountsCourierAccountsIndex.deactivateThisCourierAccount')
          }
          entity={`${account.label} · ${account.courierCode} · ${account.environment.toLowerCase()}`}
          consequence={
            confirming === 'default'
              ? t('courierAccountsCourierAccountsIndex.everyClientWithNoExplicit')
              : t('courierAccountsCourierAccountsIndex.noNewParcelIsBooked')
          }
          confirmLabel={
            confirming === 'default'
              ? t('courierAccountsCourierAccountsIndex.makeDefault')
              : t('courierAccountsCourierAccountsIndex.deactivate')
          }
          destructive={confirming === 'active'}
          error={error}
          onConfirm={() =>
            confirming === 'default'
              ? run(
                  { isDefault: true },
                  t('courierAccountsCourierAccountsIndex.isNowTheDefault', {
                    label: account.label,
                  }),
                )
              : run({ isActive: false }, `${account.label} deactivated.`)
          }
        />
      </Td>
    </Tr>
  );
}
