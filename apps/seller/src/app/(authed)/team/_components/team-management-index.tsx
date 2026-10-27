'use client';

import { useState, type ReactElement } from 'react';
import {
  CircleAlert,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { MultiSelect } from '@skydrop/ui/app/multi-select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import type { CreatedTeamInvitation, TeamMemberRow } from '@skydrop/api-client';
import {
  useDeactivateTeamMember,
  useResendTeamInvitation,
  useRevokeTeamInvitation,
  useTeamInvitationsList,
  useTeamMembersList,
  useUpdateTeamMemberRoles,
} from '@/lib/api-hooks';
import { InviteMemberModal } from './invite-member-modal';
import { InviteLinkRevealCard } from './invite-link-reveal-card';
import { useRoles } from '@/lib/rbac-hooks';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { verdict } from '@/i18n/verdict';
import { roleChangeConsequence, roleLine, roleNamesOf } from '@/lib/role-words';
import { SetCallout, SetFact, SetPageHeader } from '../../settings/_components/settings-parts';
import './team.css';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { dateTag } from '@/i18n/format';

// The hardcoded six are gone: roles are rows now, so the options come
// from the server and include anything created under Team → Roles.
//
// ── A PERSON HOLDS SEVERAL ──────────────────────────────────────
// Permissions are the UNION of every live role held, so the roles a
// member holds are CHIPS IN THE ROW — not a label in a detail view
// nobody opens, and not the single-role `<select>` this page used to
// carry, which could only ever express the last role chosen and
// silently dropped the rest.
//
// The LEGACY `role` enum is not read anywhere on this page. It is null
// for anybody holding only roles this company invented, and a null
// prints as nothing without anything failing — so the one surface that
// most needs to be right about custom roles would have been blank for
// exactly the people who have them.

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('team.clientConsole') },
  { label: t('team.account') },
  { label: t('team.team') },
];

/** PENDING / USED / EXPIRED, decided once and read in two places. */
type InviteState = 'PENDING' | 'USED' | 'EXPIRED';

function inviteState(inv: {
  readonly usedAt: string | null;
  readonly expiresAt: string;
}): InviteState {
  if (inv.usedAt !== null) return 'USED';
  return new Date(inv.expiresAt).getTime() < Date.now() ? 'EXPIRED' : 'PENDING';
}

