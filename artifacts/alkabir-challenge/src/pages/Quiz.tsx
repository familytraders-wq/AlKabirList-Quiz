import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetQuizAttemptQueryKey,
  getGetQuizResultQueryKey,
  useAnswerQuizQuestion,
  useCompleteQuizAttempt,
  useGetQuizAttempt,
  useGetQuizResult,
  useStartQuizAttempt,
  useGetDailyQuiz,
  getGetDailyQuizQueryKey,
  type AnswerResult,
  type AttemptState,
  type QuizResult,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Menu,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  resolveChallengeDateLabel,
  useUtcDayBoundary,
} from "@/hooks/use-utc-day-boundary";
import { analytics } from "@/lib/analytics";
import { ReportQuestionDialog } from "@/components/feedback/ReportQuestionDialog";

const ATTEMPT_STORAGE_KEY = "alkabir.quiz.attemptId";
const QUIZ_ID_QUERY_KEY = "quizId";

type QuizStatus = "answering" | "feedback" | "ready_to_complete";

function readStoredAttemptId(storageKey: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey);
}

function getOrMintIdempotencyKey(quizId: string) {
  const key = `alkabir.quiz.startIdempotency:${quizId}`;
  if (typeof window !== "undefined") {
    let value = window.localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      window.localStorage.setItem(key, value);
    }
    return value;
  }
  return crypto.randomUUID();
}

