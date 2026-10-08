import { validationMessages } from '../../src/common/validation/validation-messages';
import type { ValidationError } from 'class-validator';

const err = (
  property: string,
  constraints: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, constraints, children }) as ValidationError;

/*
  The shape found on the live API: omit `recipientAddressLine2` and every
  constraint on it fails at once, so the sentence a person reads is
  whichever decorator sits last in the file — "must be shorter than or
  equal to 200 characters", about a field they never sent.
*/
describe('validationMessages', () => {
  it('a MISSING field reports only that it is missing', () => {
    const out = validationMessages([
      err('recipientAddressLine2', {
        maxLength: 'recipientAddressLine2 must be shorter than or equal to 200 characters',
        isNotEmpty: 'recipientAddressLine2 (landmark) is required',
        isString: 'recipientAddressLine2 must be a string',
      }),
    ]);
    expect(out).toEqual(['recipientAddressLine2 (landmark) is required']);
    // The defect, stated as an assertion: never lead with a length
    // complaint about a value that was not sent.
    expect(out[0]).not.toMatch(/shorter than|must be a string/);
  });

  it('a field that WAS sent keeps every complaint — each is true of it', () => {
    const out = validationMessages([
      err('password', {
        minLength: 'password must be at least 10 characters',
        matches: 'password must contain a number',
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out).toContain('password must be at least 10 characters');
  });

  it('keeps every field, so a form learns all of its problems at once', () => {
    const out = validationMessages([
      err('a', { isNotEmpty: 'a is required' }),
      err('b', { isString: 'b must be a string' }),
    ]);
    expect(out).toEqual(['a is required', 'b must be a string']);
  });

  it('walks nested errors — the row a form has to mark', () => {
    const out = validationMessages([
      err('items', {}, [
        err('0', {}, [err('quantity', { min: 'quantity must not be less than 1' })]),
      ]),
    ]);
    expect(out).toEqual(['quantity must not be less than 1']);
  });

  it('survives an error carrying no constraints at all', () => {
    // class-validator gives a parent of nested failures no constraints.
    expect(validationMessages([err('items', {})])).toEqual([]);
    expect(validationMessages([])).toEqual([]);
  });

  it('treats isDefined and arrayNotEmpty as missing too', () => {
    expect(
      validationMessages([
        err('items', {
          arrayNotEmpty: 'items should not be empty',
          arrayMaxSize: 'items must contain no more than 200 elements',
        }),
      ]),
    ).toEqual(['items should not be empty']);
    expect(
      validationMessages([
        err('x', { isDefined: 'x should not be null or undefined', isInt: 'x must be an integer' }),
      ]),
    ).toEqual(['x should not be null or undefined']);
  });
});
