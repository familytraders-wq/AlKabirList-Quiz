import { useGetMyProfile, getGetMyProfileQueryKey, useGetAuthMe } from "@workspace/api-client-react";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Navbar } from "@/components/layout/Navbar";

export function Profile() {
  const { isLoaded, isSignedIn } = useAuth();
  
  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  return <ProfileContent />;
}

function ProfileContent() {
  const { data: authMe, isLoading: isAuthLoading } = useGetAuthMe();
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile({
    query: {
      enabled: !isAuthLoading && !!authMe && !authMe.onboardingRequired,
      queryKey: getGetMyProfileQueryKey()
    }
  });

  if (isAuthLoading || (authMe && !authMe.onboardingRequired && isProfileLoading)) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Navbar />
        <div className="flex items-center justify-center pt-32">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
        </div>
      </div>
    );
  }

  // If onboarding is required, redirect to onboarding
  if (authMe?.onboardingRequired) {
    return <Redirect to="/onboarding" />;
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <Navbar />
      
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
            Account Profile
          </h1>
          <p className="mt-2 text-muted-foreground">
            Update your personal details and location.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <ProfileForm initialData={profile ?? undefined} isOnboarding={false} />
        </div>
      </main>
    </div>
  );
}
