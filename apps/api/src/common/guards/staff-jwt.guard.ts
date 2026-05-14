import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth-common/services/jwt.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

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
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });

    const claims = this.jwt.verifyStaffAccess(token);

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, email: true, role: true, emailVerifiedAt: true },
    });
    if (!staff) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Staff session no longer valid' });
    }

    req.staff = {
      id: staff.id,
      email: staff.email,
      role: staff.role,
      emailVerifiedAt: staff.emailVerifiedAt,
      jti: claims.jti,
    };
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
