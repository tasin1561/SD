'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { BarChart3, CircleAlert, Mail, SearchX, Tags, User, UserPlus, Users } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useAssociates, type AssociateSummary } from '@/lib/associate-hooks';
import { useInviteStoreMember } from '@/lib/store-hooks';
import { RdCallout, phaseOf } from '../settings/_components/rd-parts';
import {
  AsSection,
  AssociateCoverage,
  AssociatePauseSwitch,
  AssociatePerson,
} from './_components/associate-parts';
import './_components/associates.css';

/**
 * ASSOC-1 — the people who sell for this store.
 *
 * The two counts beside each person (how many products they are priced
 * for, and how many of those prices the seller's range has moved out
 * from under) are on this list rather than on a detail page, because
 * they are what silently stops somebody selling: an unpriced product is
 * refused BY NAME at the order, and so is a price now outside the
 * seller's terms. A list that said only "4 associates" would be a list
 * nobody learns anything from.
 *
 * The switch is here too, for the same reason it is on the analysis
 * screen: the act and the thing that makes you want to take it belong
 * on one page.
 */
export default function AssociatesPage(): ReactElement {
  const me = useStoreIdentity();
  const associates = useAssociates();
  const [search, setSearch] = useState('');
  const [inviting, setInviting] = useState(false);

  // The invitation is the store's EXISTING one (ASSOC-1 — nothing new in
  // the invitation table), and that endpoint needs `team.manage` rather
  // than this page's `associates.manage`. Cosmetic (FE-2): the API
  // refuses regardless; this only stops the button being offered to
  // somebody it would refuse.
  const mayInvite = can(me, 'team.manage');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = associates.data?.associates ?? [];
    return q === ''
      ? all
      : all.filter(
          (a) => a.fullName.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
        );
  }, [associates.data, search]);

  const header = (
    <PageHeader
      title="Associates"
      subtitle="The people who place orders for your store, what each of them sells at, and whether they can place new orders."
      action={
        <div className="as-row-actions">
          <Link href="/associates/analysis" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__icon" aria-hidden>
              <BarChart3 size={15} />
            </span>
            <span className="sk-btn__label">How they are doing</span>
          </Link>
          {mayInvite ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              Invite an associate
            </Button>
          ) : null}
        </div>
      }
    />
  );

  if (associates.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={5} cols={4} label="Loading your associates" />
      </div>
    );
  }
  if (associates.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState
          message={serverVerdict(associates.error)}
          retry={() => void associates.refetch()}
        />
      </div>
    );
  }

  const none = associates.data.associates.length === 0;
  // The denominator is stated ONCE for the whole list by the server,
  // rather than repeated on every person's row.
  const sellable = associates.data.sellableProducts;

  return (
    <div className="as-page">
      {header}
      <AsSection>
        <SectionHeading
          title="Your associates"
          note="Switching somebody off stops NEW orders only. Everything already placed carries on, and they can still follow, cancel and chase it."
        />
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: 'Search by name or email',
            placeholder: 'Search name or email',
          }}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={none ? <Users size={22} /> : <SearchX size={22} />}
            title={none ? 'No associates yet' : 'Nobody matches that search'}
            description={
              none
                ? 'An associate places orders for your store and sells at a price you set for them, product by product. Invite one, then set their prices.'
                : undefined
            }
            action={
              none && mayInvite ? (
                <Button
                  variant="primary"
                  size="md"
                  icon={<UserPlus size={15} />}
                  onClick={() => setInviting(true)}
                >
                  Invite an associate
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table caption="Associates">
            <THead>
              <Tr>
                <Th>Person</Th>
                <Th>Can place orders</Th>
                <Th>Priced for</Th>
                <Th align="right">Prices</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((a) => (
                <AssociateRowView key={a.storeUserId} associate={a} sellable={sellable} />
              ))}
            </TBody>
          </Table>
        )}
      </AsSection>

      {mayInvite ? <InviteAssociateDialog open={inviting} onOpenChange={setInviting} /> : null}
    </div>
  );
}

function AssociateRowView({
  associate,
  sellable,
}: {
  readonly associate: AssociateSummary;
  readonly sellable: number;
}): ReactElement {
  return (
    <Tr>
      <Td>
        <AssociatePerson fullName={associate.fullName} email={associate.email} />
      </Td>
      <Td>
        <AssociatePauseSwitch associate={associate} />
      </Td>
      <Td>
        <AssociateCoverage
          priced={associate.pricedProducts}
          missing={associate.unpricedProducts}
          sellable={sellable}
          outOfRange={associate.outOfRangePrices}
        />
      </Td>
      <Td align="right">
        <Link
          href={`/associates/${associate.storeUserId}/prices`}
          className={buttonClassName('secondary', 'sm')}
        >
          <span className="sk-btn__fx" aria-hidden />
          <span className="sk-btn__icon" aria-hidden>
            <Tags size={14} />
          </span>
          <span className="sk-btn__label">Set prices</span>
        </Link>
      </Td>
    </Tr>
  );
}

/**
 * Invite somebody onto the `associate` role.
 *
 * This is the store's ORDINARY invitation (`POST /store/team/invitations`)
 * with the role fixed — ASSOC-1 adds nothing to the invitation table, and
 * a second invitation path would be a second set of rules about expiry,
 * resending and duplicate emails able to disagree with the first. The
 * role is NOT a picker here: the button says what it does, and anybody
 * wanting a different role is on the Team page already.
 *
 * Nothing is validated locally beyond the browser's own `required` and
 * `type="email"`. The refusals — `EMAIL_ALREADY_REGISTERED`,
 * `INVITATION_ALREADY_PENDING`, `NO_ROLES` — come back in the server's
 * own words (FE-2).
 */
function InviteAssociateDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const invite = useInviteStoreMember();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({
        email: email.trim(),
        fullName: fullName.trim(),
        roleKeys: ['associate'],
      });
      toast.success(`Invitation sent to ${email.trim()}. Set their prices once they sign in.`);
      setEmail('');
      setFullName('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<UserPlus size={18} />}
      title="Invite an associate"
      description="They get an email with a link to set up their login. It works for 7 days. They see only the orders they place, and only the prices you set for them."
    >
      <form onSubmit={submit} className="as-form">
        <TextField
          id="associate-name"
          label="Name"
          icon={<User size={15} />}
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          id="associate-email"
          type="email"
          label="Email"
          icon={<Mail size={15} />}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="as-muted">
          They join on the <strong className="as-strong">Associate</strong> role. Until you give
          them a price for a product, they cannot sell it — set their prices from this list once
          they have signed in.
        </p>
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<UserPlus size={15} />}
            labels={{ idle: 'Send invitation', busy: 'Sending…', error: 'Not sent' }}
            state={phaseOf(invite.isPending, error)}
            disabled={invite.isPending}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
