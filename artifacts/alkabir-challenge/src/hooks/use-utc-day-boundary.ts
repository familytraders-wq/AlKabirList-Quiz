import { useEffect, useMemo, useState } from "react";
import {
  formatChallengeDateUTC,
  formatNextChallengeReset,
  getChallengeDate,
  getNextChallengeReset,
} from "@/data/quiz";

export function resolveChallengeDateLabel(
  attemptChallengeDate: string | undefined,
  liveChallengeDate: string,
) {
  return attemptChallengeDate
    ? formatChallengeDateUTC(attemptChallengeDate)
    : liveChallengeDate;
}

/**
 * Keeps date-only challenge UI in sync with the UTC calendar day.
 *
 * The timer handles an open tab crossing midnight. The visibility and focus
 * listeners handle a tab which was suspended while the reset occurred.
 */
export function useUtcDayBoundary() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const resetAt = getNextChallengeReset(now).getTime();
    const delay = Math.max(0, resetAt - Date.now());
    const timeout = window.setTimeout(refresh, delay);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [now]);

  return useMemo(() => {
    const challengeDate = getChallengeDate(now);
    return {
      now,
      challengeDate,
      formattedChallengeDate: formatChallengeDateUTC(challengeDate),
      nextReset: formatNextChallengeReset(now),
    };
  }, [now]);
}

// Keep the acronym spelling available to callers that prefer it.
export const useUTCDayBoundary = useUtcDayBoundary;