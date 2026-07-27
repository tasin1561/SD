'use client';

import { useState, type ReactElement } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
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
  useUpdateCourierAccount,
  type CourierAccountView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { CreateCourierAccountModal } from './create-courier-account-modal';

/**
 * Courier accounts (R1).
 *
 * One courier can have several accounts; a shipment records WHICH one
 * carried it, so this list is the root of that traceability. Sellers
 * with no explicit link route to the pair's DEFAULT account, which is
 * why exactly one row per (courier, environment) may hold that flag.
 *
 * Credentials are write-only from here: they are encrypted at rest and
 * never returned by any endpoint (CUR-1). There is deliberately no
 * "view credential" affordance to build.
 */
export function CourierAccountsIndex(): ReactElement {
  const [creating, setCreating] = useState(false);
  const list = useCourierAccounts();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Courier accounts"
        subtitle="Multiple accounts per courier, with per-seller weighted routing. Every shipment records the account that carried it."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            Add account
          </Button>
        }
      />

      <p className="text-text-muted border-border bg-surface-raised mb-4 flex items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2 text-xs leading-relaxed">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          API credentials are encrypted at rest with a key held in the environment,
          never in the database. They are never returned by any endpoint — to change
          one, add a new account and deactivate the old.
        </span>
      </p>

      {list.isError ? (
        <ErrorNote
          message={list.error?.message ?? 'Failed to load courier accounts.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <Card>
          <SkeletonRows rows={3} cols={5} />
        </Card>
      ) : (list.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No courier accounts yet"
          description="Add the Delhivery account whose credentials should be used for AWB generation. The first account for a courier becomes its default."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Add account
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Label</Th>
              <Th>Courier</Th>
              <Th>Environment</Th>
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

function AccountRow({
  account,
}: {
  readonly account: CourierAccountView;
}): ReactElement {
  const toast = useToast();
  const update = useUpdateCourierAccount();

  async function run(
    patch: { isActive?: boolean; isDefault?: boolean },
    success: string,
  ): Promise<void> {
    try {
      await update.mutateAsync({ accountId: account.id, ...patch });
      toast.success(success);
    } catch (err) {
      // FE-2 — the server owns "at most one default per pair" and
      // whatever else it enforces; show its refusal as written.
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td>
        <span className="text-text-strong">{account.label}</span>
        {account.notes !== null && account.notes !== '' && (
          <div className="text-text-faint mt-0.5 max-w-md text-xs">{account.notes}</div>
        )}
      </Td>
      <Td className="text-text-body">{account.courierCode}</Td>
      <Td className="text-text-muted text-xs">
        {account.environment === 'PRODUCTION' ? (
          <span className="text-[var(--status-pending-fg)]">Production</span>
        ) : (
          'Sandbox'
        )}
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <StatusBadge
            kind={account.isActive ? 'confirmed' : 'cancelled'}
            label={account.isActive ? 'Active' : 'Inactive'}
          />
          {account.isDefault && <StatusBadge kind="delivered" label="Default" />}
        </div>
      </Td>
      <Td align="right">
        <div className="flex items-center justify-end gap-1.5">
          {!account.isDefault && account.isActive && (
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                void run({ isDefault: true }, `${account.label} is now the default.`)
              }
            >
              Make default
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              void run(
                { isActive: !account.isActive },
                account.isActive
                  ? `${account.label} deactivated.`
                  : `${account.label} reactivated.`,
              )
            }
          >
            {account.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}
