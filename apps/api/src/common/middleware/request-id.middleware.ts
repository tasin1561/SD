import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const id = incoming && /^[a-zA-Z0-9_\-:.]{1,128}$/.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader(HEADER, id);
    next();
  }
}
