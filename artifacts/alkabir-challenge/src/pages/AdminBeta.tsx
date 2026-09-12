import { useState, useMemo } from "react";
import { useAuth } from "@clerk/react";
import { Redirect } from "wouter";
import { format } from "date-fns";
import {
  useGetAuthMe,
  useGetBetaSummary,
  useListBetaFeedback,
  useListBetaAudit,
  useModerateBetaFeedback,
  getListBetaFeedbackQueryKey,
  getGetBetaSummaryQueryKey,
  getGetAuthMeQueryKey,
} from "@workspace/api-client-react";
import type { FeedbackStatus, FeedbackKind, BetaSummarySeries } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { analytics } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, CheckCircle2, Clock, FileText, Activity } from "lucide-react";

export function AdminBeta() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading: isAuthLoading } = useGetAuthMe({
    query: { enabled: isLoaded && isSignedIn, queryKey: getGetAuthMeQueryKey() }
  });

  const roles = authMe?.user?.roles || [];
  const isAdmin = roles.includes("admin");
  const isReviewer = roles.includes("reviewer");
  const canAccess = isAdmin || isReviewer;

  if (!isLoaded || isAuthLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!canAccess) return <Redirect to="/member" />;

  return (
    <div className="min-h-[100dvh] bg-background pb-20">
      <header className="border-b border-border/40 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Beta Operations</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="mb-8 w-full justify-start h-auto p-1 bg-secondary/50 overflow-x-auto rounded-xl">
            <TabsTrigger value="summary" className="rounded-lg px-6 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Activity className="mr-2 h-4 w-4" /> Summary
            </TabsTrigger>
            <TabsTrigger value="feedback" className="rounded-lg px-6 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <FileText className="mr-2 h-4 w-4" /> Feedback
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="audit" className="rounded-lg px-6 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Clock className="mr-2 h-4 w-4" /> Audit Log
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="summary">
            <BetaSummaryTab />
          </TabsContent>
          
          <TabsContent value="feedback">
            <BetaFeedbackTab />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="audit">
              <BetaAuditTab />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

function BetaSummaryTab() {
  const { data, isLoading, error } = useGetBetaSummary();

  if (isLoading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">Could not load summary data.</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Members" value={data.totalMembers} />
        <MetricCard title="Completed Profiles" value={data.completedProfiles} />
        <MetricCard title="Active Members (7d)" value={data.activeMembers7d} />
        <MetricCard title="Quiz Completions (7d)" value={data.quizCompletions7d} />
        <MetricCard title="Open Feedback" value={data.openFeedback} alert={data.openFeedback > 0} />
        <MetricCard title="Pending Qs" value={data.pendingReviewQuestions} />
        <MetricCard title="Approved Qs" value={data.approvedQuestions} />
        <MetricCard title="Days Scheduled" value={data.scheduledActiveDaysAhead} />
      </div>

      <Card className="rounded-2xl border border-border shadow-sm">
        <CardHeader>
          <CardTitle className="font-serif text-xl">7-Day Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(val) => format(new Date(val), "MMM d")} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                />
                <Line type="monotone" name="Completions" dataKey="completions" stroke="hsl(var(--primary))" strokeWidth={2} activeDot={{ r: 6 }} />
                <Line type="monotone" name="Signups" dataKey="signups" stroke="hsl(var(--accent))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, alert = false }: { title: string; value: number; alert?: boolean }) {
  return (
    <Card className={`rounded-xl border shadow-sm ${alert ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-card"}`}>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

export function BetaFeedbackTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("open");
  const [kindFilter, setKindFilter] = useState<FeedbackKind | "all">("all");
  
  const { data, isLoading, error } = useListBetaFeedback({
    status: statusFilter === "all" ? undefined : statusFilter,
    kind: kindFilter === "all" ? undefined : kindFilter,
    limit: 50
  });

  const moderateFeedback = useModerateBetaFeedback({
    mutation: {
      onSuccess: (_, variables) => {
        analytics.feedbackModerated(variables.data.status);
        queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBetaSummaryQueryKey() });
        toast({ title: "Feedback updated" });
      },
      onError: (err: any) => {
        const isConflict = err.status === 409 || err.code === 409;
        toast({
          title: isConflict ? "Status conflict" : "Update failed",
          description: isConflict 
            ? "This feedback was updated by someone else. Please refresh." 
            : (err?.message || "There was a problem updating this feedback."),
          variant: "destructive",
        });
        if (isConflict) {
          queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
        }
      }
    }
  });

  if (isLoading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>;
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">Could not load feedback.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="w-[200px]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[200px]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</label>
          <Select value={kindFilter} onValueChange={(v: any) => setKindFilter(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="accessibility">Accessibility</SelectItem>
              <SelectItem value="question_accuracy">Question Accuracy</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4">
        {data?.items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No feedback matches these filters.</div>
        ) : (
          data?.items.map(item => (
            <FeedbackModerationCard 
              key={item.id} 
              item={item} 
              isPending={moderateFeedback.isPending}
              onModerate={(status, note) => {
                moderateFeedback.mutate({
                  feedbackId: item.id,
                  data: { status, expectedStatus: item.status, resolutionNote: note }
                });
              }} 
            />
          ))
        )}
      </div>
    </div>
  );
}

function FeedbackModerationCard({ item, isPending, onModerate }: { item: any, isPending: boolean, onModerate: (status: FeedbackStatus, note?: string) => void }) {
  const [note, setNote] = useState(item.resolutionNote || "");
  const [isEditing, setIsEditing] = useState(false);

  return (
    <Card className="rounded-xl border border-border shadow-sm">
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                {item.kind.replace("_", " ")}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                item.status === 'open' ? 'bg-amber-100 text-amber-800' :
                item.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' :
                item.status === 'dismissed' ? 'bg-destructive/10 text-destructive' :
                'bg-blue-100 text-blue-800'
              }`}>
                {item.status.replace("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground">{format(new Date(item.createdAt), "MMM d, yyyy h:mm a")}</span>
            </div>
            {item.questionId && (
              <div className="mt-2 text-xs font-mono text-muted-foreground">
                Question: {item.questionId} {item.questionVersionId ? `(v${item.questionVersionId.slice(0,6)})` : ""}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {item.status === "open" && (
              <Button size="sm" variant="outline" onClick={() => onModerate("in_review")} disabled={isPending}>
                Start Review
              </Button>
            )}
            {item.status !== "resolved" && (
              <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setIsEditing(true)} disabled={isPending || isEditing}>
                Resolve...
              </Button>
            )}
            {item.status !== "dismissed" && (
              <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onModerate("dismissed")} disabled={isPending}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
        
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.message}</p>

        {isEditing && (
          <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 animate-in fade-in">
            <label className="mb-2 block text-sm font-medium">Resolution Note (visible to user)</label>
            <Textarea 
              value={note} 
              onChange={e => setNote(e.target.value)} 
              placeholder="Explain how this was resolved..."
              className="mb-3 bg-white"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { onModerate("resolved", note); setIsEditing(false); }} disabled={isPending || !note.trim()}>
                Save & Resolve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {!isEditing && item.resolutionNote && (
          <div className="mt-4 rounded-lg border border-border/50 bg-secondary/50 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resolution Note</p>
            <p className="text-sm text-foreground">{item.resolutionNote}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BetaAuditTab() {
  const { data, isLoading, error } = useListBetaAudit({ limit: 100 });

  if (isLoading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>;
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">Could not load audit log.</div>;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-4 font-semibold text-muted-foreground">Timestamp</th>
              <th className="p-4 font-semibold text-muted-foreground">Actor ID</th>
              <th className="p-4 font-semibold text-muted-foreground">Action</th>
              <th className="p-4 font-semibold text-muted-foreground">Entity</th>
              <th className="p-4 font-semibold text-muted-foreground">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data?.items.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No audit records found.</td></tr>
            ) : (
              data?.items.map(event => (
                <tr key={event.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="p-4 whitespace-nowrap text-muted-foreground">
                    {format(new Date(event.createdAt), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="p-4 font-mono text-xs text-foreground/80">{event.actorId}</td>
                  <td className="p-4">
                    <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                      {event.action}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-foreground">{event.entityType}</div>
                    <div className="font-mono text-xs text-muted-foreground mt-0.5">{event.entityId}</div>
                  </td>
                  <td className="p-4">
                    <div className="max-w-[300px] truncate text-xs text-muted-foreground" title={JSON.stringify(event.metadata)}>
                      {Object.entries(event.metadata || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
