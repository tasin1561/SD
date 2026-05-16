import { BadRequestException, Injectable } from '@nestjs/common';
import { AttributeValueType } from '@skydrop/db';
import type { EffectiveAttribute } from '../../catalog-attribute/services/attribute-resolution.service';

type Primitive = string | number | boolean;

function isPrimitive(v: unknown): v is Primitive {
  return (
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  );
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Validates a variant's `attributes` map against the effective attribute
 * set for its product's category. Strict for Phase 1A: every required
 * attribute must be present, values must match the declared valueType,
 * ENUM values must be in allowedValues, values must be primitives, and
 * unknown keys are rejected. ALL problems are collected and returned in
 * one response so a seller can fix their input in a single pass.
 */
@Injectable()
export class VariantAttributeValidatorService {
  validate(
    effective: EffectiveAttribute[],
    attributes: Record<string, unknown>,
  ): void {
    const errors: string[] = [];
    const defByKey = new Map(effective.map((d) => [d.attributeKey, d]));
    const allowedKeys = [...defByKey.keys()].sort();

    // 1) Unknown keys (strict).
    for (const key of Object.keys(attributes)) {
      if (!defByKey.has(key)) {
        errors.push(
          allowedKeys.length > 0
            ? `Unknown attribute '${key}' — not defined for this product's category. Allowed: ${allowedKeys.join(', ')}`
            : `Unknown attribute '${key}' — this product's category defines no attributes (or the product has no category)`,
        );
      }
    }

    // 2) Per-defined-attribute checks.
    for (const def of effective) {
      const present = Object.prototype.hasOwnProperty.call(
        attributes,
        def.attributeKey,
      );
      if (!present) {
        if (def.isRequired) {
          errors.push(`Missing required attribute '${def.attributeKey}'`);
        }
        continue;
      }
      const value = attributes[def.attributeKey];

      if (value === null || value === undefined) {
        errors.push(
          `Attribute '${def.attributeKey}' must not be ${value === null ? 'null' : 'undefined'}`,
        );
        continue;
      }
      if (!isPrimitive(value)) {
        errors.push(
          `Attribute '${def.attributeKey}' must be a primitive (string/number/boolean); got ${describeType(value)}`,
        );
        continue;
      }

      switch (def.valueType) {
        case AttributeValueType.STRING:
          if (typeof value !== 'string') {
            errors.push(
              `Attribute '${def.attributeKey}' must be a string (got ${describeType(value)})`,
            );
          }
          break;
        case AttributeValueType.NUMBER:
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(
              `Attribute '${def.attributeKey}' must be a finite number (got ${describeType(value)})`,
            );
          }
          break;
        case AttributeValueType.BOOLEAN:
          if (typeof value !== 'boolean') {
            errors.push(
              `Attribute '${def.attributeKey}' must be a boolean (got ${describeType(value)})`,
            );
          }
          break;
        case AttributeValueType.ENUM:
          if (typeof value !== 'string' || !def.allowedValues.includes(value)) {
            errors.push(
              `Attribute '${def.attributeKey}' must be one of: ${def.allowedValues.join(', ')} (got ${JSON.stringify(value)})`,
            );
          }
          break;
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'ATTRIBUTE_VALIDATION_FAILED',
        message: 'Variant attributes do not satisfy the category attribute schema',
        errors,
      });
    }
  }
}
