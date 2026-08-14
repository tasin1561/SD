'use client';

import type { ReactElement } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  ErrorNote,
  LoadingState,
  PageHeader,
} from '@skydrop/ui/components';
import { useAccountIdentity } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SessionRevocationCard } from './session-revocation-card';

export function AccountSecurityView(): ReactElement {
  const me = useAccountIdentity();

  return (
    <div>
      <PageHeader
        title="Your account"
        subtitle="Who you are signed in as, and how to end the sessions you are not sitting in front of."
      />

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Signed in as"
            subtitle="Read from the API each time this page opens, so the last sign-in below is current."
          />
          <CardBody>
            {me.isLoading ? (
              <LoadingState label="Loading your account…" rows={3} />
            ) : me.isError ? (
              <ErrorNote
                message={serverVerdict(me.error, 'Could not load your account.')}
                retry={() => void me.refetch()}
              />
            ) : me.data === undefined ? (
              // A 200 with nothing in it is not a state the API can
              // produce; saying so beats rendering an empty grid that
              // reads as "you have no email address".
              <ErrorNote
                message="The server answered without an account. Reload, or sign in again."
                retry={() => void me.refetch()}
              />
            ) : (
              <DescriptionList
                columns={2}
                items={[
                  { label: 'Email', value: me.data.emailDisplay },
                  { label: 'Role', value: me.data.roleName },
                  {
                    label: 'Email verified',
                    value:
                      me.data.emailVerifiedAt === null ? (
                        <span className="text-pending">Not verified</span>
                      ) : (
                        formatWhen(me.data.emailVerifiedAt)
                      ),
                  },
                  {
                    label: 'Permissions held',
                    value: `${me.data.permissions.length}`,
                  },
                  {
                    // The single most useful line on the page: an
                    // hour you do not recognise is the reason somebody
                    // came looking for the button below.
                    label: 'Last sign-in',
                    value: me.data.lastLoginAt === null ? '—' : formatWhen(me.data.lastLoginAt),
                  },
                  { label: 'Account created', value: formatWhen(me.data.createdAt) },
                ]}
              />
            )}
          </CardBody>
        </Card>

        <SessionRevocationCard />
      </div>
    </div>
  );
}

/** Local timezone, because the person reading it is deciding whether
 *  they were awake at the time. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}
