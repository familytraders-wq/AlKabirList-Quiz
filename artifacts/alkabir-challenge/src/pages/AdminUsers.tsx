import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";

type Permission = "content.view" | "content.manage" | "schedule.view" | "schedule.manage" | "beta.view" | "beta.manage" | "access.view" | "access.manage";
type AdminUser = {
  id: string;
  createdAt: string;
  roles: ("reviewer" | "admin")[];
  isSuperAdmin: boolean;
  permissions: string[];
  template: { id: string; name: string } | null;
  overrides: { permission: string; effect: "allow" | "deny" }[];
};
type PermissionTemplate = { id: string; name: string; description: string; permissions: string[] };

function csrfToken() {
  return document.cookie.split("; ").find((part) => part.startsWith("alkabir_csrf="))?.split("=")[1] ?? "";
}

export function AdminUsers() {
  const { isLoaded, isSignedIn } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templatePermissions, setTemplatePermissions] = useState<Permission[]>(["content.view"]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((state: { user?: { roles: string[]; isSuperAdmin?: boolean; permissions?: string[] } | null }) => {
        const access = state.user?.isSuperAdmin || state.user?.permissions?.includes("access.view") || false;
        setIsSuperAdmin(state.user?.isSuperAdmin ?? false);
        setAllowed(access);
        if (!access) return;
        return Promise.all([
          fetch("/api/admin/users", { credentials: "same-origin" }),
          state.user?.isSuperAdmin ? fetch("/api/admin/permission-templates", { credentials: "same-origin" }) : Promise.resolve(null),
        ])
          .then(async ([usersResponse, templatesResponse]) => {
            if (!usersResponse.ok) throw new Error("Could not load users");
            setUsers((await usersResponse.json() as { items: AdminUser[] }).items);
            if (templatesResponse?.ok) setTemplates((await templatesResponse.json() as { items: PermissionTemplate[] }).items);
          });
      })
      .catch(() => setError("Could not load access records."));
  }, [isLoaded, isSignedIn]);

  async function changeRole(user: AdminUser, role: "reviewer" | "admin", action: "grant" | "revoke") {
    if (!isSuperAdmin || user.isSuperAdmin) return;
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

  async function createTemplate() {
    if (!templateName.trim() || !isSuperAdmin) return;
    setBusy("template");
    try {
      const response = await fetch("/api/admin/permission-templates", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ name: templateName.trim(), permissions: templatePermissions }),
      });
      if (!response.ok) throw new Error("Template could not be created");
      const created = await response.json() as PermissionTemplate;
      setTemplates((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Template could not be created");
    } finally { setBusy(null); }
  }

  async function assignTemplate(userId: string, templateId: string) {
    if (!isSuperAdmin) return;
    setBusy(`${userId}:template`);
    try {
      const response = await fetch(`/api/admin/users/${userId}/permission-template`, {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ templateId }),
      });
      if (!response.ok) throw new Error("Template assignment failed");
      const updated = await response.json() as AdminUser;
      setUsers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Template assignment failed");
    } finally { setBusy(null); }
  }

  async function deleteTemplate(template: PermissionTemplate) {
    if (!isSuperAdmin || !window.confirm(`Delete the ${template.name} template?`)) return;
    setBusy(`template:${template.id}`);
    try {
      const response = await fetch(`/api/admin/permission-templates/${template.id}`, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken() },
      });
      if (!response.ok) throw new Error("Template could not be deleted");
      setTemplates((current) => current.filter((entry) => entry.id !== template.id));
      setUsers((current) => current.map((user) => user.template?.id === template.id ? { ...user, template: null } : user));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Template could not be deleted");
    } finally { setBusy(null); }
  }

  async function setOverride(userId: string, permission: string, effect: "allow" | "deny") {
    if (!isSuperAdmin) return;
    setBusy(`${userId}:override`);
    try {
      const response = await fetch(`/api/admin/users/${userId}/permission-overrides`, {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ permission, effect }),
      });
      if (!response.ok) throw new Error("Override update failed");
      const updated = await response.json() as AdminUser;
      setUsers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : "Override update failed");
    } finally { setBusy(null); }
  }

  if (!isLoaded || (isSignedIn && allowed === null)) return <main className="mx-auto max-w-4xl p-8">Loading access records…</main>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!allowed) return <Redirect to="/member" />;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Access management</h1>
       <p className="mt-2 text-muted-foreground">These are app-internal user IDs, not sample users or Clerk IDs. Personal profile information is not shown.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">{error}</p>}
       {isSuperAdmin && <section className="space-y-3 rounded-xl border border-border p-4">
         <h2 className="font-semibold">Permission templates</h2>
         <p className="text-sm text-muted-foreground">Reusable access sets are managed only by the protected Super Admin.</p>
         <div className="flex flex-wrap items-center gap-2">
           <input aria-label="Template name" className="h-9 rounded-md border px-3 text-sm" placeholder="Template name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
           {(["content.view", "content.manage", "schedule.view", "schedule.manage", "beta.view", "beta.manage", "access.view", "access.manage"] as Permission[]).map((permission) => <label key={permission} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={templatePermissions.includes(permission)} onChange={(event) => setTemplatePermissions((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} />{permission}</label>)}
           <Button size="sm" disabled={busy === "template"} onClick={() => void createTemplate()}>Create template</Button>
         </div>
         {templates.length > 0 && <ul className="grid gap-2 text-sm md:grid-cols-2">{templates.map((template) => <li key={template.id} className="flex items-center justify-between gap-2 rounded-md bg-muted p-2"><span><strong>{template.name}</strong><span className="ml-2 text-muted-foreground">{template.permissions.join(", ")}</span></span><Button size="sm" variant="outline" disabled={busy === `template:${template.id}`} onClick={() => void deleteTemplate(template)}>Delete</Button></li>)}</ul>}
       </section>}
       <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Internal users and access roles</caption>
           <thead className="bg-muted"><tr><th className="p-3">Internal user ID</th><th className="p-3">Roles / status</th><th className="p-3">Template & effective permissions</th><th className="p-3">Actions</th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id} className="border-t border-border">
            <td className="p-3 font-mono text-xs">{user.id}</td>
             <td className="p-3">{user.roles.length ? user.roles.join(", ") : "member"} {user.isSuperAdmin && <span className="ml-2 rounded bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Protected Super Admin</span>}</td>
             <td className="p-3 text-xs"><div>{user.template ? `Template: ${user.template.name}` : "Template: none"}</div><div className="text-muted-foreground">Effective: {user.permissions.join(", ") || "none"}</div>{user.overrides.length > 0 && <div className="text-muted-foreground">Overrides: {user.overrides.map((override) => `${override.effect} ${override.permission}`).join(", ")}</div>}{isSuperAdmin && !user.isSuperAdmin && <div className="mt-2 flex flex-wrap gap-1"><select aria-label={`Override permission for ${user.id}`} className="rounded border bg-background p-1" id={`override-permission-${user.id}`}><option value="content.view">content.view</option><option value="content.manage">content.manage</option><option value="schedule.view">schedule.view</option><option value="schedule.manage">schedule.manage</option><option value="beta.view">beta.view</option><option value="beta.manage">beta.manage</option><option value="access.view">access.view</option><option value="access.manage">access.manage</option></select><Button size="sm" variant="outline" disabled={busy === `${user.id}:override`} onClick={() => { const permission = (document.getElementById(`override-permission-${user.id}`) as HTMLSelectElement)?.value; if (permission) void setOverride(user.id, permission, "allow"); }}>Allow</Button><Button size="sm" variant="outline" disabled={busy === `${user.id}:override`} onClick={() => { const permission = (document.getElementById(`override-permission-${user.id}`) as HTMLSelectElement)?.value; if (permission) void setOverride(user.id, permission, "deny"); }}>Deny</Button></div>}{isSuperAdmin && !user.isSuperAdmin && templates.length > 0 && <select aria-label={`Template for ${user.id}`} className="mt-2 rounded border bg-background p-1" value={user.template?.id ?? ""} onChange={(event) => event.target.value && void assignTemplate(user.id, event.target.value)} disabled={busy === `${user.id}:template`}><option value="">Choose template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}</td>
             <td className="p-3"><div className="flex flex-wrap gap-2">
              {(["reviewer", "admin"] as const).map((role) => {
                const assigned = user.roles.includes(role);
                 return <Button key={role} size="sm" variant={assigned ? "outline" : "default"} disabled={!isSuperAdmin || user.isSuperAdmin || busy === `${user.id}:${role}`} onClick={() => void changeRole(user, role, assigned ? "revoke" : "grant")}>
                  {assigned ? `Revoke ${role}` : `Grant ${role}`}
                </Button>;
              })}
             </div>{user.isSuperAdmin && <p className="mt-2 text-xs text-muted-foreground">Protected status, role, template, and permissions cannot be changed.</p>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}