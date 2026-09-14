import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedStoreApiKey } from '../types/request';

/** The store API key `StoreApiKeyGuard` resolved for this request (RS-5). */
export const CurrentStoreApiKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedStoreApiKey => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.storeApiKey) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Store API key required' });
    }
    return req.storeApiKey;
  },
);
