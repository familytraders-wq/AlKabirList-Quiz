import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

async function readAuthState(): Promise<{
  authenticated: boolean;
  guestProgress: { count: number; hasUnlinkedProgress: boolean };
}> {
  const response = await fetch(`${basePath}/api/auth/me`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to read account state");
  return response.json() as Promise<{
    authenticated: boolean;
    guestProgress: { count: number; hasUnlinkedProgress: boolean };
  }>;
}

async function linkGuestProgress(): Promise<{ linkedAttemptCount: number }> {
  const csrfToken = document.cookie
    .split("; ")
    .find((part) => part.startsWith("alkabir_csrf="))
    ?.split("=")
    .slice(1)
    .join("=") ?? "";
  const response = await fetch(`${basePath}/api/auth/link-guest-progress`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ confirm: true }),
  });
  if (!response.ok) throw new Error("Guest progress could not be linked");
  return response.json() as Promise<{ linkedAttemptCount: number }>;
}

export function GuestProgressPrompt() {
  const { isLoaded, isSignedIn } = useAuth();
  const [prompt, setPrompt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || dismissed) return;
    let cancelled = false;
    void readAuthState()
      .then((state) => {
        if (!cancelled && state.authenticated && state.guestProgress.hasUnlinkedProgress) {
          setPrompt(state.guestProgress.count);
        }
      })
      .catch(() => {
        // The landing page remains usable if the optional account bridge is
        // temporarily unavailable; no progress is linked implicitly.
      });
    return () => {
      cancelled = true;
    };
  }, [dismissed, isLoaded, isSignedIn]);

  if (prompt === null) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
      <p className="font-serif text-xl font-semibold text-foreground">
        Save your guest progress?
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        We found {prompt} guest {prompt === 1 ? "attempt" : "attempts"} on this
        device. Choose whether to add it to your new account. Nothing is linked
        without your confirmation.
      </p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="ghost"
          onClick={() => {
            setDismissed(true);
            setPrompt(null);
          }}
        >
          Not now
        </Button>
        <Button
          disabled={linking}
          onClick={() => {
            setLinking(true);
            setError(null);
            void linkGuestProgress()
              .then(() => {
                setPrompt(null);
                setDismissed(true);
              })
              .catch(() => setError("We could not save that progress. Please try again."))
              .finally(() => setLinking(false));
          }}
        >
          {linking ? "Saving…" : "Save guest progress"}
        </Button>
      </div>
    </div>
  );
}