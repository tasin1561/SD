import { ToolError, type ToolInputSchema } from './assistant.types';

/**
 * Validates a tool call's input against the SAME schema that was sent to
 * the model — one source of truth, so what the model was told and what
 * is enforced cannot drift apart. `strict: true` makes the API enforce
 * it too; this is the second lock, because a stream can be truncated and
 * because the API contract is not ours to rely on for a security
 * boundary.
 *
 * Unknown keys are REFUSED (not dropped): a model that invents a
 * `sellerId` argument gets told no, and the attempt is visible in the
 * tool-call audit rows.
 */
export function validateToolInput(schema: ToolInputSchema, raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('INVALID_INPUT', 'Tool input must be an object.');
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(key in schema.properties)) {
      throw new ToolError('INVALID_INPUT', `Unknown argument "${key}".`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    const value = input[name];
    if (value === undefined) {
      if (schema.required.includes(name)) {
        throw new ToolError('INVALID_INPUT', `Missing argument "${name}".`);
      }
      continue;
    }
    if (prop.type === 'string') {
      if (typeof value !== 'string') {
        throw new ToolError('INVALID_INPUT', `"${name}" must be text.`);
      }
      const v = value.trim();
      if (prop.minLength !== undefined && v.length < prop.minLength) {
        throw new ToolError('INVALID_INPUT', `"${name}" is too short.`);
      }
      if (prop.maxLength !== undefined && v.length > prop.maxLength) {
        throw new ToolError('INVALID_INPUT', `"${name}" is too long.`);
      }
      if (prop.enum !== undefined && !prop.enum.includes(v)) {
        throw new ToolError('INVALID_INPUT', `"${name}" must be one of: ${prop.enum.join(', ')}.`);
      }
      out[name] = v;
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ToolError('INVALID_INPUT', `"${name}" must be a whole number.`);
      }
      if (prop.minimum !== undefined && value < prop.minimum) {
        throw new ToolError('INVALID_INPUT', `"${name}" is too small.`);
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        throw new ToolError('INVALID_INPUT', `"${name}" is too large.`);
      }
      out[name] = value;
    }
  }
  return out;
}
