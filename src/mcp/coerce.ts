import { z } from 'zod';

/**
 * Wrap Zod schema fields with z.preprocess() to coerce string values from MCP
 * clients that serialize all parameters as strings.
 *
 * This must happen at the schema level because the MCP SDK validates arguments
 * against the Zod schema BEFORE calling the tool handler.
 */
export function coerceShape<T extends Record<string, z.ZodTypeAny>>(shape: T): T {
  const result: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(shape)) {
    const inner = unwrapType(field);
    if (inner instanceof z.ZodBoolean) {
      result[key] = z.preprocess(coerceBool, field);
    } else if (inner instanceof z.ZodNumber) {
      result[key] = z.preprocess(coerceNum, field);
    } else if (inner instanceof z.ZodArray) {
      result[key] = z.preprocess(coerceArr, field);
    } else {
      result[key] = field;
    }
  }
  return result as T;
}

/** Unwrap ZodOptional / ZodDefault / ZodNullable wrappers to find the base type. */
function unwrapType(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  while (
    s instanceof z.ZodOptional ||
    s instanceof z.ZodDefault ||
    s instanceof z.ZodNullable
  ) {
    // Zod internal: Optional/Default/Nullable all store wrapped type as innerType
    s = (s._def as unknown as { innerType: z.ZodTypeAny }).innerType;
  }
  return s;
}

/** "true"/"1" -> true, "false"/"0" -> false, pass through otherwise. */
function coerceBool(val: unknown): unknown {
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  return val;
}

/** String number -> number when finite, pass through otherwise. */
function coerceNum(val: unknown): unknown {
  if (typeof val === 'string' && val !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return val;
}

/** JSON string -> array if valid, pass through otherwise. */
function coerceArr(val: unknown): unknown {
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not valid JSON */ }
  }
  return val;
}
