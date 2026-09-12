import { useState, useRef, FormEvent } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthMe,
  getGetAuthMeQueryKey,
  useListAdminQuestions,
  useCreateAdminQuestion,
  useUpdateAdminQuestion,
  useReviewQuestion,
  useCreateGenerationRun,
  QuestionStatus,
  AdminQuestion,
  QuestionChoiceInput,
  QuestionWriteRequest,
  ReviewRequestDecision,
  getListAdminQuestionsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function AdminContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading: isLoadingAuth } = useGetAuthMe({
    query: { enabled: isLoaded && isSignedIn, queryKey: getGetAuthMeQueryKey() }
  });

  const [activeTab, setActiveTab] = useState<"bank" | "queue" | "intake">("bank");
  const [bankStatusFilter, setBankStatusFilter] = useState<QuestionStatus>("approved");

  if (!isLoaded || (isSignedIn && isLoadingAuth)) {
    return <main className="mx-auto max-w-5xl p-8">Loading workspace...</main>;
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;
  const permissions = authMe?.user?.permissions ?? [];
  const canView = authMe?.user?.isSuperAdmin === true || permissions.includes("content.view");
  const canManage = authMe?.user?.isSuperAdmin === true || permissions.includes("content.manage");
  if (!canView) return <Redirect to="/member" />;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-primary">Content Workspace</h1>
        <p className="mt-2 text-muted-foreground">Manage the question bank, review pending drafts, and intake new generated content.</p>
      </div>

      <div className="flex border-b border-border mb-6">
        <button
          className={classNames(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2",
            activeTab === "bank" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("bank")}
        >
          Question Bank
        </button>
        <button
          className={classNames(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2",
            activeTab === "queue" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("queue")}
        >
          Review Queue
        </button>
        {canManage && <button
          className={classNames(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2",
            activeTab === "intake" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("intake")}
        >
          Intake & Generation
        </button>}
      </div>

      {activeTab === "bank" && (
        <BankView statusFilter={bankStatusFilter} onFilterChange={setBankStatusFilter} canManage={canManage} />
      )}
      {activeTab === "queue" && <QueueView canManage={canManage} />}
      {activeTab === "intake" && canManage && <IntakeView />}
    </main>
  );
}

function BankView({ statusFilter, onFilterChange, canManage }: { statusFilter: QuestionStatus, onFilterChange: (s: QuestionStatus) => void, canManage: boolean }) {
  const { data: questionsData, isLoading } = useListAdminQuestions({ status: statusFilter, limit: 100 });
  const questions = questionsData?.items ?? [];
  const [editingQuestion, setEditingQuestion] = useState<AdminQuestion | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-4">
        <Label className="text-sm font-medium">Status Filter:</Label>
        <select
          className="rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={statusFilter}
          onChange={(e) => onFilterChange(e.target.value as QuestionStatus)}
        >
          <option value="approved">Approved</option>
          <option value="draft">Drafts</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground">Loading questions...</div>
      ) : questions.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground bg-muted/30 rounded-xl border border-border border-dashed">
          No questions found in this status.
        </div>
      ) : (
        <div className="grid gap-4">
          {questions.map(q => (
            <QuestionCard 
              key={q.id} 
              question={q} 
              onEdit={() => setEditingQuestion(q)}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <Dialog open={editingQuestion !== null} onOpenChange={(open) => !open && setEditingQuestion(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Draft Question</DialogTitle>
          </DialogHeader>
          {editingQuestion && canManage && <ManualDraftForm key={editingQuestion.id} existingQuestion={editingQuestion} onClose={() => setEditingQuestion(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QueueView({ canManage }: { canManage: boolean }) {
  const { data: questionsData, isLoading } = useListAdminQuestions({ status: "pending_review", limit: 50 });
  const questions = questionsData?.items ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground">Loading review queue...</div>
      ) : questions.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground bg-muted/30 rounded-xl border border-border border-dashed">
          The review queue is empty. Great job!
        </div>
      ) : (
        <div className="grid gap-4">
          {questions.map(q => (
            <QuestionCard key={q.id} question={q} isReviewMode canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ question, isReviewMode = false, onEdit, canManage = true }: { question: AdminQuestion, isReviewMode?: boolean, onEdit?: () => void, canManage?: boolean }) {
  const queryClient = useQueryClient();
  const reviewMutation = useReviewQuestion();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleReview = (decision: ReviewRequestDecision) => {
    setErrorMsg(null);
    reviewMutation.mutate(
      { questionId: question.id, data: { decision, expectedStatus: question.status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminQuestionsQueryKey() });
        },
        onError: (err: any) => {
          if (err.code === "STALE_REVIEW" || err.response?.status === 409) {
            setErrorMsg("This question was updated by someone else. Please refresh to see the latest changes.");
          } else {
            setErrorMsg(err.message || "Failed to submit review");
          }
        }
      }
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground">ID: {question.id}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
              v{question.version}
            </span>
            <span className={classNames(
              "text-xs px-2 py-0.5 rounded-full font-medium border",
              question.status === "approved" ? "bg-primary/10 text-primary border-primary/20" :
              question.status === "pending_review" ? "bg-accent/10 text-accent-foreground border-accent/20" :
              "bg-muted text-muted-foreground border-muted-foreground/20"
            )}>
              {question.status}
            </span>
          </div>
          <p className="font-serif text-lg font-medium text-foreground">{question.prompt}</p>
        </div>
        {!isReviewMode && canManage && onEdit && (question.status === "draft" || question.status === "rejected") && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
            <Button 
              size="sm" 
              onClick={() => handleReview("submit")} 
              disabled={reviewMutation.isPending}
            >
              Submit for Review
            </Button>
          </div>
        )}
      </div>
      
      <div className="space-y-2 pl-4 border-l-2 border-border/50">
        {question.choices.map((c, i) => (
          <div key={i} className={classNames("text-sm", c.isCorrect ? "font-semibold text-primary flex items-center gap-2" : "text-muted-foreground")}>
            {c.label} 
            {c.isCorrect && (
              <span className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded-sm">
                Correct
              </span>
            )}
          </div>
        ))}
      </div>

      {question.explanation && (
        <div className="bg-muted/30 p-3 rounded-lg text-sm text-foreground/80">
          <span className="font-semibold mr-2">Explanation:</span>
          {question.explanation}
        </div>
      )}

      {question.sourceMetadata && question.sourceMetadata.length > 0 && (
        <div className="bg-muted/10 p-3 rounded-lg text-sm space-y-1">
          <span className="font-semibold block text-muted-foreground">Sources:</span>
          <ul className="list-disc pl-5 space-y-1 text-foreground/80">
            {question.sourceMetadata.map((s, i) => (
              <li key={i}>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.title}</a> : s.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMsg && (
        <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">
          {errorMsg}
        </div>
      )}

      {isReviewMode && canManage && (
        <div className="pt-4 border-t border-border flex gap-3">
          <Button 
            size="sm" 
            onClick={() => handleReview("approve")} 
            disabled={reviewMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Approve
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => handleReview("reject")} 
            disabled={reviewMutation.isPending}
          >
            Reject
          </Button>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={() => handleReview("archive")} 
            disabled={reviewMutation.isPending}
            className="text-muted-foreground"
          >
            Archive
          </Button>
        </div>
      )}
    </div>
  );
}

function IntakeView() {
  const [activeTab, setActiveTab] = useState<"manual" | "run">("manual");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex gap-4 mb-4">
        <Button 
          variant={activeTab === "manual" ? "default" : "outline"} 
          onClick={() => setActiveTab("manual")}
          size="sm"
        >
          Manual Draft
        </Button>
        <Button 
          variant={activeTab === "run" ? "default" : "outline"} 
          onClick={() => setActiveTab("run")}
          size="sm"
        >
          Generation Run
        </Button>
      </div>

      {activeTab === "manual" && <ManualDraftForm />}
      {activeTab === "run" && <GenerationRunForm />}
    </div>
  );
}

function ManualDraftForm({ existingQuestion, onClose }: { existingQuestion?: AdminQuestion, onClose?: () => void }) {
  const createMutation = useCreateAdminQuestion();
  const updateMutation = useUpdateAdminQuestion();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState(existingQuestion?.prompt ?? "");
  const [explanation, setExplanation] = useState(existingQuestion?.explanation ?? "");
  const [points, setPoints] = useState<number | "">(existingQuestion?.points ?? 10);
  const [sources, setSources] = useState<{title: string, url: string}[]>(
    existingQuestion?.sourceMetadata?.length ? existingQuestion.sourceMetadata.map(s => ({ title: s.title, url: s.url ?? "" })) : []
  );
  const [choices, setChoices] = useState<{label: string, isCorrect: boolean}[]>(
    existingQuestion?.choices ?? [
      { label: "", isCorrect: true },
      { label: "", isCorrect: false },
      { label: "", isCorrect: false },
      { label: "", isCorrect: false },
    ]
  );
  const [msg, setMsg] = useState<{type: "error" | "success", text: string} | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);

    const formattedChoices: QuestionChoiceInput[] = choices
      .filter(c => c.label.trim() !== "")
      .map((c, i) => ({
        label: c.label.trim(),
        position: i,
        isCorrect: c.isCorrect
      }));

    if (formattedChoices.length < 2) {
      setMsg({ type: "error", text: "At least 2 choices are required." });
      return;
    }
    if (!formattedChoices.some(c => c.isCorrect)) {
      setMsg({ type: "error", text: "At least one correct choice is required." });
      return;
    }

    if (typeof points !== "number" || points < 1) {
      setMsg({ type: "error", text: "Points must be a valid positive integer." });
      return;
    }

    const payload: QuestionWriteRequest = {
      prompt: prompt.trim(),
      explanation: explanation.trim(),
      choices: formattedChoices,
      sourceMetadata: sources.filter(s => s.title.trim() !== "").map(s => ({ title: s.title.trim(), url: s.url.trim() || undefined })),
      points: points,
    };

    if (existingQuestion) {
      updateMutation.mutate({ questionId: existingQuestion.id, data: payload }, {
        onSuccess: () => {
          setMsg({ type: "success", text: "Draft updated successfully." });
          queryClient.invalidateQueries({ queryKey: getListAdminQuestionsQueryKey() });
          onClose?.();
        },
        onError: (err: any) => {
          setMsg({ type: "error", text: err.message || "Failed to update draft." });
        }
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          setMsg({ type: "success", text: "Draft question created successfully." });
          setPrompt("");
          setExplanation("");
          setPoints(10);
          setSources([]);
          setChoices([
            { label: "", isCorrect: true },
            { label: "", isCorrect: false },
            { label: "", isCorrect: false },
            { label: "", isCorrect: false },
          ]);
          queryClient.invalidateQueries({ queryKey: getListAdminQuestionsQueryKey() });
          onClose?.();
        },
        onError: (err: any) => {
          setMsg({ type: "error", text: err.message || "Failed to create draft." });
        }
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-card p-6 rounded-xl border border-border shadow-sm">
      {!existingQuestion && <h2 className="text-lg font-serif font-medium">Create Manual Draft</h2>}
      {msg && (
        <div className={classNames("p-3 rounded-md text-sm", msg.type === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {msg.text}
        </div>
      )}
      
      <div className="space-y-2">
        <Label htmlFor="prompt">Prompt (Question Text)</Label>
        <Textarea 
          id="prompt" 
          required 
          rows={3} 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)} 
          placeholder="e.g., Which prophet built the Ark?"
        />
      </div>

      <div className="space-y-3">
        <Label>Choices</Label>
        {choices.map((c, i) => (
          <div key={i} className="flex items-center gap-3">
            <Input 
              value={c.label} 
              onChange={(e) => {
                const newC = [...choices];
                newC[i].label = e.target.value;
                setChoices(newC);
              }}
              placeholder={`Choice ${i + 1}`}
            />
            <label className="flex items-center gap-2 text-sm whitespace-nowrap cursor-pointer">
              <input 
                type="radio" 
                name="correctChoice" 
                checked={c.isCorrect}
                onChange={() => {
                  const newC = choices.map((choice, idx) => ({ ...choice, isCorrect: idx === i }));
                  setChoices(newC);
                }}
                className="w-4 h-4 text-primary focus:ring-primary border-input"
              />
              Correct
            </label>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="explanation">Explanation</Label>
        <Textarea 
          id="explanation" 
          rows={3} 
          value={explanation} 
          onChange={(e) => setExplanation(e.target.value)} 
          placeholder="Explain why the answer is correct."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="points">Points</Label>
        <Input 
          id="points" 
          type="number" 
          min="1" 
          value={points === "" ? "" : points} 
          onChange={(e) => setPoints(e.target.value === "" ? "" : Number(e.target.value))} 
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Sources</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setSources([...sources, { title: "", url: "" }])}>
            Add Source
          </Button>
        </div>
        {sources.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input 
              placeholder="Source Title" 
              value={s.title} 
              onChange={(e) => {
                const newS = [...sources];
                newS[i].title = e.target.value;
                setSources(newS);
              }} 
            />
            <Input 
              placeholder="URL (optional)" 
              value={s.url} 
              onChange={(e) => {
                const newS = [...sources];
                newS[i].url = e.target.value;
                setSources(newS);
              }} 
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => setSources(sources.filter((_, idx) => idx !== i))}>
              <span className="text-destructive font-bold">&times;</span>
            </Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>Cancel</Button>
        )}
        <Button type="submit" disabled={isSaving} className={onClose ? "" : "w-full"}>
          {isSaving ? "Saving..." : existingQuestion ? "Update Draft" : "Save Draft"}
        </Button>
      </div>
    </form>
  );
}

function GenerationRunForm() {
  const createRun = useCreateGenerationRun();
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");
  const [jsonInput, setJsonInput] = useState("");
  const [msg, setMsg] = useState<{type: "error" | "success", text: string} | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    let questionsParsed: QuestionWriteRequest[] = [];
    try {
      questionsParsed = JSON.parse(jsonInput);
      if (!Array.isArray(questionsParsed)) {
        throw new Error("Input must be a JSON array of questions.");
      }
    } catch (err: any) {
      setMsg({ type: "error", text: "Invalid JSON: " + err.message });
      return;
    }

    createRun.mutate({
      data: {
        provider,
        model,
        promptVersion: "v1",
        questions: questionsParsed,
      }
    }, {
      onSuccess: () => {
        setMsg({ type: "success", text: `Successfully ingested ${questionsParsed.length} questions into the review queue.` });
        setJsonInput("");
      },
      onError: (err: any) => {
        setMsg({ type: "error", text: err.message || "Failed to intake generation run." });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl bg-card p-6 rounded-xl border border-border shadow-sm">
      <h2 className="text-lg font-serif font-medium">Intake Generation Run</h2>
      <p className="text-sm text-muted-foreground">Paste a JSON array of QuestionWriteRequest objects generated by an AI pipeline.</p>
      
      {msg && (
        <div className={classNames("p-3 rounded-md text-sm", msg.type === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <Input id="provider" value={provider} onChange={(e) => setProvider(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jsonInput">Questions JSON Array</Label>
        <Textarea 
          id="jsonInput" 
          rows={12} 
          value={jsonInput} 
          onChange={(e) => setJsonInput(e.target.value)} 
          required 
          className="font-mono text-xs"
          placeholder={`[\n  {\n    "prompt": "...",\n    "explanation": "...",\n    "choices": [\n      {"label": "...", "position": 0, "isCorrect": true}\n    ],\n    "sourceMetadata": []\n  }\n]`}
        />
      </div>

      <Button type="submit" disabled={createRun.isPending} className="w-full">
        {createRun.isPending ? "Ingesting..." : "Ingest Run"}
      </Button>
    </form>
  );
}
