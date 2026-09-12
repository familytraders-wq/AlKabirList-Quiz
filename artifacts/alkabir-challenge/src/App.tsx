import { useEffect, useRef, type ReactNode } from "react";
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
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/Home";
import { Quiz } from "@/pages/Quiz";
import { AdminUsers } from "@/pages/AdminUsers";
import { AdminContent } from "@/pages/AdminContent";
import { AdminSchedule } from "@/pages/AdminSchedule";
import { AdminBeta } from "@/pages/AdminBeta";
import { Onboarding } from "@/pages/Onboarding";
import { Profile } from "@/pages/Profile";
import { Feedback } from "@/pages/Feedback";
import { GuestProgressPrompt } from "@/components/auth/GuestProgressPrompt";
import { useGetAuthMe, getGetAuthMeQueryKey } from "@workspace/api-client-react";
import { Navbar } from "@/components/layout/Navbar";

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

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <Redirect to="/member" /> : <Home />;
}

function RequireProfileComplete({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading } = useGetAuthMe({
    query: {
      enabled: isLoaded && isSignedIn,
      queryKey: getGetAuthMeQueryKey()
    }
  });

  if (!isLoaded || (isSignedIn && isLoading)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
      </div>
    );
  }

  if (isSignedIn && authMe?.onboardingRequired) {
    return <Redirect to="/onboarding" />;
  }

  return <>{children}</>;
}

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading } = useGetAuthMe({
    query: { enabled: isLoaded && isSignedIn, queryKey: getGetAuthMeQueryKey() },
  });
  if (!isLoaded || (isSignedIn && isLoading)) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div>;
  }
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  const user = authMe?.user;
  if (!user || (!user.isSuperAdmin && !(user.permissions ?? []).includes(permission))) return <Redirect to="/member" />;
  return <>{children}</>;
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

function ApplicationPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      {children}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/member">
          <RequireProfileComplete>
            <MemberHome />
          </RequireProfileComplete>
        </Route>
        <Route path="/quiz">
          <RequireProfileComplete>
            <Quiz />
          </RequireProfileComplete>
        </Route>
        <Route path="/admin/users">
          <RequirePermission permission="access.view"><ApplicationPage><AdminUsers /></ApplicationPage></RequirePermission>
        </Route>
        <Route path="/admin/content">
          <RequirePermission permission="content.view"><ApplicationPage><AdminContent /></ApplicationPage></RequirePermission>
        </Route>
        <Route path="/admin/schedule">
          <RequirePermission permission="schedule.view"><ApplicationPage><AdminSchedule /></ApplicationPage></RequirePermission>
        </Route>
        <Route path="/admin/beta">
          <RequirePermission permission="beta.view"><ApplicationPage><AdminBeta /></ApplicationPage></RequirePermission>
        </Route>
        <Route path="/onboarding">
          <ApplicationPage><Onboarding /></ApplicationPage>
        </Route>
        <Route path="/profile" component={Profile} />
        <Route path="/feedback">
          <RequireProfileComplete>
            <Feedback />
          </RequireProfileComplete>
        </Route>
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