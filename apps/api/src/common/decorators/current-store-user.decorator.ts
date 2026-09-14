import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedStoreUser } from '../types/request';

/** The store user `StoreJwtGuard` resolved for this request (RS-2). */
export const CurrentStoreUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedStoreUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.storeUser) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Store session required' });
    }
    return req.storeUser;
  },
);
