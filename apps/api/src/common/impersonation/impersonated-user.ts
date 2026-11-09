import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ImpersonationContext } from './impersonation-context';

/**
 * Which user a support session acts as: the subject's OWNER.
 *
 * ── ONE PLACE, ON PURPOSE ────────────────────────────────────────────
 * This used to be a private method on each JWT guard. The hybrid
 * `GET /auth/{seller,store}/me` routes are `@Public()` and authenticate
 * inline, so the guards' knowledge of support sessions never reached
 * them and a staff member was bounced to /login with a valid cookie.
 * Every credential-resolving path (guards AND hybrid routes) calls these
 * two functions, so a new door cannot re-implement the rules.
 *
 * Refuses rather than falling back to any other member: an account
 * support cannot enter is a ticket; one entered as the wrong person is a
 * mystery in the audit log. Oldest owner first, so a session resolves to
 * the same person on every request.
 *
 * Returns only the ID. The status gate, deleted checks and permission
 * verdict stay with the caller's ordinary code.
 */
export async function resolveImpersonatedSellerUserId(
  prisma: Pick<PrismaService, 'client'>,
  ctx: ImpersonationContext,
): Promise<string> {
  if (ctx.subject.kind !== 'SELLER') {
    throw new ForbiddenException({
      code: 'IMPERSONATION_WRONG_SUBJECT',
      message: 'This support session is inside a store, not a client account.',
    });
  }
  const owner = await prisma.client.sellerUser.findFirst({
    where: {
      sellerId: ctx.subject.id,
      deletedAt: null,
      roles: { some: { role: { isOwner: true, deletedAt: null } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (owner === null) {
    throw new UnauthorizedException({
      code: 'IMPERSONATION_SUBJECT_UNAVAILABLE',
      message: 'This client has no owner account to act as, so the session cannot be used.',
    });
  }
  return owner.id;
}

export async function resolveImpersonatedStoreUserId(
  prisma: Pick<PrismaService, 'client'>,
  ctx: ImpersonationContext,
): Promise<string> {
  if (ctx.subject.kind !== 'STORE') {
    throw new ForbiddenException({
      code: 'IMPERSONATION_WRONG_SUBJECT',
      message: 'This support session is inside a client account, not a store.',
    });
  }
  const owner = await prisma.client.storeUser.findFirst({
    where: {
      storeId: ctx.subject.id,
      deletedAt: null,
      roles: { some: { role: { isOwner: true, deletedAt: null } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (owner === null) {
    throw new UnauthorizedException({
      code: 'IMPERSONATION_SUBJECT_UNAVAILABLE',
      message: 'This store has no owner account to act as, so the session cannot be used.',
    });
  }
  return owner.id;
}
