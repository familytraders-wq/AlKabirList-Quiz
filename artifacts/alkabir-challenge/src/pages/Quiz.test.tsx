import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  start: {
    data: null as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
    mutateImpl: null as ((variables: unknown, options: unknown, update: (patch: Record<string, unknown>) => void) => void) | null,
  },
  resume: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  answer: {
    data: null as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
    mutateImpl: null as ((variables: unknown, options: unknown, update: (patch: Record<string, unknown>) => void) => void) | null,
  },
  complete: {
    data: null as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
    mutateImpl: null as ((variables: unknown, options: unknown, update: (patch: Record<string, unknown>) => void) => void) | null,
  },
  result: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  dailyQuiz: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

const mockUtcDayBoundary = vi.hoisted(() => ({
  formattedChallengeDate: "2023-01-01",
  nextReset: "2023-01-02",
}));

vi.mock("@/hooks/use-utc-day-boundary", () => ({
  useUtcDayBoundary: () => mockUtcDayBoundary,
  resolveChallengeDateLabel: (attemptChallengeDate: string | undefined, liveChallengeDate: string) =>
    attemptChallengeDate ? attemptChallengeDate : liveChallengeDate,
}));

vi.mock("@workspace/api-client-react", async () => {
  const React = await import("react");

  function useMutationHarness(
    key: "start" | "answer" | "complete",
  ) {
    const [, render] = React.useState(0);
    const state = mockState[key];

    return {
      data: state.data,
      isPending: state.isPending,
      isError: state.isError,
      error: state.error,
      mutate: (variables: unknown, options?: unknown) => {
        if (state.mutateImpl) {
          state.mutateImpl(variables, options, (patch) => {
            Object.assign(state, patch);
            render((value) => value + 1);
          });
        }
        render((value) => value + 1);
      },
      reset: () => {
        state.isError = false;
        state.error = null;
        render((value) => value + 1);
      },
    };
  }

  return {
    getGetQuizAttemptQueryKey: (attemptId: string) => [`attempt:${attemptId}`],
    getGetQuizResultQueryKey: (attemptId: string) => [`result:${attemptId}`],
    useStartQuizAttempt: () => useMutationHarness("start"),
    useAnswerQuizQuestion: () => useMutationHarness("answer"),
    useCompleteQuizAttempt: () => useMutationHarness("complete"),
    useGetQuizAttempt: () => ({
      data: mockState.resume.data,
      isLoading: mockState.resume.isLoading,
      isError: mockState.resume.isError,
      error: mockState.resume.error,
      refetch: mockState.resume.refetch,
    }),
    useGetQuizResult: () => {
      const [, render] = React.useState(0);

      return {
        data: mockState.result.data,
        isLoading: mockState.result.isLoading,
        isError: mockState.result.isError,
        error: mockState.result.error,
        refetch: () => {
          const result = mockState.result.refetch();
          render((value) => value + 1);
          return result;
        },
      };
    },
    getGetDailyQuizQueryKey: () => ["daily-quiz"],
    useGetDailyQuiz: () => {
      const [, render] = React.useState(0);
      return {
        data: mockState.dailyQuiz.data,
        isLoading: mockState.dailyQuiz.isLoading,
        isError: mockState.dailyQuiz.isError,
        error: mockState.dailyQuiz.error,
        refetch: () => {
          const result = mockState.dailyQuiz.refetch();
          render((value) => value + 1);
          return result;
        },
      };
    },
    useCreateMyFeedback: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("wouter", () => ({
  Link: "a",
  useLocation: () => ["/quiz", vi.fn()],
}));

import { Quiz } from "./Quiz";

const question = {
  id: "question-1",
  versionId: "reviewed-version-1",
  prompt: "Which quality should guide a daily act of worship?",
  type: "multiple_choice",
  points: 1,
  choices: [
    { id: "choice-a", label: "Sincerity", position: 0 },
    { id: "choice-b", label: "Recognition", position: 1 },
  ],
};

const secondQuestion = {
  ...question,
  id: "question-2",
  versionId: "reviewed-version-2",
  prompt: "Which habit helps knowledge take root?",
  choices: [
    { id: "choice-c", label: "Reflection", position: 0 },
    { id: "choice-d", label: "Haste", position: 1 },
  ],
};

const inProgressAttempt = {
  attemptId: "attempt-1",
  quizId: "daily-quiz",
  status: "in_progress",
  questions: [question, secondQuestion],
  answeredQuestionIds: [],
};

const completedAttempt = {
  ...inProgressAttempt,
  status: "completed",
  answeredQuestionIds: [question.versionId, secondQuestion.versionId],
};

const completedResult = {
  attemptId: "attempt-1",
  status: "completed",
  score: 2,
  maxScore: 2,
  answers: [],
  rewardPoints: 10,
};

function resetHarness() {
  mockState.start.data = null;
  mockState.start.isPending = false;
  mockState.start.isError = false;
  mockState.start.error = null;
  mockState.start.mutateImpl = null;
  mockState.resume.data = null;
  mockState.resume.isLoading = false;
  mockState.resume.isError = false;
  mockState.resume.error = null;
  mockState.resume.refetch.mockReset();
  mockState.answer.data = null;
  mockState.answer.isPending = false;
  mockState.answer.isError = false;
  mockState.answer.error = null;
  mockState.answer.mutateImpl = null;
  mockState.complete.data = null;
  mockState.complete.isPending = false;
  mockState.complete.isError = false;
  mockState.complete.error = null;
  mockState.complete.mutateImpl = null;
  mockState.result.data = null;
  mockState.result.isLoading = false;
  mockState.result.isError = false;
  mockState.result.error = null;
  mockState.result.refetch.mockReset();
  mockState.dailyQuiz.data = null;
  mockState.dailyQuiz.isLoading = false;
  mockState.dailyQuiz.isError = false;
  mockState.dailyQuiz.error = null;
  mockState.dailyQuiz.refetch.mockReset();
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
  return {
    ...view,
    queryClient,
    rerenderWithProviders: (rerenderUi: React.ReactElement) => view.rerender(
      <QueryClientProvider client={queryClient}>
        {rerenderUi}
      </QueryClientProvider>
    )
  };
}

beforeEach(() => {
  resetHarness();
  window.localStorage.clear();
  mockUtcDayBoundary.formattedChallengeDate = "2023-01-01";
  window.history.replaceState({}, "", "/quiz?quizId=daily-quiz");
});

afterEach(() => {
  cleanup();
});

describe("Quiz lifecycle", () => {
  it("starts a configured attempt using explicit ID and renders reviewed questions", async () => {
    mockState.start.mutateImpl = (_variables, _options, update) => {
      queueMicrotask(() => update({ data: inProgressAttempt }));
    };

    renderWithProviders(<Quiz />);

    expect(screen.getByTestId("quiz-loading")).toBeInTheDocument();
    await screen.findByText(question.prompt);

    expect(screen.getByText("Sincerity")).toBeInTheDocument();
    expect(screen.getByText("Recognition")).toBeInTheDocument();
    expect(screen.queryByText(/answer key|correct answer|reviewed-version-1/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("alkabir.quiz.attemptId:daily-quiz")).toBe("attempt-1");
  });

  it("retains the same idempotencyKey across start retries", async () => {
    let callCount = 0;
    const capturedKeys: string[] = [];
    mockState.start.mutateImpl = (variables: any, _options, update) => {
      callCount++;
      capturedKeys.push(variables.data.idempotencyKey);
      if (callCount === 1) {
        queueMicrotask(() => update({ isError: true, error: new Error("Network error") }));
      } else {
        queueMicrotask(() => update({ data: inProgressAttempt, isError: false }));
      }
    };

    renderWithProviders(<Quiz />);
    expect(await screen.findByText("Network error")).toBeInTheDocument();

    // retry
    fireEvent.click(screen.getByTestId("button-retry-quiz"));
    await screen.findByText(question.prompt);

    expect(callCount).toBe(2);
    expect(capturedKeys[0]).toBeTruthy();
    expect(capturedKeys[0]).toEqual(capturedKeys[1]); // MUST be the exact same key
  });

  it("resolves the daily quiz when no explicit ID is provided and prevents duplicate starts", async () => {
    window.history.replaceState({}, "", "/quiz");
    mockState.dailyQuiz.isLoading = true;
    const { rerenderWithProviders } = renderWithProviders(<Quiz />);
    expect(screen.getByText("Finding today’s challenge…")).toBeInTheDocument();
    expect(mockState.start.mutateImpl).toBeNull();

    mockState.dailyQuiz.isLoading = false;
    mockState.dailyQuiz.data = { quizId: "resolved-daily", title: "Test", scheduledDate: "2023-01-01", questionCount: 2 };
    let mutateCalled = 0;
    mockState.start.mutateImpl = (_variables, _options, update) => {
      mutateCalled++;
      queueMicrotask(() => update({ data: { ...inProgressAttempt, quizId: "resolved-daily" } }));
    };

    rerenderWithProviders(<Quiz />);
    await screen.findByText(question.prompt);
    expect(mutateCalled).toBe(1);
    expect(window.localStorage.getItem("alkabir.quiz.attemptId:resolved-daily")).toBe("attempt-1");
  });

  it("refetches daily quiz and drops old memory state on UTC date change, leaving pinned explicit IDs alone", async () => {
    window.history.replaceState({}, "", "/quiz");
    mockState.dailyQuiz.data = { quizId: "day-1", title: "Day 1", scheduledDate: "2023-01-01", questionCount: 2 };

    mockState.start.mutateImpl = (variables: any, _options, update) => {
      queueMicrotask(() => update({ data: { ...inProgressAttempt, quizId: variables.data.quizId } }));
    };

    const { rerenderWithProviders, queryClient, unmount } = renderWithProviders(<Quiz />);
    await screen.findByText(question.prompt);
    expect(window.localStorage.getItem("alkabir.quiz.attemptId:day-1")).toBe("attempt-1");
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    // simulate rollover
    mockUtcDayBoundary.formattedChallengeDate = "2023-01-02";
    mockState.dailyQuiz.data = { quizId: "day-2", title: "Day 2", scheduledDate: "2023-01-02", questionCount: 2 };

    rerenderWithProviders(<Quiz />);

    // verify it dropped day-1 and queried day-2
    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["daily-quiz"] });
    });
    // Wait for the new start mutation with the new ID
    await waitFor(() => {
      expect(window.localStorage.getItem("alkabir.quiz.attemptId:day-2")).toBe("attempt-1");
    });
    unmount();

    // Now test that pinned IDs ignore rollover
    resetHarness();
    window.history.replaceState({}, "", "/quiz?quizId=pinned-quiz");
    mockUtcDayBoundary.formattedChallengeDate = "2023-01-01";
    mockState.start.mutateImpl = (variables: any, _options, update) => {
      queueMicrotask(() => update({ data: { ...inProgressAttempt, quizId: variables.data.quizId } }));
    };
    const { rerenderWithProviders: rerenderPinned, queryClient: pinnedClient } = renderWithProviders(<Quiz />);
    await screen.findByText(question.prompt);

    mockUtcDayBoundary.formattedChallengeDate = "2023-01-02";
    rerenderPinned(<Quiz />);
    await waitFor(() => expect(pinnedClient.invalidateQueries).not.toHaveBeenCalled());
  });

  it("handles 404 no-active-challenge from daily resolver", async () => {
    window.history.replaceState({}, "", "/quiz");
    mockState.dailyQuiz.isError = true;
    mockState.dailyQuiz.error = { status: 404 };

    renderWithProviders(<Quiz />);
    expect(await screen.findByText("There is no challenge scheduled for today. Please check back later.")).toBeInTheDocument();
  });

  it("resumes a saved attempt at its first unanswered reviewed question", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = {
      ...inProgressAttempt,
      answeredQuestionIds: [question.versionId],
    };

    renderWithProviders(<Quiz />);

    expect(await screen.findByText(secondQuestion.prompt)).toBeInTheDocument();
    expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();
    expect(screen.queryByText(question.prompt)).not.toBeInTheDocument();
  });

  it("shows an answer submission error and lets the user retry", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = inProgressAttempt;
    let answerAttempts = 0;
    mockState.answer.mutateImpl = (_variables, options, update) => {
      answerAttempts += 1;
      if (answerAttempts === 1) {
        update({
          isError: true,
          error: new Error("The answer service is temporarily unavailable."),
        });
        return;
      }

      update({ isError: false, error: null });
      (options as { onSuccess?: (value: unknown) => void }).onSuccess?.({
        versionId: question.versionId,
        choiceId: "choice-a",
        isCorrect: true,
        awardedPoints: 1,
        explanation: "Sincerity keeps the intention clear.",
        sources: [],
      });
    };

    renderWithProviders(<Quiz />);
    await screen.findByText(question.prompt);
    fireEvent.click(screen.getByTestId("option-choice-a"));
    fireEvent.click(screen.getByTestId("button-submit-answer"));

    expect(await screen.findByText("The answer service is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByTestId("button-retry-quiz")).toHaveTextContent("Retry answer");

    fireEvent.click(screen.getByTestId("button-retry-quiz"));

    await waitFor(() => expect(screen.getByText("That’s right.")).toBeInTheDocument());
    expect(answerAttempts).toBe(2);
  });

  it("renders the completed server-scored result for a completed attempt", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = completedAttempt;
    mockState.result.data = completedResult;

    renderWithProviders(<Quiz />);

    expect(await screen.findByText("Alhamdulillah")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Reward points: 10")).toBeInTheDocument();
  });

  it("renders a completed-result error and recovers on retry", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = completedAttempt;
    mockState.result.isError = true;
    mockState.result.error = new Error("The result service is temporarily unavailable.");
    mockState.result.refetch.mockImplementation(() => {
      mockState.result.isError = false;
      mockState.result.error = null;
      mockState.result.data = completedResult;
    });

    renderWithProviders(<Quiz />);

    expect(await screen.findByText("Your result could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("The result service is temporarily unavailable.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-retry-quiz"));

    expect(await screen.findByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Reward points: 10")).toBeInTheDocument();
    expect(mockState.result.refetch).toHaveBeenCalledOnce();
  });

  it("prevents duplicate completed-result retries during rapid activation", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = completedAttempt;
    mockState.result.isError = true;
    mockState.result.error = new Error("The result service is temporarily unavailable.");

    let requestCount = 0;
    let resolveRetry!: () => void;
    mockState.result.refetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          requestCount += 1;
          resolveRetry = () => {
            mockState.result.isError = false;
            mockState.result.error = null;
            mockState.result.data = completedResult;
            resolve();
          };
        }),
    );

    renderWithProviders(<Quiz />);

    expect(await screen.findByText("Your result could not be loaded")).toBeInTheDocument();
    const retryButton = screen.getByTestId("button-retry-quiz");
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(requestCount).toBe(1);
      expect(retryButton).toBeDisabled();
      expect(retryButton).toHaveTextContent("Retrying…");
    });
    expect(screen.getByText("The result service is temporarily unavailable.")).toBeInTheDocument();

    resolveRetry();

    expect(await screen.findByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Reward points: 10")).toBeInTheDocument();
  });

  it("re-enables completed-result retry after a second failed request", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = completedAttempt;
    mockState.result.isError = true;
    mockState.result.error = new Error("The result service is temporarily unavailable.");

    let resolveRetry!: () => void;
    mockState.result.refetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = () => {
            mockState.result.error = new Error("The result service failed again.");
            resolve();
          };
        }),
    );

    renderWithProviders(<Quiz />);

    expect(await screen.findByText("Your result could not be loaded")).toBeInTheDocument();
    const retryButton = screen.getByTestId("button-retry-quiz");
    expect(screen.getByText("The result service is temporarily unavailable.")).toBeInTheDocument();

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(retryButton).toBeDisabled();
      expect(retryButton).toHaveTextContent("Retrying…");
    });

    resolveRetry();

    await waitFor(() => {
      expect(retryButton).toBeEnabled();
      expect(retryButton).toHaveTextContent("Try again");
    });
    expect(screen.getByText("The result service failed again.")).toBeInTheDocument();
  });

  it("handles a rejected completed-result retry and shows its error", async () => {
    window.localStorage.setItem("alkabir.quiz.attemptId:daily-quiz", "attempt-1");
    mockState.resume.data = completedAttempt;
    mockState.result.isError = true;
    mockState.result.error = new Error("The result service is temporarily unavailable.");
    mockState.result.refetch.mockRejectedValueOnce(
      new Error("The result service rejected the retry request."),
    );

    renderWithProviders(<Quiz />);

    expect(await screen.findByText("Your result could not be loaded")).toBeInTheDocument();
    const retryButton = screen.getByTestId("button-retry-quiz");

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(retryButton).toBeEnabled();
      expect(retryButton).toHaveTextContent("Try again");
    });
    expect(screen.getByText("The result service rejected the retry request.")).toBeInTheDocument();
  });
});
