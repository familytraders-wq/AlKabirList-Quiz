import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/Home";
import { Quiz } from "@/pages/Quiz";

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#0b3b2d",
    colorForeground: "#181c1a",
    colorMutedForeground: "#66716b",
    colorDanger: "#b42318",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#181c1a",
    colorNeutral: "#e2e0d8",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#181c1a]",
    headerSubtitle: "text-[#66716b]",
    socialButtonsBlockButtonText: "text-[#181c1a]",
    formFieldLabel: "text-[#181c1a]",
    footerActionLink: "text-[#0b3b2d]",
    footerActionText: "text-[#66716b]",
    dividerText: "text-[#66716b]",
    identityPreviewEditButton: "text-[#0b3b2d]",
    formFieldSuccessText: "text-[#217346]",
    alertText: "text-[#b42318]",
    logoBox: "h-12",
    logoImage: "h-12",
    socialButtonsBlockButton: "border-[#e2e0d8] bg-white",
    formButtonPrimary: "bg-[#0b3b2d] hover:bg-[#14513e]",
    formFieldInput: "border-[#e2e0d8] text-[#181c1a]",
    footerAction: "text-[#66716b]",
    dividerLine: "bg-[#e2e0d8]",
    alert: "border-[#f2c5c2] bg-[#fff6f5]",
    otpCodeFieldInput: "border-[#e2e0d8] text-[#181c1a]",
    formFieldRow: "text-[#181c1a]",
    main: "bg-white",
  },
};

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
  const response = await fetch(`${basePath}/api/auth/link-guest-progress`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token":
        document.cookie
          .split("; ")
          .find((part) => part.startsWith("alkabir_csrf="))
          ?.split("=")
          .slice(1)
          .join("=") ?? "",
    },
    body: JSON.stringify({ confirm: true }),
  });
  if (!response.ok) {
    throw new Error("Guest progress could not be linked");
  }
  return response.json() as Promise<{ linkedAttemptCount: number }>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <Redirect to="/member" /> : <Home />;
}

function MemberHome() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <Home /> : <Redirect to="/" />;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function GuestProgressPrompt() {
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

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/member" component={MemberHome} />
        <Route path="/quiz" component={Quiz} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to continue your learning journey",
          },
        },
        signUp: {
          start: {
            title: "Create your AlKabirList account",
            subtitle: "Save progress and keep learning",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <ClerkQueryClientCacheInvalidator />
          <Router />
          <GuestProgressPrompt />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;