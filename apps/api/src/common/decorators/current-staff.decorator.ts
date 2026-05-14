import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedStaff } from '../types/request';

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.staff) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Staff session required' });
    }
    return req.staff;
  },
);
