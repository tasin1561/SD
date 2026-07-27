import { BadRequestException } from '@nestjs/common';
import { AttributeValueType } from '@skydrop/db';
import { VariantAttributeValidatorService } from '../../src/modules/catalog-variant/services/variant-attribute-validator.service';
import type { EffectiveAttribute } from '../../src/modules/catalog-attribute/services/attribute-resolution.service';

function def(
  partial: Partial<EffectiveAttribute> & Pick<EffectiveAttribute, 'attributeKey' | 'valueType'>,
): EffectiveAttribute {
  return {
    displayLabel: partial.attributeKey,
    allowedValues: [],
    isRequired: false,
    displayOrder: 0,
    sourceCategoryId: 'cat-1',
    ...partial,
  };
}

describe('VariantAttributeValidatorService', () => {
  const svc = new VariantAttributeValidatorService();

  it('accepts a fully valid attribute map', () => {
    const eff = [
      def({
        attributeKey: 'color',
        valueType: AttributeValueType.ENUM,
        allowedValues: ['Red', 'Blue'],
        isRequired: true,
      }),
      def({ attributeKey: 'count', valueType: AttributeValueType.NUMBER }),
      def({ attributeKey: 'gift', valueType: AttributeValueType.BOOLEAN }),
    ];
    expect(svc.collect(eff, { color: 'Red', count: 3, gift: true })).toEqual([]);
    expect(() => svc.validate(eff, { color: 'Red' })).not.toThrow();
  });

  it('flags a missing required attribute', () => {
    const eff = [
      def({ attributeKey: 'size', valueType: AttributeValueType.STRING, isRequired: true }),
    ];
    const errs = svc.collect(eff, {});
    expect(errs.some((e) => /Missing required attribute 'size'/.test(e))).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const eff = [def({ attributeKey: 'size', valueType: AttributeValueType.STRING })];
    const errs = svc.collect(eff, { size: 'M', bogus: 'x' });
    expect(errs.some((e) => /Unknown attribute 'bogus'/.test(e))).toBe(true);
  });

  it('enforces ENUM allowedValues', () => {
    const eff = [
      def({ attributeKey: 'color', valueType: AttributeValueType.ENUM, allowedValues: ['Red'] }),
    ];
    expect(svc.collect(eff, { color: 'Green' }).some((e) => /must be one of: Red/.test(e))).toBe(
      true,
    );
    expect(svc.collect(eff, { color: 'Red' })).toEqual([]);
  });

  it('enforces declared value types', () => {
    const eff = [
      def({ attributeKey: 'n', valueType: AttributeValueType.NUMBER }),
      def({ attributeKey: 'b', valueType: AttributeValueType.BOOLEAN }),
    ];
    const errs = svc.collect(eff, { n: 'not-a-number', b: 'nope' });
    expect(errs.some((e) => /'n' must be a finite number/.test(e))).toBe(true);
    expect(errs.some((e) => /'b' must be a boolean/.test(e))).toBe(true);
  });

  it('rejects non-primitive and null values', () => {
    const eff = [
      def({ attributeKey: 'a', valueType: AttributeValueType.STRING }),
      def({ attributeKey: 'c', valueType: AttributeValueType.STRING }),
    ];
    const errs = svc.collect(eff, { a: { nested: 1 }, c: null });
    expect(errs.some((e) => /'a' must be a primitive/.test(e))).toBe(true);
    expect(errs.some((e) => /'c' must not be null/.test(e))).toBe(true);
  });

  it('validate() throws BadRequestException carrying the collected errors', () => {
    const eff = [
      def({ attributeKey: 'size', valueType: AttributeValueType.STRING, isRequired: true }),
    ];
    let thrown: unknown;
    try {
      svc.validate(eff, { unknown: 1 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const res = (thrown as BadRequestException).getResponse() as {
      code: string;
      errors: string[];
    };
    expect(res.code).toBe('ATTRIBUTE_VALIDATION_FAILED');
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });
});
