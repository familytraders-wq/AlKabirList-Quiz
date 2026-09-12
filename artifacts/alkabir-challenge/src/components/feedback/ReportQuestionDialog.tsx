import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMyFeedback } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Flag, Loader2 } from "lucide-react";
import { analytics } from "@/lib/analytics";

interface ReportQuestionDialogProps {
  versionId: string;
}

export function ReportQuestionDialog({ versionId }: ReportQuestionDialogProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  const createFeedback = useCreateMyFeedback({
    mutation: {
      onSuccess: () => {
        analytics.questionReported();
        toast({
          title: "Report submitted",
          description: "Thank you for reporting this question. Our review team will investigate.",
        });
        setOpen(false);
        setMessage("");
      },
      onError: (err: any) => {
        toast({
          title: "Failed to submit report",
          description: err?.message || "There was a problem submitting your report. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = () => {
    if (!message.trim()) return;
    createFeedback.mutate({
      data: {
        kind: "question_accuracy",
        message: message.trim(),
        questionVersionId: versionId,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-report-question"
        >
          <Flag className="h-3.5 w-3.5" />
          <span>Report this question</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report Question</DialogTitle>
          <DialogDescription>
            Help us improve the challenge by reporting accuracy issues, typos, or unclear explanations for this specific question.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Please describe the issue..."
            className="min-h-[120px] resize-none"
            data-testid="textarea-report-message"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={createFeedback.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || createFeedback.isPending}
            data-testid="button-submit-report"
          >
            {createFeedback.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
