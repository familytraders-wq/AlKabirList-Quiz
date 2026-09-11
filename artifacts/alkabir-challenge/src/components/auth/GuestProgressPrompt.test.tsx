import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));
vi.mock("@clerk/react", () => ({ useAuth: () => authState }));

import { GuestProgressPrompt } from "./GuestProgressPrompt";

const stateResponse = () =>
  new Response(JSON.stringify({
    authenticated: true,
    guestProgress: { count: 2, hasUnlinkedProgress: true },
  }), { status: 200 });

describe("GuestProgressPrompt", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stateResponse()));
    document.cookie = "alkabir_csrf=test-csrf";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.cookie = "alkabir_csrf=; Max-Age=0";
  });

  it("offers confirmation and links with the CSRF cookie", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(stateResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({ linkedAttemptCount: 2 }), { status: 200 }),
    );
    render(<GuestProgressPrompt />);
    await screen.findByText("Save your guest progress?");

    fireEvent.click(screen.getByRole("button", { name: "Save guest progress" }));
    await waitFor(() => expect(screen.queryByText("Save your guest progress?")).not.toBeInTheDocument());

    const linkRequest = fetchMock.mock.calls[1];
    expect(linkRequest?.[0]).toContain("/api/auth/link-guest-progress");
    expect(linkRequest?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ confirm: true }),
    });
    expect(new Headers(linkRequest?.[1]?.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("dismisses without making a link request when Not now is selected", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<GuestProgressPrompt />);
    await screen.findByText("Save your guest progress?");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Save your guest progress?")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a failure and allows retrying the confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(stateResponse())
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ linkedAttemptCount: 2 }), { status: 200 }));
    render(<GuestProgressPrompt />);
    await screen.findByText("Save your guest progress?");
    fireEvent.click(screen.getByRole("button", { name: "Save guest progress" }));
    await screen.findByText("We could not save that progress. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Save guest progress" }));
    await waitFor(() => expect(screen.queryByText("Save your guest progress?")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});