import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMPERSONATION_OTP_LENGTH,
  MIN_IMPERSONATION_REASON,
} from '../endpoints/admin-impersonation';

/**
 * Two numbers the browser counts against, and the server enforces.
 *
 * `admin-impersonation.ts` says of the reason floor: "the two being the
 * same is the point." Nothing was checking it. Drift is not dangerous —
 * the server refuses either way — but it is the UI lying to somebody who
 * is typing: a reason rejected after they finished it, or a valid one
 * blocked before they could send it. Both read as a broken form.
 *
 * Read off DISK because this package cannot import the API's DTOs.
 */
const DTO = join(
  __dirname,
  '../../../../apps/api/src/modules/impersonation/dto/impersonation.dto.ts',
);

function dtoSource(): string {
  return readFileSync(DTO, 'utf8');
}

describe('the impersonation form limits match the server', () => {
  it('the reason floor is the DTO’s floor', () => {
    const src = dtoSource();
    const m = /MIN_IMPERSONATION_REASON_LENGTH\s*=\s*(\d+)/.exec(src);
    expect(
      m?.[1],
      'MIN_IMPERSONATION_REASON_LENGTH not found in impersonation.dto.ts',
    ).toBeDefined();
    expect(Number(m?.[1])).toBe(MIN_IMPERSONATION_REASON);
  });

  it('the code field draws as many boxes as the DTO demands digits', () => {
    const src = dtoSource();
    // `@Length(6, 6)` — both halves, because a field that accepted 6 to 8
    // while the UI drew 6 boxes would be a form nobody could complete
    // with a longer code.
    const m = /@Length\((\d+),\s*(\d+)\)/.exec(src);
    expect(m, '@Length(n, n) not found in impersonation.dto.ts').not.toBeNull();
    expect(Number(m?.[1])).toBe(IMPERSONATION_OTP_LENGTH);
    expect(Number(m?.[2])).toBe(IMPERSONATION_OTP_LENGTH);
  });
});
