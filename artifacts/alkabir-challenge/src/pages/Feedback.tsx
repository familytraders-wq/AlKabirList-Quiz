import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import {
  useListMyFeedback,
  useCreateMyFeedback,
  getListMyFeedbackQueryKey,
} from "@workspace/api-client-react";
import type { FeedbackKind } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { analytics } from "@/lib/analytics";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, MessageSquarePlus, Clock, CheckCircle2, XCircle, FileText } from "lucide-react";

const feedbackSchema = z.object({
  kind: z.enum(["general", "technical", "accessibility"] as const),
  message: z.string().min(10, "Please provide more details (minimum 10 characters)").max(5000),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

const KIND_LABELS: Record<string, string> = {
  general: "General Feedback",
  technical: "Technical Issue",
  accessibility: "Accessibility",
  question_accuracy: "Question Accuracy",
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  open: { label: "Open", icon: <Clock className="w-4 h-4" />, color: "text-muted-foreground", bg: "bg-secondary" },
  in_review: { label: "In Review", icon: <Loader2 className="w-4 h-4" />, color: "text-primary", bg: "bg-primary/10" },
  resolved: { label: "Resolved", icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-700", bg: "bg-emerald-50" },
  dismissed: { label: "Dismissed", icon: <XCircle className="w-4 h-4" />, color: "text-destructive", bg: "bg-destructive/10" },
};

export function Feedback() {
  const { isLoaded, isSignedIn } = useAuth();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: feedbackData, isLoading, error } = useListMyFeedback({
    query: {
      enabled: isLoaded && isSignedIn,
      queryKey: getListMyFeedbackQueryKey(),
    }
  });

  const createFeedback = useCreateMyFeedback({
    mutation: {
      onSuccess: (_, variables) => {
        analytics.feedbackSubmitted(variables.data.kind);
        queryClient.invalidateQueries({ queryKey: getListMyFeedbackQueryKey() });
        toast({
          title: "Feedback submitted",
          description: "Thank you for your feedback. Our team will review it shortly.",
        });
        setIsFormOpen(false);
        form.reset();
      },
      onError: (err: any) => {
        toast({
          title: "Submission failed",
          description: err?.message || "There was a problem submitting your feedback.",
          variant: "destructive",
        });
      },
    }
  });

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      kind: "general",
      message: "",
    },
  });

  if (!isLoaded || (isSignedIn && !feedbackData && !error)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background" data-testid="feedback-loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="mb-4 font-serif text-3xl font-semibold text-foreground">Sign in required</h1>
        <p className="mb-8 text-muted-foreground">You must be signed in to submit or view feedback.</p>
        <Link href="/sign-in" className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-20">
      <header className="sticky top-0 z-10 border-b border-border/40 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-4 px-6">
          <Link href="/member" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back-member">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-serif text-xl font-semibold text-foreground">My Feedback</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-serif text-3xl font-semibold text-foreground">Help us improve</h2>
            <p className="mt-2 text-muted-foreground">Share your thoughts, report issues, or track the status of your previous reports.</p>
          </div>
          {!isFormOpen && (
            <Button onClick={() => setIsFormOpen(true)} className="rounded-xl shrink-0" data-testid="button-new-feedback">
              <MessageSquarePlus className="mr-2 h-4 w-4" /> New Feedback
            </Button>
          )}
        </div>

        {isFormOpen && (
          <div className="mb-12 animate-in fade-in slide-in-from-top-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createFeedback.mutate({ data }))} className="space-y-6">
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-feedback-kind">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="general">General Feedback</SelectItem>
                          <SelectItem value="technical">Technical Issue</SelectItem>
                          <SelectItem value="accessibility">Accessibility</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>What kind of feedback is this?</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Please provide as much detail as possible..."
                          className="min-h-[150px] resize-none"
                          data-testid="textarea-feedback-message"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-center justify-end gap-3 pt-4">
                  <Button variant="ghost" type="button" onClick={() => setIsFormOpen(false)} disabled={createFeedback.isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createFeedback.isPending} data-testid="button-submit-feedback">
                    {createFeedback.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Submit Feedback
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        )}

        <div className="space-y-6">
          <h3 className="font-serif text-xl font-semibold text-foreground">History</h3>
          
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
              Could not load your feedback history. Please try refreshing the page.
            </div>
          )}

          {feedbackData?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-lg font-medium text-foreground">No feedback yet</p>
              <p className="mt-1 text-sm text-muted-foreground">When you submit feedback, you can track its status here.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {feedbackData?.items.map((item) => {
                const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
                return (
                  <div key={item.id} className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md" data-testid={`feedback-item-${item.id}`}>
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold uppercase tracking-wider text-primary">
                            {KIND_LABELS[item.kind] || item.kind}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            • {format(new Date(item.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                      </div>
                      <div className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bg} ${config.color}`}>
                        {config.icon} {config.label}
                      </div>
                    </div>
                    
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{item.message}</p>
                    
                    {item.resolutionNote && (
                      <div className="mt-4 rounded-lg border border-border/50 bg-secondary/50 p-4">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response from team</p>
                        <p className="text-sm text-foreground">{item.resolutionNote}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
