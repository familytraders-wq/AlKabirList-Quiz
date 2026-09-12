import { useState, FormEvent, useEffect } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthMe,
  getGetAuthMeQueryKey,
  useListAdminQuizzes,
  useCreateAdminQuiz,
  useUpdateAdminQuiz,
  usePreviewAdminQuiz,
  useListAdminQuestions,
  AdminQuiz,
  QuizScheduleRequest,
  AdminQuestion,
  getListAdminQuizzesQueryKey,
  getPreviewAdminQuizQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function AdminSchedule() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: authMe, isLoading: isLoadingAuth } = useGetAuthMe({
    query: { enabled: isLoaded && isSignedIn, queryKey: getGetAuthMeQueryKey() }
  });
  const permissions = authMe?.user?.permissions ?? [];
  const canView = authMe?.user?.isSuperAdmin === true || permissions.includes("schedule.view");
  const canManage = authMe?.user?.isSuperAdmin === true || permissions.includes("schedule.manage");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [previewQuizId, setPreviewQuizId] = useState<string | null>(null);

  const { data: quizzesData, isLoading: isLoadingQuizzes } = useListAdminQuizzes({
      query: { enabled: isLoaded && isSignedIn && canView, queryKey: getListAdminQuizzesQueryKey() }
  });
  const quizzes = quizzesData?.items ?? [];

  if (!isLoaded || (isSignedIn && isLoadingAuth)) {
    return <main className="mx-auto max-w-5xl p-8">Loading workspace...</main>;
  }

  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!canView) return <Redirect to="/member" />;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-primary">Schedule Quizzes</h1>
          <p className="mt-2 text-muted-foreground">Manage daily challenges and preview participant experience.</p>
        </div>
        {canManage && <Button onClick={() => setIsCreateOpen(true)} className="shrink-0">Create Quiz</Button>}
      </div>

      {isLoadingQuizzes ? (
        <div className="py-8 text-center text-muted-foreground">Loading schedule...</div>
      ) : quizzes.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground bg-muted/30 rounded-xl border border-border border-dashed">
          No scheduled quizzes found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Title</th>
                <th className="p-4 font-medium">Questions</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quizzes.map((quiz) => (
                <tr key={quiz.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4 font-mono">{quiz.scheduledDate}</td>
                  <td className="p-4 font-medium text-foreground">{quiz.title}</td>
                  <td className="p-4 text-muted-foreground">{quiz.questionCount}</td>
                  <td className="p-4">
                    <span className={classNames(
                      "text-xs px-2 py-1 rounded-full font-medium border",
                      quiz.isActive ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"
                    )}>
                      {quiz.isActive ? "Active" : "Draft"}
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => setPreviewQuizId(quiz.id)}>Preview</Button>
                    {canManage && <Button variant="outline" size="sm" onClick={() => setEditingQuizId(quiz.id)}>Edit</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      {canManage && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule New Quiz</DialogTitle>
          </DialogHeader>
          <QuizForm onClose={() => setIsCreateOpen(false)} />
        </DialogContent>
      </Dialog>}

      {canManage && <Dialog open={editingQuizId !== null} onOpenChange={(open) => !open && setEditingQuizId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Scheduled Quiz</DialogTitle>
          </DialogHeader>
          {editingQuizId && <QuizForm quizId={editingQuizId} onClose={() => setEditingQuizId(null)} />}
        </DialogContent>
      </Dialog>}

      <Dialog open={previewQuizId !== null} onOpenChange={(open) => !open && setPreviewQuizId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quiz Preview</DialogTitle>
          </DialogHeader>
          {previewQuizId && <QuizPreview quizId={previewQuizId} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function QuizForm({ quizId, onClose }: { quizId?: string, onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<{versionId: string, points: number | ""}[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch approved questions to pick from
  const { data: questionsData, isLoading: isLoadingQuestions } = useListAdminQuestions({ status: "approved", limit: 100 });
  const approvedQuestions = questionsData?.items ?? [];

  // Fetch existing quiz if editing
  const { data: quizzesData } = useListAdminQuizzes({ 
    query: { enabled: !!quizId, queryKey: getListAdminQuizzesQueryKey() } 
  });
  const existingQuiz = quizzesData?.items.find(q => q.id === quizId);

  useEffect(() => {
    if (existingQuiz) {
      setTitle(existingQuiz.title);
      setScheduledDate(existingQuiz.scheduledDate);
      setIsActive(existingQuiz.isActive);
      setSelectedQuestions(existingQuiz.questions);
    }
  }, [existingQuiz]);

  const createMutation = useCreateAdminQuiz();
  const updateMutation = useUpdateAdminQuiz();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const toggleQuestion = (question: AdminQuestion) => {
    const isSelected = selectedQuestions.some(sq => sq.versionId === question.versionId);
    if (isSelected) {
      setSelectedQuestions(selectedQuestions.filter(sq => sq.versionId !== question.versionId));
    } else {
      setSelectedQuestions([...selectedQuestions, { versionId: question.versionId, points: question.points }]);
    }
  };

  const moveQuestion = (versionId: string, direction: "up" | "down") => {
    const index = selectedQuestions.findIndex(sq => sq.versionId === versionId);
    if (index === -1) return;
    if (direction === "up" && index > 0) {
      const newArr = [...selectedQuestions];
      [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
      setSelectedQuestions(newArr);
    } else if (direction === "down" && index < selectedQuestions.length - 1) {
      const newArr = [...selectedQuestions];
      [newArr[index], newArr[index + 1]] = [newArr[index + 1], newArr[index]];
      setSelectedQuestions(newArr);
    }
  };

  const handlePointChange = (versionId: string, points: number | "") => {
    setSelectedQuestions(selectedQuestions.map(sq => sq.versionId === versionId ? { ...sq, points } : sq));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // simple YYYY-MM-DD validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      setErrorMsg("Date must be in YYYY-MM-DD format.");
      return;
    }

    if (selectedQuestions.length === 0) {
      setErrorMsg("Please select at least one question.");
      return;
    }
    
    if (selectedQuestions.some(sq => typeof sq.points !== "number" || isNaN(sq.points) || sq.points < 1)) {
      setErrorMsg("All selected questions must have a valid positive integer for points.");
      return;
    }

    const payload: QuizScheduleRequest = {
      title,
      scheduledDate,
      timezone: "UTC",
      isActive,
      questions: selectedQuestions as {versionId: string, points: number}[],
    };

    if (quizId) {
      updateMutation.mutate({ quizId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminQuizzesQueryKey() });
          onClose();
        },
        onError: (err: any) => setErrorMsg(err.message || "Failed to update quiz.")
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminQuizzesQueryKey() });
          onClose();
        },
        onError: (err: any) => setErrorMsg(err.message || "Failed to create quiz.")
      });
    }
  };

  const sortedQuestions = [...approvedQuestions].sort((a, b) => {
    const idxA = selectedQuestions.findIndex(sq => sq.versionId === a.versionId);
    const idxB = selectedQuestions.findIndex(sq => sq.versionId === b.versionId);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pt-4">
      {errorMsg && (
        <div className="p-3 rounded-md text-sm bg-destructive/10 text-destructive border border-destructive/20">
          {errorMsg}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="title">Quiz Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Daily Challenge: Prophets" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduledDate">Scheduled Date (YYYY-MM-DD)</Label>
          <Input id="scheduledDate" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required placeholder="2025-10-15" pattern="\d{4}-\d{2}-\d{2}" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input 
          id="isActive" 
          type="checkbox" 
          checked={isActive} 
          onChange={(e) => setIsActive(e.target.checked)} 
          className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
        />
        <Label htmlFor="isActive" className="cursor-pointer">Active (visible to participants on date)</Label>
      </div>

      <div className="space-y-3">
        <Label>Select Questions ({selectedQuestions.length} selected)</Label>
        <div className="border border-border rounded-xl p-4 bg-muted/20 max-h-96 overflow-y-auto space-y-3">
          {isLoadingQuestions ? (
             <div className="text-sm text-muted-foreground text-center py-4">Loading questions...</div>
          ) : sortedQuestions.length === 0 ? (
             <div className="text-sm text-muted-foreground text-center py-4">No approved questions available.</div>
          ) : (
            sortedQuestions.map((q) => {
              const selectedIndex = selectedQuestions.findIndex(sq => sq.versionId === q.versionId);
              const selected = selectedIndex !== -1 ? selectedQuestions[selectedIndex] : undefined;
              return (
                <div key={q.id} className={classNames(
                  "p-3 border rounded-lg flex items-start gap-3 transition-colors",
                  selected ? "border-primary bg-primary/5" : "border-border bg-card"
                )}>
                  <input 
                    type="checkbox" 
                    checked={!!selected} 
                    onChange={() => toggleQuestion(q)}
                    className="mt-1 w-4 h-4 rounded text-primary focus:ring-primary border-input"
                  />
                  {selected && (
                    <div className="flex flex-col items-center gap-1 border-r border-border pr-3 mr-1">
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6" 
                        onClick={() => moveQuestion(q.versionId, "up")}
                        disabled={selectedIndex === 0}
                        aria-label="Move question up"
                      >
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 3L11.5 8H3.5L7.5 3Z" fill="currentColor" /></svg>
                      </Button>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6" 
                        onClick={() => moveQuestion(q.versionId, "down")}
                        disabled={selectedIndex === selectedQuestions.length - 1}
                        aria-label="Move question down"
                      >
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 12L3.5 7H11.5L7.5 12Z" fill="currentColor" /></svg>
                      </Button>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium leading-snug">
                      {selected && <span className="mr-2 text-primary font-bold">#{selectedIndex + 1}</span>}
                      {q.prompt}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {q.choices.map(c => c.label).join(", ")}
                    </p>
                  </div>
                  {selected && (
                    <div className="w-24 shrink-0 flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Pts</Label>
                      <Input 
                        type="number" 
                        min="1" 
                        className="h-8 text-xs" 
                        value={selected.points === "" ? "" : selected.points} 
                        onChange={(e) => handlePointChange(q.versionId, e.target.value === "" ? "" : Number(e.target.value))} 
                        aria-label={`Points for ${q.prompt}`}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>Cancel</Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Quiz"}
        </Button>
      </div>
    </form>
  );
}

function QuizPreview({ quizId }: { quizId: string }) {
  const { data: preview, isLoading, error } = usePreviewAdminQuiz(quizId, {
    query: { queryKey: getPreviewAdminQuizQueryKey(quizId) }
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading preview...</div>;
  if (error) return <div className="py-12 text-center text-destructive">Failed to load preview.</div>;
  if (!preview) return null;

  return (
    <div className="space-y-8 pt-4">
      <div className="text-center space-y-2">
        <h2 className="font-serif text-2xl font-medium text-primary">{preview.title}</h2>
        <p className="text-sm text-muted-foreground">
          {preview.questions.length} questions • Scheduled for {preview.scheduledDate}
        </p>
      </div>

      <div className="space-y-6">
        {preview.questions.map((q, i) => (
          <div key={q.id} className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-start gap-4">
              <h3 className="font-medium leading-relaxed">
                <span className="text-muted-foreground mr-2">{i + 1}.</span>
                {q.prompt}
              </h3>
              <span className="shrink-0 text-xs font-medium px-2 py-1 bg-secondary text-secondary-foreground rounded-full">
                {q.points} pts
              </span>
            </div>
            
            <div className="space-y-2 pl-6">
              {q.choices.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 text-sm">
                  <div className="w-4 h-4 rounded-full border border-primary/30 flex-shrink-0" />
                  <span className="text-foreground/90">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
