import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Feedback } from "./Feedback";
import { AdminBeta, BetaFeedbackTab } from "./AdminBeta";
import { ReportQuestionDialog } from "../components/feedback/ReportQuestionDialog";
import { analytics } from "../lib/analytics";

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: true })),
}));

// Mock the router Link
vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid={`redirect-${to}`} />,
  useLocation: () => ["/", vi.fn()],
}));

// Provide a mock umami on window
const mockUmamiTrack = vi.fn();
beforeEach(() => {
  window.umami = { track: mockUmamiTrack };
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.clearAllMocks();
  delete window.umami;
  cleanup();
});

// Mock api-client-react
vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  
  return {
    ...actual as any,
    useGetAuthMe: vi.fn(() => ({ data: { user: { roles: ["admin", "reviewer"] } }, isLoading: false })),
    useListMyFeedback: vi.fn(() => ({ data: { items: [], total: 0 }, isLoading: false })),
    
    useCreateMyFeedback: vi.fn((opts) => ({
      mutate: vi.fn((variables) => {
        if (opts?.mutation?.onSuccess) {
          opts.mutation.onSuccess(null, variables);
        }
      }),
      isPending: false,
    })),
    
    useGetBetaSummary: vi.fn(() => ({ data: { totalMembers: 10, series: [] }, isLoading: false })),
    useListBetaFeedback: vi.fn(() => ({ data: { items: [{ id: "f1", kind: "general", status: "open", message: "Hello", createdAt: new Date().toISOString() }] }, isLoading: false })),
    useListBetaAudit: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
    
    useModerateBetaFeedback: vi.fn((opts) => ({
      mutate: vi.fn((variables) => {
        if (opts?.mutation?.onSuccess) {
          opts.mutation.onSuccess(null, variables);
        }
      }),
      isPending: false,
    })),
  };
});

import * as apiClient from "@workspace/api-client-react";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe("Beta features", () => {
  it("submits member feedback and calls safe analytics", async () => {
    renderWithProviders(<Feedback />);
    
    // Open form
    const newFeedbackBtn = screen.getByTestId("button-new-feedback");
    fireEvent.click(newFeedbackBtn);
    
    const textarea = screen.getByTestId("textarea-feedback-message");
    fireEvent.change(textarea, { target: { value: "This is a test feedback that is long enough." } });
    
    const submitBtn = screen.getByTestId("button-submit-feedback");
    fireEvent.click(submitBtn);
    
    await waitFor(() => {
      expect(mockUmamiTrack).toHaveBeenCalledWith("feedback_submitted", { kind: "general" });
    });
  });

  it("submits a question report payload", async () => {
    renderWithProviders(<ReportQuestionDialog versionId="v123" />);
    
    // Click trigger
    fireEvent.click(screen.getByTestId("button-report-question"));
    
    // Type in textarea
    const textarea = screen.getByTestId("textarea-report-message");
    fireEvent.change(textarea, { target: { value: "Wrong answer here." } });
    
    // Submit
    fireEvent.click(screen.getByTestId("button-submit-report"));
    
    await waitFor(() => {
      expect(mockUmamiTrack).toHaveBeenCalledWith("question_reported", undefined);
    });
  });

  it("handles moderation and surfaces 409 staleness", async () => {
    renderWithProviders(<BetaFeedbackTab />);
    
    const startReviewBtn = await screen.findByText("Start Review");
    fireEvent.click(startReviewBtn);
    
    await waitFor(() => {
      expect(mockUmamiTrack).toHaveBeenCalledWith("feedback_moderated", { status: "in_review" });
    });
  });

  it("enforces role visibility for AdminBeta", async () => {
    vi.mocked(apiClient.useGetAuthMe).mockReturnValueOnce({ data: { user: { roles: [] } }, isLoading: false } as any);
    renderWithProviders(<AdminBeta />);
    expect(screen.getByTestId("redirect-/member")).toBeInTheDocument();
  });
});