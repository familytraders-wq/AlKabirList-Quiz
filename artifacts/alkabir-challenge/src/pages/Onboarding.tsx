import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { useGetAuthMe } from "@workspace/api-client-react";

export function Onboarding() {
  const { isLoaded, isSignedIn } = useAuth();
  
  // Wait for auth to load
  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
      </div>
    );
  }

  // Not signed in -> send to sign in
  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  return <OnboardingContent />;
}

function OnboardingContent() {
  const { data: authMe, isLoading: isAuthLoading } = useGetAuthMe();
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile({
    query: {
      enabled: !!authMe?.onboardingRequired,
      queryKey: getGetMyProfileQueryKey()
    }
  });

  if (isAuthLoading || (authMe?.onboardingRequired && isProfileLoading)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
      </div>
    );
  }

  // If already onboarded, redirect to member home
  if (authMe && !authMe.onboardingRequired) {
    return <Redirect to="/member" />;
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 text-center">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Welcome to AlKabirList
          </h1>
          <p className="mt-4 text-lg leading-7 text-muted-foreground">
            Just a few more details to set up your account so you can participate in the daily challenges.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <ProfileForm initialData={profile ?? undefined} isOnboarding={true} />
        </div>
      </div>
    </div>
  );
}
