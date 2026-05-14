import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfoPayload {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const ClientInfo = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ClientInfoPayload => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const forwarded = req.header('x-forwarded-for');
    const ipFromForwarded = forwarded ? forwarded.split(',')[0]?.trim() : undefined;
    const ipAddress = ipFromForwarded || req.ip || req.socket?.remoteAddress || null;
    return {
      ipAddress,
      userAgent: req.header('user-agent') ?? null,
      requestId: req.requestId ?? null,
    };
  },
);