function getQueryQuizId() {
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).get(QUIZ_ID_QUERY_KEY);
  }
  return null;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function ErrorNotice({
  message,
  onRetry,
  retryLabel = "Try again",
  retrying = false,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
}) {
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-left"
      role="alert"
      data-testid="quiz-api-error"
    >
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">We couldn’t update your challenge</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
              data-testid="button-retry-quiz"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {retrying ? "Retrying…" : retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingNotice({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm"
      data-testid="quiz-loading"
    >
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
      <p className="font-medium text-foreground">{message}</p>
      <p className="mt-2 text-sm text-muted-foreground">Your progress is saved as you go.</p>
    </div>
  );
}

export function Quiz() {
  const [, setLocation] = useLocation();
  const queryQuizId = getQueryQuizId();
  const queryClient = useQueryClient();

  const dailyQuizQuery = useGetDailyQuiz({
    query: {
      enabled: !queryQuizId,
      queryKey: getGetDailyQuizQueryKey(),
      retry: false,
    },
  });

  const quizId = queryQuizId || dailyQuizQuery.data?.quizId;
  const attemptStorageKey = quizId ? `${ATTEMPT_STORAGE_KEY}:${quizId}` : null;
  const [hasCheckedStorageFor, setHasCheckedStorageFor] = useState<string | null>(
    queryQuizId ? queryQuizId : null
  );
  const [attemptId, setAttemptId] = useState<string | null>(() => {
    if (queryQuizId) {
      return readStoredAttemptId(`${ATTEMPT_STORAGE_KEY}:${queryQuizId}`);
    }
    return null;
  });

  const [attemptState, setAttemptState] = useState<AttemptState | null>(null);
  const [answeredVersionIds, setAnsweredVersionIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [status, setStatus] = useState<QuizStatus>("answering");
  const [finalResult, setFinalResult] = useState<QuizResult | null>(null);
  const [isResultRetrying, setIsResultRetrying] = useState(false);
  const [resultRetryError, setResultRetryError] = useState<unknown>(null);
  const startRequested = useRef(false);
  const answerKeys = useRef(new Map<string, string>());
  const {
    formattedChallengeDate: liveChallengeDate,
    nextReset,
  } = useUtcDayBoundary();
  const attemptChallengeDate = attemptState?.challengeDate;
  const challengeDate = resolveChallengeDateLabel(
    attemptChallengeDate,
    liveChallengeDate,
  );
  const startAttempt = useStartQuizAttempt();
  const resumeAttempt = useGetQuizAttempt(attemptId ?? "", {
    query: {
      queryKey: getGetQuizAttemptQueryKey(attemptId ?? ""),
      enabled: Boolean(attemptId),
      retry: false,
    },
  });
  const answerQuestion = useAnswerQuizQuestion();
  const completeAttempt = useCompleteQuizAttempt();
  const resultQuery = useGetQuizResult(attemptId ?? "", {
    query: {
      queryKey: getGetQuizResultQueryKey(attemptId ?? ""),
      enabled: Boolean(attemptId && attemptState?.status === "completed"),
      retry: false,
    },
  });

  const previousDateRef = useRef(liveChallengeDate);
  useEffect(() => {
    if (previousDateRef.current !== liveChallengeDate) {
      previousDateRef.current = liveChallengeDate;
      if (!queryQuizId) {
        void queryClient.invalidateQueries({ queryKey: getGetDailyQuizQueryKey() });
      }
    }
  }, [liveChallengeDate, queryQuizId, queryClient]);

  useEffect(() => {
    if (quizId && hasCheckedStorageFor !== quizId) {
      // Clear memory state for new quiz
      setAttemptState(null);
      setAnsweredVersionIds([]);
      setCurrentIndex(0);
      setSelectedId(null);
      setFeedback(null);
      setStatus("answering");
      setFinalResult(null);
      setIsResultRetrying(false);
      setResultRetryError(null);
      startRequested.current = false;
      startAttempt.reset();

      // Hydrate
      const storedId = readStoredAttemptId(`${ATTEMPT_STORAGE_KEY}:${quizId}`);
      setAttemptId(storedId);
      setHasCheckedStorageFor(quizId);
    }
  }, [quizId, hasCheckedStorageFor, startAttempt]);

  useEffect(() => {
    if (!quizId || hasCheckedStorageFor !== quizId || attemptId || startRequested.current || startAttempt.isPending) return;

    startRequested.current = true;
    startAttempt.mutate(
      {
        data: {
          quizId,
          idempotencyKey: getOrMintIdempotencyKey(quizId),
        },
      },
      {
        onSuccess: () => {
          analytics.quizStarted();
        },
      },
    );
  }, [attemptId, quizId, hasCheckedStorageFor, startAttempt]);

  useEffect(() => {
    if (!startAttempt.data || attemptId) return;
    const state = startAttempt.data;
    setAttemptId(state.attemptId);
    setAttemptState(state);
    setAnsweredVersionIds(state.answeredQuestionIds);
    if (attemptStorageKey) {
      window.localStorage.setItem(attemptStorageKey, state.attemptId);
    }
  }, [attemptId, attemptStorageKey, startAttempt.data]);

  useEffect(() => {
    if (!resumeAttempt.data) return;
    const state = resumeAttempt.data;
    setAttemptState(state);
    setAnsweredVersionIds(state.answeredQuestionIds);
  }, [resumeAttempt.data]);

  useEffect(() => {
    if (!attemptState) return;
    if (status === "feedback") return;
    const firstUnanswered = attemptState.questions.findIndex(
      (question) => !answeredVersionIds.includes(question.versionId),
    );
    if (firstUnanswered === -1) {
      setCurrentIndex(attemptState.questions.length);
      setStatus("ready_to_complete");
    } else {
      setCurrentIndex(firstUnanswered);
      setStatus("answering");
    }
  }, [attemptState?.attemptId, attemptState?.questions, answeredVersionIds, status]);

  useEffect(() => {
    if (completeAttempt.data) {
      setFinalResult(completeAttempt.data);
    }
  }, [completeAttempt.data]);

  const retryStart = () => {
    startRequested.current = false;
    startAttempt.reset();
  };

  const retryResume = () => {
    void resumeAttempt.refetch();
  };

  const retryResult = async () => {
    setIsResultRetrying(true);
    setResultRetryError(null);
    try {
      await resultQuery.refetch();
    } catch (error) {
      setResultRetryError(error);
    } finally {
      setIsResultRetrying(false);
    }
  };

  const handleSubmit = () => {
    const question = attemptState?.questions[currentIndex];
    if (!attemptId || !question || !selectedId || status !== "answering" || answerQuestion.isPending) return;

    answerQuestion.reset();
    const idempotencyKey = answerKeys.current.get(question.versionId) ?? crypto.randomUUID();
    answerKeys.current.set(question.versionId, idempotencyKey);
    answerQuestion.mutate(
      {
        attemptId,
        data: {
          versionId: question.versionId,
          choiceId: selectedId,
          idempotencyKey,
        },
      },
      {
        onSuccess: (answer) => {
          setFeedback(answer);
          setAnsweredVersionIds((current) =>
            current.includes(answer.versionId) ? current : [...current, answer.versionId],
          );
          setStatus("feedback");
        },
      },
    );
  };

  const handleNext = () => {
    if (status !== "feedback") return;
    setFeedback(null);
    setSelectedId(null);
    const nextIndex = currentIndex + 1;
    if (nextIndex < (attemptState?.questions.length ?? 0)) {
      setCurrentIndex(nextIndex);
      setStatus("answering");
    } else {
      setStatus("ready_to_complete");
    }
  };

  const handleComplete = () => {
    if (!attemptId || completeAttempt.isPending) return;
    completeAttempt.reset();
    completeAttempt.mutate(
      { attemptId },
      {
        onSuccess: () => {
          analytics.quizCompleted();
        },
      },
    );
  };

  const resetAttempt = () => {
    if (attemptStorageKey) {
      window.localStorage.removeItem(attemptStorageKey);
    }
    setAttemptId(null);
    setAttemptState(null);
    setAnsweredVersionIds([]);
    setFinalResult(null);
    setResultRetryError(null);
    startRequested.current = false;
    startAttempt.reset();
  };

  const result = finalResult ?? resultQuery.data;
  const activeQuestion = attemptState?.questions[currentIndex];
  const progressTotal = attemptState?.questions.length ?? 0;
  const progressPercent = progressTotal
    ? Math.round((Math.min(currentIndex + 1, progressTotal) / progressTotal) * 100)
    : 0;
  const answerErrorMessage = answerQuestion.isError
    ? getErrorMessage(
        answerQuestion.error,
        "This answer could not be submitted. It may already have been recorded; please resume your attempt.",
      )
    : null;

  const isResolvingQuizId = !queryQuizId && dailyQuizQuery.isLoading;

  if (isResolvingQuizId) {
    return (
      <PageShell>
        <StatusContent title="Loading challenge">
          <LoadingNotice message="Finding today’s challenge…" />
        </StatusContent>
      </PageShell>
    );
  }

  if (dailyQuizQuery.isError) {
    const status = (dailyQuizQuery.error as any)?.status;
    if (status === 404) {
      return (
        <PageShell>
          <StatusContent title="No active challenge">
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <p className="text-foreground">There is no challenge scheduled for today. Please check back later.</p>
            </div>
          </StatusContent>
        </PageShell>
      );
    }
    return (
      <PageShell>
        <StatusContent title="Could not load challenge">
          <ErrorNotice
            message={getErrorMessage(dailyQuizQuery.error, "The daily challenge could not be loaded.")}
            onRetry={() => void dailyQuizQuery.refetch()}
          />
        </StatusContent>
      </PageShell>
    );
  }

  if (!quizId) {
    return (
      <PageShell>
        <StatusContent title="No active challenge">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className="text-foreground">There is no challenge scheduled for today. Please check back later.</p>
          </div>
        </StatusContent>
      </PageShell>
    );
  }

  if (startAttempt.isError) {
    return (
      <PageShell>
        <StatusContent title="The challenge could not be started">
          <ErrorNotice
            message={getErrorMessage(startAttempt.error, "The challenge service returned an error.")}
            onRetry={retryStart}
          />
        </StatusContent>
      </PageShell>
    );
  }

  if (resumeAttempt.isError) {
    return (
      <PageShell>
        <StatusContent title="Your saved attempt could not be resumed">
          <ErrorNotice
            message={getErrorMessage(resumeAttempt.error, "The challenge service returned an error.")}
            onRetry={retryResume}
            retryLabel="Reload attempt"
          />
          <button
            onClick={resetAttempt}
            className="mt-4 w-full rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-secondary/50"
            data-testid="button-start-new-attempt"
          >
            Start a new attempt
          </button>
        </StatusContent>
      </PageShell>
    );
  }

  if (!attemptState || resumeAttempt.isLoading || startAttempt.isPending) {
    return (
      <PageShell>
        <StatusContent title="Preparing today’s challenge">
          <LoadingNotice message={attemptId ? "Resuming your attempt…" : "Loading reviewed questions…"} />
        </StatusContent>
      </PageShell>
    );
  }

  if (attemptState.status === "completed" || result) {
    if (resultQuery.isError && !result) {
      const resultError = resultRetryError ?? resultQuery.error;
      return (
        <PageShell>
          <StatusContent title="Your result could not be loaded">
            <ErrorNotice
              message={getErrorMessage(resultError, "The challenge service returned an error.")}
              onRetry={() => void retryResult()}
              retrying={isResultRetrying}
            />
          </StatusContent>
        </PageShell>
      );
    }

    if (!result) {
      return (
        <PageShell>
          <StatusContent title="Loading your result">
            <LoadingNotice message="Calculating your server-scored result…" />
          </StatusContent>
        </PageShell>
      );
    }

    return (
      <PageShell>
        <main className="flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-10 w-10 text-primary" />
          </div>
          <h1 className="mb-3 font-serif text-3xl font-semibold">Alhamdulillah</h1>
          <p className="mb-8 text-muted-foreground">
            You&apos;ve completed today&apos;s challenge. Your result was scored and saved by the challenge service.
          </p>
          <div className="mb-6 w-full rounded-xl border border-border/60 bg-secondary/40 p-4 text-left">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Challenge date: {challengeDate}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The next challenge opens at midnight UTC. For you, that is {nextReset}.
                </p>
              </div>
            </div>
          </div>
          <div className="mb-8 w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-1 font-serif text-4xl text-primary">
              {result.score}/{result.maxScore}
            </div>
            <div className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Points earned</div>
            {result.rewardPoints !== undefined && (
              <p className="mt-3 text-sm text-muted-foreground">Reward points: {result.rewardPoints}</p>
            )}
          </div>
          <button
            onClick={() => setLocation("/")}
            className="w-full rounded-xl bg-primary py-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="button-return-home"
          >
            Return to Home
          </button>
        </main>
      </PageShell>
    );
  }

  if (!activeQuestion || status === "ready_to_complete") {
    return (
      <PageShell>
        <main className="flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <CheckCircle2 className="mb-5 h-12 w-12 text-primary" />
          <h1 className="font-serif text-3xl font-semibold">All questions answered</h1>
          <p className="mt-3 mb-8 text-muted-foreground">Submit your completed attempt to see your server-scored result.</p>
          {completeAttempt.isError && (
            <div className="mb-5 w-full">
              <ErrorNotice
                message={getErrorMessage(completeAttempt.error, "Your result could not be completed.")}
                onRetry={handleComplete}
              />
            </div>
          )}
          <button
            onClick={handleComplete}
            disabled={completeAttempt.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-see-results"
          >
            {completeAttempt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {completeAttempt.isPending ? "Calculating result…" : "See results"}
          </button>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <main className="flex w-full max-w-lg flex-1 flex-col px-6 py-6">
        <button
          onClick={() => setLocation("/")}
          className="mb-8 flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          data-testid="button-back-challenge"
        >
          <ArrowLeft className="h-4 w-4" /> Today&apos;s challenge
        </button>

        <div className="mb-8 rounded-xl border border-border/60 bg-secondary/40 p-4">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">{challengeDate}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This challenge is shared worldwide. The next reset is at midnight UTC ({nextReset} for you).
              </p>
            </div>
          </div>
        </div>

        <div className="mb-10">
          <div className="mb-3 flex justify-between text-sm font-medium">
            <span className="text-muted-foreground">
              Question {currentIndex + 1} of {progressTotal}
            </span>
            <span className="text-foreground">{progressPercent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="flex-1">
          <h2 className="mb-8 font-serif text-2xl font-semibold leading-tight text-foreground md:text-3xl">
            {activeQuestion.prompt}
          </h2>

          <div className="space-y-3">
            {activeQuestion.choices.map((option) => {
              const isSelected = selectedId === option.id;
              const isSubmittedChoice = feedback?.choiceId === option.id;
              const isCorrect = isSubmittedChoice && feedback?.isCorrect;
              const isIncorrect = isSubmittedChoice && feedback && !feedback.isCorrect;
              let stateStyles = "border-border bg-card hover:bg-secondary/30";
              let circleStyles = "border-border";

              if (isSelected && status === "answering") {
                stateStyles = "border-primary bg-primary/5 ring-1 ring-primary/20";
                circleStyles = "border-primary border-[5px]";
              } else if (status === "feedback" && isCorrect) {
                stateStyles = "border-emerald-600 bg-emerald-50";
                circleStyles = "border-emerald-600 bg-emerald-600 text-white";
              } else if (status === "feedback" && isIncorrect) {
                stateStyles = "border-destructive bg-destructive/5";
                circleStyles = "border-destructive bg-destructive text-white";
              } else if (status === "feedback") {
                stateStyles = "border-border bg-card opacity-60";
              }

              return (
                <button
                  key={option.id}
                  onClick={() => status === "answering" && setSelectedId(option.id)}
                  disabled={status !== "answering" || answerQuestion.isPending}
                  className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all ${stateStyles}`}
                  data-testid={`option-${option.id}`}
                >
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${circleStyles}`}>
                    {isCorrect && <CheckCircle2 className="h-4 w-4 rounded-full bg-white text-emerald-600" />}
                    {isIncorrect && <XCircle className="h-4 w-4 text-white" />}
                  </div>
                  <span className="font-medium text-foreground">{option.label}</span>
                </button>
              );
            })}
          </div>

          {answerErrorMessage && (
            <div className="mt-6">
              <ErrorNotice
                message={answerErrorMessage}
                onRetry={handleSubmit}
                retryLabel={answerQuestion.error && (answerQuestion.error as { status?: number }).status === 409 ? "Resume and try again" : "Retry answer"}
              />
            </div>
          )}

          {status === "feedback" && feedback && (
            <div className="mt-8 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border/50 bg-secondary/40 p-5">
              <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${feedback.isCorrect ? "text-emerald-700" : "text-destructive"}`}>
                {feedback.isCorrect ? "That’s right." : "A thoughtful try."}
              </div>
              <p className="text-sm leading-relaxed text-foreground">{feedback.explanation}</p>
              <div className="mt-3 flex items-center justify-between">
                {feedback.sources[0]?.title ? (
                  <p className="text-xs font-medium text-muted-foreground">Source: {feedback.sources[0].title}</p>
                ) : (
                  <div />
                )}
                <ReportQuestionDialog versionId={activeQuestion.versionId} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 pt-8">
          {status === "answering" ? (
            <button
              onClick={handleSubmit}
              disabled={!selectedId || answerQuestion.isPending}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 font-medium transition-all ${
                selectedId && !answerQuestion.isPending
                  ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                  : "cursor-not-allowed bg-secondary text-muted-foreground"
              }`}
              data-testid="button-submit-answer"
            >
              {answerQuestion.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {answerQuestion.isPending ? "Scoring answer…" : "Submit answer"}
              {!answerQuestion.isPending && <ArrowRight className="h-4 w-4" />}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-medium text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
              data-testid="button-next-question"
            >
              {currentIndex < progressTotal - 1 ? "Next question" : "Finish challenge"} <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {status === "answering" && (
            <p className="mt-6 px-4 text-center text-xs text-muted-foreground">
              Take your time.<br className="md:hidden" /> Every question is a chance to learn.
            </p>
          )}
          {status === "feedback" && (
            <p className="mt-6 px-4 text-center text-xs uppercase tracking-widest text-muted-foreground">
              Knowledge Builds Brighter Days
            </p>
          )}
        </div>
      </main>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <QuizHeader />
      {children}
    </div>
  );
}

function StatusContent({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <main className="flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <h1 className="mb-6 font-serif text-3xl font-semibold">{title}</h1>
      <div className="w-full">{children}</div>
    </main>
  );
}

function QuizHeader() {
  return (
    <header className="w-full border-b border-border/40 bg-white">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2" data-testid="link-quiz-home">
          <div className="relative flex h-7 w-7 items-center justify-center text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
              <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" />
              <path d="M12 5.5L13.5 9.5L17.5 11L13.5 12.5L12 16.5L10.5 12.5L6.5 11L10.5 9.5L12 5.5Z" className="opacity-50" />
            </svg>
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">AlKabirList</span>
        </Link>
        <button className="-mr-2 p-2 text-foreground">
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}