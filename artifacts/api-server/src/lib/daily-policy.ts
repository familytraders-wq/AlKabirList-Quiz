export const DAILY_TIME_ZONE = "UTC";

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CanonicalDate = `${number}-${number}-${number}`;

/**
 * Returns the date that the service uses for daily challenge and streak
 * decisions. Date-only values are deliberately derived from the UTC
 * representation, never from the server's local timezone.
 */
export function canonicalDateAt(instant: Date | string | number): CanonicalDate {
  const date = instant instanceof Date ? instant : new Date(instant);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A valid instant is required.");
  }

  return date.toISOString().slice(0, 10) as CanonicalDate;
}

export function canonicalDateFrom(value: string): CanonicalDate {
  assertCanonicalDate(value);
  return value;
}

export function assertCanonicalDate(value: string): asserts value is CanonicalDate {
  if (!CANONICAL_DATE_PATTERN.test(value)) {
    throw new RangeError(`Invalid canonical date: "${value}".`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || canonicalDateAt(parsed) !== value) {
    throw new RangeError(`Invalid canonical date: "${value}".`);
  }
}

export function addUtcDays(value: CanonicalDate, days: number): CanonicalDate {
  assertCanonicalDate(value);

  if (!Number.isInteger(days)) {
    throw new RangeError("The number of UTC days must be an integer.");
  }

  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return canonicalDateAt(instant + days * 24 * 60 * 60 * 1000);
}

export function isNextUtcDay(
  previous: CanonicalDate,
  current: CanonicalDate,
): boolean {
  return addUtcDays(previous, 1) === current;
}