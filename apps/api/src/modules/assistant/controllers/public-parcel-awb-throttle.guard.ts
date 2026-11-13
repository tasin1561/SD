import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { isPublicAwb } from '../assistant-public-parcel';

/** Questions one AWB may receive per hour, whoever asks. */
export const PUBLIC_PARCEL_AWB_LIMIT = 20;
export const PUBLIC_PARCEL_AWB_TTL_MS = 60 * 60 * 1000;
const NAME = 'public-parcel-awb';

/**
 * The per-AWB throttle of the public parcel helper, on the app's existing
 * throttler storage (Redis), next to the per-IP one the controller declares.
 *
 * It counts BEFORE the parcel is looked up, and for any well-formed AWB
 * whether or not it exists: if the limit applied only to real parcels, a 429
 * would tell a stranger which numbers are real. A malformed value is not
 * counted (it cannot be a key flood) and gets the normal 404 later.
 *
 * The key is a hash, so the stored key is a fixed length whatever is sent.
 */
@Injectable()
export class PublicParcelAwbThrottleGuard implements CanActivate {
  constructor(@Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ params?: Record<string, unknown> }>();
    const awb = req.params?.['awb'];
    if (!isPublicAwb(awb)) return true;
    const key = `${NAME}:${createHash('sha256').update(awb.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
    const record = await this.storage.increment(
      key,
      PUBLIC_PARCEL_AWB_TTL_MS,
      PUBLIC_PARCEL_AWB_LIMIT,
      0,
      NAME,
    );
    if (record.totalHits > PUBLIC_PARCEL_AWB_LIMIT) throw new ThrottlerException();
    return true;
  }
}