function inviteKind(state: InviteState): 'delivered' | 'pending' | 'cancelled' {
  switch (state) {
    case 'USED':
      return 'delivered';
    case 'PENDING':
      return 'pending';
    case 'EXPIRED':
      return 'cancelled';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function TeamManagementIndex(): ReactElement {
  const locale = useLocale();
  const t = useT();
  const canWrite = can(useSellerIdentity(), 'team.manage');
  const roles = useRoles();
  const members = useTeamMembersList();
  const invitations = useTeamInvitationsList();
  const updateRoles = useUpdateTeamMemberRoles();
  const deactivate = useDeactivateTeamMember();
  const resend = useResendTeamInvitation();
  const revoke = useRevokeTeamInvitation();
  const toast = useToast();

  const [inviting, setInviting] = useState(false);
  const [revealed, setRevealed] = useState<CreatedTeamInvitation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TeamMemberRow | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{
    readonly id: string;
    readonly email: string;
    readonly roles: string;
  } | null>(null);
  // A role change is CHOSEN inside the confirm dialog rather than in the
  // row: picking several roles needs a field with room to breathe, and
  // the row keeps showing what the person holds until the change is
  // actually made. `roleIds` starts as what they hold, so opening the
  // dialog and confirming it unchanged is a no-op the server agrees is
  // one.
  const [editingRoles, setEditingRoles] = useState<{
    readonly member: TeamMemberRow;
    readonly roleIds: readonly string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server's refusal of a role change, shown inside the dialog that
  // caused it (FE-2). Whatever it says: this holds a string, not a
  // vocabulary of codes it knows how to react to.
  const [roleError, setRoleError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return verdict(e, t, t('team.actionFailed'));
  }

  /**
   * Rethrows on failure so `ConfirmDialog` stays OPEN with the server's
   * verdict on it — which is the whole point for the two refusals this
   * can draw: the last owner being moved off that role (nobody would be
   * left able to manage the account) and an empty set (somebody holding
   * no role cannot sign in at all).
   *
   * Neither is mirrored here. In particular the owner role is NOT made
   * un-removable in the field: a control that greys itself out is a
   * client-side copy of a server policy, and only the server can know
   * whether this is the last owner — it counts them through the join
   * table, INSIDE the transaction that does the write, and a person
   * holding Owner as one of several roles still counts as one. Nothing
   * here could compute that, and the version that tried would be wrong
   * quietly.
   */
  async function onRolesChange(id: string, roleIds: readonly string[]): Promise<void> {
    setError(null);
    setRoleError(null);
    try {
      const result = await updateRoles.mutateAsync({ id, roleIds });
      toast.success(
        result.roleNames.length === 1
          ? t('team.nowHolds', { roleNames: result.roleNames[0] ?? '' })
          : t('team.nowHolds', { roleNames: result.roleNames.join(', ') }),
      );
    } catch (e) {
      setRoleError(fmtError(e));
      throw e;
    }
  }

  async function onDeactivate(id: string): Promise<void> {
    setError(null);
    try {
      await deactivate.mutateAsync({ id });
      toast.success(t('team.teamMemberDeactivated'));
      setPendingDelete(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onResend(id: string): Promise<void> {
    setError(null);
    try {
      const reveal = await resend.mutateAsync({ id });
      setRevealed(reveal);
      toast.success(t('team.invitationReIssuedCopy'));
    } catch (e) {
      setError(fmtError(e));
      // Rethrown so the Resend button shows the failure on itself.
      throw e;
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setError(null);
    try {
      await revoke.mutateAsync({ id });
      toast.success(t('team.invitationRevoked'));
      setPendingRevoke(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  const memberRows = members.data ?? [];
  const activeMembers = memberRows.filter((m) => m.deletedAt === null);
  const inviteRows = invitations.data?.items ?? [];
  const openInvites = inviteRows.filter((inv) => inviteState(inv) === 'PENDING');

  const roleOptions = (roles.data ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    description: r.isOwner
      ? t('team.everythingIncludingPermissionsAdded')
      : (r.description ??
        t('team.permission', {
          permissions: r.permissions.length,
          plural: r.permissions.length === 1 ? '' : 's',
        })),
  }));

  /** The chosen ids as NAMES, for the sentence above the confirm button. */
  function namesFor(ids: readonly string[]): readonly string[] {
    return ids
      .map((id) => (roles.data ?? []).find((r) => r.id === id)?.name)
      .filter((n): n is string => n !== undefined);
  }

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('team.team')}
        subtitle={t('team.inviteManageYourTeam')}
        meta={
          members.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {activeMembers.length} active {activeMembers.length === 1 ? 'member' : 'members'}
              </SetFact>
              {openInvites.length > 0 && (
                <SetFact tone="warn" dot>
                  {openInvites.length} invitation{openInvites.length === 1 ? '' : 's'} outstanding
                </SetFact>
              )}
            </span>
          )
        }
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              {t('team.inviteMember')}
            </Button>
          ) : null
        }
      />

      {/* ── The team at a glance ─────────────────────────────────────
             Three standing facts, all read off the two lists below.
             The comps put a last-active column and a per-person action
             count here; neither is stored — `lastLoginAt` is the whole
             activity record, and it is in the list where the person it
             belongs to is. */}
      <div className="set-kpis">
        {members.data === undefined ? (
          <KpiCard
            label={t('team.activeMembers')}
            icon={<Users size={14} />}
            figure="—"
            tone="neutral"
            hint={t('team.nobodyDeactivated')}
          />
        ) : (
          <KpiCard
            label={t('team.activeMembers')}
            icon={<Users size={14} />}
            value={activeMembers.length}
            format={String}
            unit={activeMembers.length === 1 ? 'person' : 'people'}
            tone="neutral"
            hint={
              memberRows.length === activeMembers.length
                ? t('team.nobodyDeactivated')
                : t('team.deactivated', { activeMembers: memberRows.length - activeMembers.length })
            }
          />
        )}
        {invitations.data === undefined ? (
          <KpiCard
            label={t('team.invitationsOutstanding')}
            icon={<MailPlus size={14} />}
            figure="—"
            tone="neutral"
            hint={t('team.sentNotYetAccepted')}
          />
        ) : (
          <KpiCard
            label={t('team.invitationsOutstanding')}
            icon={<MailPlus size={14} />}
            value={openInvites.length}
            format={String}
            unit={openInvites.length === 1 ? 'invite' : 'invites'}
            tone={openInvites.length > 0 ? 'pending' : 'neutral'}
            hint={t('team.sentNotYetAccepted')}
          />
        )}
        {roles.data === undefined ? (
          <KpiCard
            label={t('team.rolesDefined')}
            icon={<ShieldCheck size={14} />}
            figure="—"
            tone="neutral"
            hint={t('team.editWhatEachOne')}
          />
        ) : (
          <KpiCard
            label={t('team.rolesDefined')}
            icon={<ShieldCheck size={14} />}
            value={roles.data.length}
            format={String}
            unit={roles.data.length === 1 ? 'role' : 'roles'}
            tone="neutral"
            hint={t('team.editWhatEachOne')}
          />
        )}
      </div>

      {revealed && (
        <InviteLinkRevealCard invitation={revealed} onDismiss={() => setRevealed(null)} />
      )}

      {error && (
        <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title={t('team.members')}
          note={
            members.data === undefined
              ? undefined
              : `${memberRows.length} ${memberRows.length === 1 ? 'person' : 'people'}`
          }
        />
        <div className="set-card" data-flush>
          {members.isLoading ? (
            <SkeletonRows rows={3} cols={3} label={t('team.loadingMembers')} />
          ) : members.isError ? (
            <ErrorState
              message={members.error?.message ?? t('team.failed')}
              retry={() => void members.refetch()}
            />
          ) : memberRows.length === 0 ? (
            <EmptyState bare title={t('team.noMembersYet')} />
          ) : (
            <ul className="team-members" aria-label={t('team.teamMembers')}>
              {memberRows.map((m) => {
                // Nobody may change their own roles, and a deactivated
                // member has none to change. `canWrite` joins them
                // because the page opens on `team.view` while every
                // write needs `team.manage`: without it a reader saw
                // controls that could only ever 403. Cosmetic, as the
                // Invite button above already is — the server refuses
                // regardless of what renders (FE-2).
                const locked = m.deletedAt !== null || m.isYou || !canWrite;
                const held = roleNamesOf(m);
                return (
                  <li
                    key={m.id}
                    className="team-member"
                    data-dead={m.deletedAt !== null ? '1' : undefined}
                  >
                    <span className="team-member__avatar" aria-hidden>
                      <User size={16} />
                    </span>
                    <div className="team-member__text">
                      <div className="team-member__name">
                        <span>{m.fullName}</span>
                        {m.isYou && <StatusChip kind="confirmed" label={t('team.you')} size="sm" />}
                        {m.deletedAt !== null && (
                          <StatusChip kind="cancelled" label={t('team.deactivated2')} size="sm" />
                        )}
                      </div>
                      <span className="team-member__email sk-ident sk-ident--wrap">
                        {m.emailDisplay}
                      </span>
                      <span className="team-member__times">
                        <span>
                          {t('team.lastLogin')}{' '}
                          <span className="sk-figure">
                            {m.lastLoginAt !== null
                              ? new Date(m.lastLoginAt).toLocaleString(dateTag(locale))
                              : '—'}
                          </span>
                        </span>
                        <span>
                          {richMessage(t('team.joined'), {
                            span: (
                              <span className="sk-figure">
                                {new Date(m.createdAt).toLocaleDateString(dateTag(locale))}
                              </span>
                            ),
                          })}
                        </span>
                      </span>
                    </div>
                    <div className="team-member__side">
                      {/* EVERY role held, in the row. A person's access is
                          the union of these, so one of them is not a
                          summary of it — and somebody auditing who can
                          reach the wallet reads this list, not a detail
                          page. */}
                      <span
                        className="team-member__roles"
                        title={m.isYou ? t('team.youCannotChangeYour') : undefined}
                      >
                        {held.length === 0 ? (
                          // A role can be deleted from under its holders.
                          // Saying so beats an empty cell that reads as a
                          // rendering fault.
                          <StatusChip kind="failed" label={t('team.noRole')} size="sm" />
                        ) : (
                          held.map((name) => (
                            <StatusChip key={name} kind="neutral" label={name} size="sm" />
                          ))
                        )}
                      </span>
                      {locked ? null : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<ShieldCheck size={14} />}
                            disabled={roles.data === undefined}
                            aria-label={t('team.changeRolesFor', { fullName: m.fullName })}
                            onClick={() => {
                              setError(null);
                              setRoleError(null);
                              setEditingRoles({ member: m, roleIds: m.roleIds });
                            }}
                          >
                            {t('team.changeRoles')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<UserMinus size={14} />}
                            onClick={() => setPendingDelete(m)}
                          >
                            {t('team.deactivate')}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="set-section">
        <SectionHeading
          title={t('team.invitations')}
          note={
            invitations.data === undefined
              ? undefined
              : t('team.outstandingOf', {
                  openInvites: openInvites.length,
                  inviteRows: inviteRows.length,
                })
          }
        />
        <div className="set-card" data-flush>
          {invitations.isLoading ? (
            <SkeletonRows rows={3} cols={5} label={t('team.loading')} />
          ) : invitations.isError ? (
            <ErrorState
              message={invitations.error?.message ?? t('team.failed')}
              retry={() => void invitations.refetch()}
            />
          ) : (
            <Table caption={t('team.invitations')}>
              <THead>
                <Tr>
                  <Th>{t('team.email')}</Th>
                  <Th>{t('team.roles')}</Th>
                  <Th>{t('team.state')}</Th>
                  <Th>{t('team.expires')}</Th>
                  <Th align="right">{t('team.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {inviteRows.length === 0 ? (
                  <TableEmpty colSpan={5}>{t('team.noInvitationsYet')}</TableEmpty>
                ) : (
                  inviteRows.map((inv) => {
                    const state = inviteState(inv);
                    const offered = roleNamesOf({ roleNames: inv.roleNames });
                    return (
                      <Tr key={inv.id}>
                        <Td>
                          <span className="sk-ident sk-ident--wrap">{inv.email}</span>
                        </Td>
                        <Td>
                          {/* An invitation offers a SET of roles, so
                              all of their names are shown. The single
                              field that used to hold "the role" was null
                              whenever the company invited somebody onto
                              a role it built itself. */}
                          <span className="team-member__roles">
                            {offered.length === 0 ? (
                              <StatusChip kind="failed" label={t('team.noRole')} size="sm" />
                            ) : (
                              offered.map((name) => (
                                <StatusChip key={name} kind="neutral" label={name} size="sm" />
                              ))
                            )}
                          </span>
                        </Td>
                        <Td>
                          <StatusChip
                            kind={inviteKind(state)}
                            label={state.charAt(0) + state.slice(1).toLowerCase()}
                            size="sm"
                          />
                        </Td>
                        <Td className="set-cell-muted">
                          {new Date(inv.expiresAt).toLocaleDateString(dateTag(locale))}
                        </Td>
                        <Td align="right">
                          {state !== 'USED' && (
                            <div className="set-row-actions">
                              <AsyncButton
                                variant="ghost"
                                size="sm"
                                icon={<RefreshCw size={13} />}
                                labels={{
                                  idle: t('team.resend'),
                                  busy: t('team.resending'),
                                  done: t('team.resent'),
                                  error: t('team.notResent'),
                                }}
                                aria-label={t('team.resendInvitationTo', { email: inv.email })}
                                onAction={() => onResend(inv.id)}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setPendingRevoke({
                                    id: inv.id,
                                    email: inv.email,
                                    roles: roleLine(
                                      { roleNames: inv.roleNames },
                                      t('roleWords.noRole'),
                                    ),
                                  })
                                }
                              >
                                {t('team.revoke')}
                              </Button>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      {inviting && (
        <InviteMemberModal
          onClose={() => setInviting(false)}
          onSuccess={(reveal) => {
            setInviting(false);
            setRevealed(reveal);
            toast.success(t('team.invitationCreatedShareThe'));
          }}
        />
      )}

      {/* The roles are chosen HERE, so the sentence above the button is
          about the set that is actually going to be saved. The confirm
          button is never disabled on an empty selection: the server
          refuses that and its words are what appears in `error` — see
          `onRolesChange`. */}
      <ConfirmDialog
        open={editingRoles !== null}
        onOpenChange={(next) => {
          if (!next) {
            setEditingRoles(null);
            setRoleError(null);
          }
        }}
        title={t('team.whichRolesShouldThis')}
        entity={
          editingRoles === null
            ? ''
            : `${editingRoles.member.fullName} · ${editingRoles.member.emailDisplay}`
        }
        consequence={
          editingRoles === null
            ? ''
            : roleChangeConsequence(
                editingRoles.member.fullName,
                roleNamesOf(editingRoles.member),
                namesFor(editingRoles.roleIds),
                t,
              )
        }
        confirmLabel={t('team.saveRoles')}
        error={roleError}
        onConfirm={async () => {
          if (editingRoles === null) return;
          await onRolesChange(editingRoles.member.id, editingRoles.roleIds);
        }}
      >
        <MultiSelect
          label={t('team.roles')}
          icon={<ShieldCheck size={15} />}
          required
          options={roleOptions}
          value={editingRoles?.roleIds ?? []}
          onChange={(next) => {
            setRoleError(null);
            setEditingRoles((cur) => (cur === null ? cur : { ...cur, roleIds: next }));
          }}
          placeholder={
            (editingRoles?.roleIds.length ?? 0) === 0
              ? t('team.chooseOneOrMore')
              : t('team.addAnotherRole')
          }
          hint={t('team.theyCanDoEverything2')}
          emptyText={t('team.noMatchingRole')}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={t('team.deactivateThisTeamMember')}
        entity={
          pendingDelete === null ? '' : `${pendingDelete.fullName} · ${pendingDelete.emailDisplay}`
        }
        consequence={t('team.theyLoseAccessTo')}
        confirmLabel={t('team.deactivate')}
        destructive
        onConfirm={() => (pendingDelete === null ? undefined : onDeactivate(pendingDelete.id))}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title={t('team.revokeThisInvitation')}
        entity={pendingRevoke === null ? '' : `${pendingRevoke.email} · ${pendingRevoke.roles}`}
        consequence={t('team.theInvitationLinkStops')}
        confirmLabel={t('team.revokeInvitation')}
        destructive
        onConfirm={() => (pendingRevoke === null ? undefined : onRevoke(pendingRevoke.id))}
      />
    </div>
  );
}
