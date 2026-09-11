import { useClerk } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function LogoutButton() {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectUrl: basePath || "/" })}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      Sign out
    </button>
  );
}