import {
  CanActivate,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth-common/services/jwt.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALL_PERMISSION_KEYS, type PermissionKey } from '../auth/permissions';
import {
  REQUIRE_PERMISSIONS_KEY,
  STAFF_SELF_SERVICE_KEY,
} from '../auth/require-permissions.decorator';

@Injectable()
export class StaffJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req.header('authorization'));
    if (!token)
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });

    const claims = this.jwt.verifyStaffAccess(token);

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        staffRole: {
          select: {
            key: true,
            name: true,
            isSuperAdmin: true,
            deletedAt: true,
            permissions: { select: { permission: true } },
          },
        },
      },
    });
    if (!staff) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Staff session no longer valid',
      });
    }

    // A soft-deleted role is not a role. Someone whose role was removed
    // out from under them is unauthenticated rather than unauthorised:
    // there is nothing to reason about permission-wise, and leaving them
    // holding a valid session with an empty grant set is a worse state
    // than asking them to sign in again.
    if (staff.staffRole.deletedAt !== null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Staff session no longer valid',
      });
    }

    req.staff = {
      id: staff.id,
      email: staff.email,
      role: staff.role,
      roleKey: staff.staffRole.key,
      roleName: staff.staffRole.name,
      permissions: permissionsFor(staff.staffRole),
      emailVerifiedAt: staff.emailVerifiedAt,
      jti: claims.jti,
    };

    this.authorize(ctx, req.staff.permissions, req.staff.roleName);
    return true;
  }

  /**
   * Authorisation lives INSIDE the authentication guard on purpose.
   *
   * As a separate guard it would have to be remembered on every
   * controller, and the one that forgot would fail OPEN — which is
   * exactly the state this replaced. Here, there is no way to
   * authenticate as staff without also being authorised, because it is
   * the same `canActivate`.
   */
  private authorize(ctx: ExecutionContext, held: readonly string[], roleName: string): void {
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(STAFF_SELF_SERVICE_KEY, targets) === true) return;

    const required = this.reflector.getAllAndOverride<readonly PermissionKey[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      targets,
    );

    // Fail closed. An endpoint nobody assigned a permission to is not an
    // endpoint everybody may call.
    if (required === undefined || required.length === 0) {
      throw new ForbiddenException({
        code: 'ENDPOINT_NOT_AUTHORIZED',
        message:
          'This endpoint declares no permission and is refused by default. ' +
          'Add @RequirePermissions(...) or @StaffSelfService() to it.',
      });
    }

    // ANY of the listed permissions, matching the allowed-list semantics
    // the role helper had.
    if (required.some((p) => held.includes(p))) return;

    throw new ForbiddenException({
      code: 'INSUFFICIENT_PERMISSION',
      message: `${roleName} does not hold: ${required.join(' or ')}`,
    });
  }
}

/**
 * A super-admin role holds the whole catalogue implicitly rather than
 * through rows, so a permission added in a later release reaches it
 * without a data migration anybody has to remember to write.
 */
function permissionsFor(role: {
  readonly isSuperAdmin: boolean;
  readonly permissions: readonly { readonly permission: string }[];
}): readonly string[] {
  if (role.isSuperAdmin) return ALL_PERMISSION_KEYS;
  return role.permissions.map((p) => p.permission);
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
