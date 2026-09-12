import { useState, useRef, FormEvent, useEffect } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthMe,
  getGetAuthMeQueryKey,
  useGetQuizConfig,
  useListAdminQuestions,
  useCreateAdminQuestion,
  useUpdateAdminQuestion,
  useReviewQuestion,
  useCreateGenerationRun,
  useImportAdminQuestionsCsv,
  exportAdminQuestionsCsv,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const visibleQuestionIds = questions.map((question) => question.id).join(",");

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => questions.some((question) => question.id === id))));
  }, [statusFilter, visibleQuestionIds]);

  const exportQuestions = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const selected = [...selectedIds];
      const csv = await exportAdminQuestionsCsv(
        selected.length
          ? { question_id: selected }
          : { status: statusFilter },
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = selected.length ? "alkabir-selected-question-export.csv" : `alkabir-${statusFilter}-question-export.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setExportError("The question export could not be downloaded. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const allVisibleSelected = questions.length > 0 && questions.every((question) => selectedIds.has(question.id));
  const toggleAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) questions.forEach((question) => next.delete(question.id));
      else questions.forEach((question) => next.add(question.id));
      return next;
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <Button type="button" variant="outline" size="sm" disabled={questions.length === 0 || isExporting} onClick={exportQuestions}>
          {isExporting
            ? "Preparing CSV..."
            : selectedIds.size > 0
              ? `Export selected (${selectedIds.size})`
              : `Export all ${statusFilter}`}
        </Button>
      </div>

      {exportError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {exportError}
        </div>
      )}
      
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground">Loading questions...</div>
      ) : questions.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground bg-muted/30 rounded-xl border border-border border-dashed">
          No questions found in this status.
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
            Select all questions in this view
          </label>
          <div className="grid gap-4">
          {questions.map(q => (
            <QuestionCard 
              key={q.id} 
              question={q} 
              onEdit={() => setEditingQuestion(q)}
              canManage={canManage}
              isSelected={selectedIds.has(q.id)}
              onSelectionChange={(selected) => setSelectedIds((current) => {
                const next = new Set(current);
                if (selected) next.add(q.id);
                else next.delete(q.id);
                return next;
              })}
            />
          ))}
          </div>
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

function QuestionCard({ question, isReviewMode = false, onEdit, canManage = true, isSelected, onSelectionChange }: { question: AdminQuestion, isReviewMode?: boolean, onEdit?: () => void, canManage?: boolean, isSelected?: boolean, onSelectionChange?: (selected: boolean) => void }) {
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
            {onSelectionChange && (
              <input
                type="checkbox"
                aria-label={`Select question: ${question.prompt}`}
                checked={isSelected ?? false}
                onChange={(event) => onSelectionChange(event.target.checked)}
              />
            )}
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
      <CsvImportCard />
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

const CSV_TEMPLATE_HEADER = [
  "question_id",
  "expected_version",
  "prompt",
  "explanation",
  "type",
  "points",
  "choice_1",
  "choice_1_correct",
  "choice_2",
  "choice_2_correct",
  "choice_3",
  "choice_3_correct",
  "choice_4",
  "choice_4_correct",
  "source_title",
  "source_url",
  "category_id",
  "difficulty_id",
  "audience_ids",
].join(",");
const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

type CsvRowError = { row: number; column: string; message: string };

function CsvImportCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const importMutation = useImportAdminQuestionsCsv();
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<CsvRowError[]>([]);
  const readGeneration = useRef(0);

  const chooseFile = (selected: File | undefined) => {
    if (!selected) return;
    const generation = ++readGeneration.current;
    setFeedback(null);
    setRowErrors([]);
    const rejectFile = (message: string) => {
      setFile(null);
      setCsvText("");
      setIsReading(false);
      if (inputRef.current) inputRef.current.value = "";
      setFeedback({ type: "error", text: message });
    };
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      rejectFile("Choose a file with a .csv extension.");
      return;
    }
    const mimeType = selected.type.trim().toLowerCase();
    if (mimeType && !["text/csv", "application/csv", "application/vnd.ms-excel"].includes(mimeType)) {
      rejectFile("Choose a CSV file with a supported MIME type.");
      return;
    }
    if (selected.size > CSV_IMPORT_MAX_BYTES) {
      rejectFile("CSV files must be 2 MiB or smaller.");
      return;
    }
    setFile(selected);
    setCsvText("");
    setIsReading(true);
    selected.text().then((text) => {
      if (generation !== readGeneration.current) return;
      setCsvText(text);
    }).catch(() => {
      if (generation !== readGeneration.current) return;
      setFile(null);
      setCsvText("");
      setFeedback({ type: "error", text: "The selected file could not be read." });
    }).finally(() => {
      if (generation === readGeneration.current) setIsReading(false);
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([`${CSV_TEMPLATE_HEADER}\n`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "alkabir-question-import-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const upload = () => {
    if (!file || isReading || !csvText) return;
    setFeedback(null);
    setRowErrors([]);
    importMutation.mutate(
      { data: { filename: file.name, csv: csvText } },
      {
        onSuccess: (result) => {
          setFeedback({
            type: "success",
            text: `${result.importedCount} draft question${result.importedCount === 1 ? "" : "s"} imported successfully (${result.createdCount} created, ${result.updatedCount} updated).`,
          });
          setFile(null);
          setCsvText("");
          if (inputRef.current) inputRef.current.value = "";
          queryClient.invalidateQueries({ queryKey: getListAdminQuestionsQueryKey() });
        },
        onError: (error: any) => {
          const errors = (error?.data?.rowErrors ?? error?.response?.data?.rowErrors) as CsvRowError[] | undefined;
          setRowErrors(Array.isArray(errors) ? errors : []);
          setFeedback({
            type: "error",
            text: error?.data?.error ?? error?.response?.data?.error ?? "CSV import failed. No questions were changed.",
          });
        },
      },
    );
  };

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/[0.03] p-5 shadow-sm space-y-4" aria-labelledby="csv-import-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="csv-import-heading" className="font-serif text-xl font-medium text-primary">Import questions from CSV</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create new drafts or update existing questions. Validation is all-or-nothing: if one row fails, nothing is written.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>Download template</Button>
      </div>

      <div
        className="rounded-lg border border-dashed border-primary/30 bg-background/70 p-5 text-center transition-colors hover:border-primary"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          chooseFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <p className="text-sm font-medium">Drop a CSV file here, or choose one from your device.</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
          Choose CSV file
        </Button>
        {file && (
          <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
            <span className="font-medium text-foreground">{file.name}</span> · {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        UTF-8 CSV (BOM supported), up to 2 MiB and 50 data rows. Leave <code className="rounded bg-muted px-1">question_id</code> and <code className="rounded bg-muted px-1">expected_version</code> blank to create; provide both to update. Updates create a new draft version. Use <code className="rounded bg-muted px-1">true</code> or <code className="rounded bg-muted px-1">false</code> flags, 2–4 choices, and semicolon-delimited audience UUIDs.
      </p>

      {feedback && (
        <div className={classNames("rounded-md p-3 text-sm", feedback.type === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")} role={feedback.type === "error" ? "alert" : "status"}>
          {feedback.text}
        </div>
      )}

      {rowErrors.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-destructive/20">
          <table className="w-full text-left text-sm" aria-label="CSV import row errors">
            <caption className="sr-only">CSV import validation errors</caption>
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">Column</th><th scope="col" className="px-3 py-2">Problem</th></tr>
            </thead>
            <tbody>
              {rowErrors.map((error, index) => (
                <tr key={`${error.row}-${error.column}-${index}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{error.row || "—"}</td>
                  <td className="px-3 py-2 font-mono">{error.column}</td>
                  <td className="px-3 py-2">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button type="button" onClick={upload} disabled={!file || isReading || importMutation.isPending} className="w-full sm:w-auto">
        {isReading ? "Reading file..." : importMutation.isPending ? "Importing..." : "Import question changes"}
      </Button>
    </section>
  );
}

