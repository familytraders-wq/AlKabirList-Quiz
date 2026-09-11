import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";

type AdminUser = { id: string; createdAt: string; roles: ("reviewer" | "admin")[] };

function csrfToken() {
  return document.cookie.split("; ").find((part) => part.startsWith("alkabir_csrf="))?.split("=")[1] ?? "";
}

export function AdminUsers() {
  const { isLoaded, isSignedIn } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((state: { user?: { roles: string[] } | null }) => {
        const isAdmin = state.user?.roles.includes("admin") ?? false;
        setAllowed(isAdmin);
        if (!isAdmin) return;
        return fetch("/api/admin/users", { credentials: "same-origin" })
          .then((response) => {
            if (!response.ok) throw new Error("Could not load users");
            return response.json() as Promise<{ items: AdminUser[] }>;
          })
          .then((result) => setUsers(result.items));
      })
      .catch(() => setError("Could not load access records."));
  }, [isLoaded, isSignedIn]);

  async function changeRole(user: AdminUser, role: "reviewer" | "admin", action: "grant" | "revoke") {
    const verb = action === "grant" ? "Grant" : "Revoke";
    if (!window.confirm(`${verb} ${role} access for this internal user?`)) return;
    setBusy(`${user.id}:${role}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/roles`, {
        method: action === "grant" ? "POST" : "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "Role change failed");
      }
      const result = await response.json() as AdminUser;
      setUsers((current) => current.map((entry) => entry.id === result.id ? result : entry));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Role change failed");
    } finally {
      setBusy(null);
    }
  }

  if (!isLoaded || (isSignedIn && allowed === null)) return <main className="mx-auto max-w-4xl p-8">Loading access records…</main>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!allowed) return <Redirect to="/member" />;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Access management</h1>
        <p className="mt-2 text-muted-foreground">Manage reviewer and administrator access. Personal profile information is not shown.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Internal users and access roles</caption>
          <thead className="bg-muted"><tr><th className="p-3">User ID</th><th className="p-3">Roles</th><th className="p-3">Actions</th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id} className="border-t border-border">
            <td className="p-3 font-mono text-xs">{user.id}</td>
            <td className="p-3">{user.roles.length ? user.roles.join(", ") : "member"}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              {(["reviewer", "admin"] as const).map((role) => {
                const assigned = user.roles.includes(role);
                return <Button key={role} size="sm" variant={assigned ? "outline" : "default"} disabled={busy === `${user.id}:${role}`} onClick={() => void changeRole(user, role, assigned ? "revoke" : "grant")}>
                  {assigned ? `Revoke ${role}` : `Grant ${role}`}
                </Button>;
              })}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}