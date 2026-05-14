import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedSeller } from '../types/request';

export const CurrentSeller = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedSeller => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.seller) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Seller session required' });
    }
    return req.seller;
  },
);
