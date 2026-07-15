/** Validation for numeric CLI flag values. Pure. */

function toNumber(raw: string): number {
  // Number("") and Number("  ") are 0; treat blank input as invalid instead.
  return raw.trim() === "" ? NaN : Number(raw);
}

/**
 * Parse an integer flag value. Throws with a clear message when the raw
 * string is not an integer or falls outside [min, max].
 */
export function parseIntegerFlag(flag: string, raw: string, min: number, max?: number): number {
  const value = toNumber(raw);
  const range = max === undefined ? `an integer >= ${min}` : `an integer between ${min} and ${max}`;
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new Error(`--${flag} must be ${range}, got "${raw}"`);
  }
  return value;
}

/**
 * Parse a (possibly fractional) numeric flag value. Throws when the raw
 * string is not a finite number or falls outside [min, max].
 */
export function parseNumberFlag(flag: string, raw: string, min: number, max: number): number {
  const value = toNumber(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${flag} must be a number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}
