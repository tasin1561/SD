import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { TicketService } from '../../ticket/services/ticket.service';
import type { CallerScope } from '../assistant.types';
import { dispositionFor } from './assistant-attachment.service';
import { AssistantStoreService } from './assistant-store.service';

/** Long enough for a page to render its thumbnails; short enough that a copied link is soon useless. */
const PHOTO_TTL_SECONDS = 5 * 60;

export interface TicketPhotoView {
  readonly id: string;
  readonly kind: 'IMAGE' | 'PDF';
  readonly mediaType: string;
  readonly name: string;
  readonly bytes: number;
  /** Signed, short-lived, `Content-Disposition: attachment`. Null when the bucket could not sign it. */
  readonly url: string | null;
}

/**
 * The photos that went with a ticket (the files the person had sent the
 * assistant before pressing "Raise this ticket").
 *
 * The SAME permission that opens a ticket in each console gates the list
 * (`tickets.view` for the Client, Member-store, Associate and admin ticket
 * routes), and for the three non-staff consoles the ticket is read through
 * the console's own ticket query first, so another company's or another
 * store's ticket is the same 404 as one that does not exist.
 */
@Injectable()
export class AssistantTicketPhotosService {
  private readonly log = new Logger(AssistantTicketPhotosService.name);

  constructor(
    private readonly store: AssistantStoreService,
    private readonly tickets: TicketService,
    private readonly spaces: SpacesService,
  ) {}

  async list(scope: CallerScope, ticketId: string): Promise<{ items: TicketPhotoView[] }> {
    if (!scope.permissions.includes('tickets.view')) {
      throw new ForbiddenException({
        code: 'ASSISTANT_TICKET_PHOTOS_FORBIDDEN',
        message: 'You do not have permission to view tickets.',
      });
    }
    await this.assertCanSee(scope, ticketId);
    const rows = await this.store.ticketAttachments(ticketId);
    const items = await Promise.all(
      rows.map(async (r): Promise<TicketPhotoView> => {
        const url = await this.spaces
          .presignGetUrl(r.storageKey, PHOTO_TTL_SECONDS, {
            contentDisposition: dispositionFor(r.originalName),
            contentType: r.mediaType,
          })
          .catch((e: unknown) => {
            this.log.error(
              `ticket photo presign failed: ${e instanceof Error ? e.name : 'unknown'}`,
            );
            return null;
          });
        return {
          id: r.id,
          kind: r.kind,
          mediaType: r.mediaType,
          name: r.originalName,
          bytes: r.bytes,
          url,
        };
      }),
    );
    return { items };
  }

  /** The console's own ticket read: a ticket that is not theirs throws the console's own 404. */
  private async assertCanSee(scope: CallerScope, ticketId: string): Promise<void> {
    switch (scope.audience) {
      case 'SELLER':
        if (scope.sellerId === null) throw new ForbiddenException();
        await this.tickets.getForSeller(scope.sellerId, ticketId);
        return;
      case 'STORE':
      case 'ASSOCIATE':
        if (scope.storeId === null || scope.orderScope === null) throw new ForbiddenException();
        await this.tickets.getForStore(scope.storeId, ticketId, {
          storeUserId: scope.userId,
          orderScope: scope.orderScope,
        });
        return;
      case 'STAFF':
        // The admin ticket route is not tenant-scoped; `tickets.view` above is its gate.
        return;
    }
  }
}
