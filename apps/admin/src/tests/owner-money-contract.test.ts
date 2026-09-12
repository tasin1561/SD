import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The owner-money request names exactly the fields `OwnerMoneyDto`
 * declares. The API runs `forbidNonWhitelisted`, so one wrong name is a
 * 400 on every call — the feature would simply never work. The account
 * id travels in the PATH, never the body.
 */
const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

describe('owner money — client body matches the server DTO', () => {
  it('sends exactly the DTO fields, with the account in the path', () => {
    const dtoSrc = R('../../../api/src/modules/treasury/dto/treasury.dto.ts');
    const from = dtoSrc.indexOf('class OwnerMoneyDto');
    expect(from).toBeGreaterThan(-1);
    const block = dtoSrc.slice(from, dtoSrc.indexOf('class ', from + 6));
    const server = Array.from(
      block.matchAll(/^\s{2}(?:@[^\n]*\s)*([a-zA-Z][a-zA-Z0-9]*)[?!]:/gm),
      (m) => m[1] as string,
    ).sort();

    const hooks = R('../lib/ops-hooks.ts');
    const hookFrom = hooks.indexOf('export function useRecordOwnerMoney');
    expect(hookFrom).toBeGreaterThan(-1);
    const hookBlock = hooks.slice(hookFrom, hooks.indexOf('\n}\n', hookFrom));
    const typeBlock = hookBlock.slice(hookBlock.indexOf('{', hookBlock.indexOf('Error,')));
    const client = Array.from(
      typeBlock.slice(0, typeBlock.indexOf('}')).matchAll(/([a-zA-Z][a-zA-Z0-9]*)\??:/g),
      (m) => m[1] as string,
    )
      .filter((f) => f !== 'accountId')
      .sort();

    expect(server).toEqual([
      'amount',
      'direction',
      'idempotencyKey',
      'occurredAt',
      'reason',
      'reference',
    ]);
    expect(client).toEqual(server);
    expect(hookBlock).toContain('/api/admin/treasury/accounts/${accountId}/owner-money');
  });
});
