import { Prisma } from '@skydrop/db';

/**
 * True when `err` is Postgres refusing an insert on a unique index
 * (Prisma P2002). An idempotency-keyed write treats it as "the same
 * request already won the race" and answers with that request's result.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
