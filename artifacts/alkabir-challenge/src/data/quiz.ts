/**
 * The challenge date is always the UTC calendar date. Viewer-local formatting
 * is only used for explaining when the next UTC reset will be visible locally.
 */
export function getChallengeDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function formatChallengeDateUTC(challengeDate: string = getChallengeDate()): string {
  const [year, month, day] = challengeDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return `${new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)} (UTC)`;
}

export function getNextChallengeReset(now: Date = new Date()): Date {
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);
  return nextReset;
}

export function formatNextChallengeReset(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(getNextChallengeReset(now));
}
