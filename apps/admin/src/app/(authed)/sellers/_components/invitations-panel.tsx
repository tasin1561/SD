'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight, RotateCw, Trash2 } from 'lucide-react';
import {
  useInvitationsList,
  useResendInvitation,
  useDeleteInvitation,
} from '@/lib/api-hooks';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/modal';

/**
 * Inline panel listing pending invitations on the sellers page. Most
 * of the time it's collapsed (ops invite occasionally); when expanded
 * shows the list + resend/delete actions.
 */
export function InvitationsPanel(): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const list = useInvitationsList();
  const resend = useResendInvitation();
  const del = useDeleteInvitation();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const pendingCount =
    list.data?.items.filter((i) => i.status === 'pending').length ?? 0;

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-surface-hover transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={14} className="text-text-muted" />
          ) : (
            <ChevronRight size={14} className="text-text-muted" />
          )}
          <span className="text-text-body text-sm">
            Pending invitations
            {pendingCount > 0 && (
              <span className="ml-2 text-text-muted text-xs">({pendingCount})</span>
            )}
          </span>
        </div>
        <span className="text-text-faint text-xs">
          {expanded ? 'Hide' : 'Show'}
        </span>
      </button>

      {expanded && (
        <CardBody className="border-t border-border">
          {list.isLoading ? (
            <div className="text-text-muted text-sm py-2">Loading…</div>
          ) : !list.data || list.data.items.length === 0 ? (
            <div className="text-text-muted text-sm py-2">No invitations yet.</div>
          ) : (
            <div className="space-y-1">
              {list.data.items.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-[5px] hover:bg-surface-hover transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-text-body text-sm font-mono truncate">
                      {inv.email}
                    </div>
                    <div className="text-text-faint text-xs">
                      <span className="uppercase tracking-wide">{inv.status}</span>
                      <span className="mx-1.5">·</span>
                      Expires {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                    </div>
                  </div>
                  {inv.status === 'pending' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={resend.isPending}
                        onClick={() => resend.mutate({ id: inv.id })}
                        title="Rotate token + re-send invitation email"
                      >
                        <RotateCw size={12} /> Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDeleteId(inv.id)}
                        title="Soft-delete invitation"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
        title="Delete invitation?"
        description="The pending invitation token will be revoked. The invitee can no longer use the email link. You can issue a new invitation any time."
        confirmLabel={del.isPending ? 'Deleting…' : 'Delete'}
        confirmVariant="destructive"
        disabled={del.isPending}
        onConfirm={async () => {
          if (pendingDeleteId === null) return;
          await del.mutateAsync({ id: pendingDeleteId });
          setPendingDeleteId(null);
        }}
      />
    </Card>
  );
}
