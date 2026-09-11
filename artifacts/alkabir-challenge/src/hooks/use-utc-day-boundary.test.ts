import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveChallengeDateLabel,
  useUtcDayBoundary,
} from "./use-utc-day-boundary";

describe("resolveChallengeDateLabel", () => {
  it("keeps a server-issued attempt date after the live UTC day changes", () => {
    expect(resolveChallengeDateLabel("2025-01-02", "January 3, 2025")).toBe(
      "Thursday, January 2, 2025 (UTC)",
    );
  });

  it("uses the live UTC date before an attempt exists", () => {
    expect(resolveChallengeDateLabel(undefined, "January 3, 2025")).toBe(
      "January 3, 2025",
    );
  });
});

describe("useUtcDayBoundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the UTC calendar date regardless of the viewer timezone", () => {
    vi.setSystemTime(new Date("2025-01-02T00:30:00.000Z"));

    const { result } = renderHook(() => useUtcDayBoundary());

    expect(result.current.challengeDate).toBe("2025-01-02");
  });

  it("refreshes at the next UTC midnight", () => {
    vi.setSystemTime(new Date("2025-01-02T23:59:59.000Z"));
    const { result } = renderHook(() => useUtcDayBoundary());

    expect(result.current.challengeDate).toBe("2025-01-02");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.challengeDate).toBe("2025-01-03");
  });

  it("refreshes when a stale tab becomes visible or focused", () => {
    vi.setSystemTime(new Date("2025-01-02T23:00:00.000Z"));
    const { result } = renderHook(() => useUtcDayBoundary());
    expect(result.current.challengeDate).toBe("2025-01-02");

    vi.setSystemTime(new Date("2025-01-03T01:00:00.000Z"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.challengeDate).toBe("2025-01-03");

    vi.setSystemTime(new Date("2025-01-04T01:00:00.000Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.challengeDate).toBe("2025-01-04");
  });
});