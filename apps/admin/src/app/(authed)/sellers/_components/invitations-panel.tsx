'use client';

import { useState, type ReactElement } from 'react';
import { ChevronRight, RotateCw, Trash2 } from 'lucide-react';
import { useInvitationsList, useResendInvitation, useDeleteInvitation } from '@/lib/api-hooks';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcCard } from '../../settings/_components/ac-parts';

/**
 * Inline panel listing pending invitations on the sellers page. Most
 * of the time it's collapsed (ops invite occasionally); when expanded
 * shows the list + resend/delete actions.
 */
export function InvitationsPanel(): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const list = useInvitationsList();
  const canInvite = usePermission('sellers.invite');
  const resend = useResendInvitation();
  const del = useDeleteInvitation();
  const toast = useToast();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const pendingCount = list.data?.items.filter((i) => i.status === 'pending').length ?? 0;
  const pendingEmail =
    list.data?.items.find((i) => i.id === pendingDeleteId)?.email ?? 'This invitation';

  return (
    <AcCard flush>
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="ac-disclosure"
        aria-expanded={expanded}
      >
        <span className="ac-inline">
          <ChevronRight size={15} className="ac-disclosure__chev" aria-hidden />
          <span>
            Pending invitations
            {pendingCount > 0 && (
              <span className="ac-disclosure__count sk-figure">({pendingCount})</span>
            )}
          </span>
        </span>
        <span className="ac-faint">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="ac-disclosure__panel">
          {list.isLoading ? (
            <div className="ac-pad">
              <SkeletonRows rows={3} cols={2} />
            </div>
          ) : !list.data || list.data.items.length === 0 ? (
            <p className="ac-muted ac-row">No invitations yet.</p>
          ) : (
            <ul className="ac-rows">
              {list.data.items.map((inv) => (
                <li key={inv.id} className="ac-row">
                  <div className="ac-row__main">
                    <div className="ac-row__value">{inv.email}</div>
                    <div className="ac-inline ac-faint">
                      <StatusChip
                        kind={
                          inv.status === 'pending'
                            ? 'pending'
                            : inv.status === 'used'
                              ? 'delivered'
                              : 'cancelled'
                        }
                        label={inv.status}
                        size="sm"
                      />
                      <span className="sk-figure">
                        Expires {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                      </span>
                    </div>
                  </div>
                  {inv.status === 'pending' && (
                    <div className="ac-row__side">
                      {canInvite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<RotateCw size={14} />}
                          disabled={resend.isPending}
                          onClick={() =>
                            resend.mutate(
                              { id: inv.id },
                              {
                                onSuccess: () =>
                                  toast.success(`Invitation re-sent to ${inv.email}`),
                                onError: (e) =>
                                  toast.error(serverVerdict(e, 'Failed to resend invitation.')),
                              },
                            )
                          }
                          title="Rotate token + re-send invitation email"
                        >
                          Resend
                        </Button>
                      )}
                      {canInvite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => setPendingDeleteId(inv.id)}
                          title="Soft-delete invitation"
                          aria-label={`Delete the invitation to ${inv.email}`}
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title="Delete invitation?"
        entity={pendingEmail}
        consequence="The pending invitation token will be revoked. The invitee can no longer use the email link. You can issue a new invitation any time."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDeleteId === null) return;
          try {
            await del.mutateAsync({ id: pendingDeleteId });
            toast.success('Invitation deleted.');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete invitation.');
          }
          setPendingDeleteId(null);
        }}
      />
    </AcCard>
  );
}