function ManualDraftForm({ existingQuestion, onClose }: { existingQuestion?: AdminQuestion, onClose?: () => void }) {
  const createMutation = useCreateAdminQuestion();
  const updateMutation = useUpdateAdminQuestion();
  const { data: quizConfig, isLoading: isLoadingQuizConfig, isError: isQuizConfigError } = useGetQuizConfig();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState(existingQuestion?.prompt ?? "");
  const [explanation, setExplanation] = useState(existingQuestion?.explanation ?? "");
  const [points, setPoints] = useState<number | "">(existingQuestion?.points ?? 10);
  const [categoryId, setCategoryId] = useState(existingQuestion?.categoryId ?? "");
  const [difficultyId, setDifficultyId] = useState(existingQuestion?.difficultyId ?? "");
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
      categoryId: categoryId || undefined,
      difficultyId: difficultyId || undefined,
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
          setCategoryId("");
          setDifficultyId("");
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            data-testid="select-question-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={isLoadingQuizConfig || isQuizConfigError}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">No category</option>
            {quizConfig?.categories.map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="difficulty">Difficulty</Label>
          <select
            id="difficulty"
            data-testid="select-question-difficulty"
            value={difficultyId}
            onChange={(event) => setDifficultyId(event.target.value)}
            disabled={isLoadingQuizConfig || isQuizConfigError}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">No difficulty</option>
            {quizConfig?.difficulties.map((difficulty) => (
              <option key={difficulty.id} value={difficulty.id}>{difficulty.label}</option>
            ))}
          </select>
        </div>
      </div>
      {isQuizConfigError && (
        <p className="text-sm text-destructive" role="alert">
          Categories and difficulties could not be loaded. You can save the question without them and try again later.
        </p>
      )}

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
