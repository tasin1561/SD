import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SetConfirmationCallsDto } from '../../src/modules/order/dto/confirmation-calls-setting.dto';

const errs = (o: object) => validateSync(plainToInstance(SetConfirmationCallsDto, o)).length;

describe('SetConfirmationCallsDto ttlMinutes bounds (5..10080)', () => {
  it.each([5, 90, 10080])('accepts %i', (n) =>
    expect(errs({ callsRequired: false, ttlMinutes: n })).toBe(0),
  );
  it.each([0, 4, 10081, 1.5])('rejects %s', (n) =>
    expect(errs({ callsRequired: false, ttlMinutes: n })).toBeGreaterThan(0),
  );
  it('still accepts hours alone', () =>
    expect(errs({ callsRequired: false, ttlHours: 6 })).toBe(0));
});
