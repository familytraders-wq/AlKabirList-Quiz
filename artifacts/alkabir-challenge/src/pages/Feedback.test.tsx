import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Feedback } from "./Feedback";
import { analytics } from "../lib/analytics";

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: true })),
}));

// Mock the router Link
vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/", vi.fn()],
}));

// Provide a mock umami on window
const mockUmamiTrack = vi.fn();
beforeEach(() => {
  window.umami = { track: mockUmamiTrack };
});

afterEach(() => {
  vi.clearAllMocks();
  delete window.umami;
  cleanup();
});

// We need to control the response of useListMyFeedback for our test.
// So we hoist the mock state.
const mockState = vi.hoisted(() => ({
  listFeedback: {
    data: null as any,
    isLoading: true,
    error: null as any,
  }
}));

// Mock api-client-react
vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  
  return {
    ...actual as any,
    getListMyFeedbackQueryKey: () => ["my-feedback"],
    useListMyFeedback: vi.fn(() => ({ 
      data: mockState.listFeedback.data, 
      isLoading: mockState.listFeedback.isLoading,
      error: mockState.listFeedback.error
    })),
    useCreateMyFeedback: vi.fn((opts) => ({
      mutate: vi.fn((variables) => {
        if (opts?.mutation?.onSuccess) {
          opts.mutation.onSuccess(null, variables);
        }
      }),
      isPending: false,
    })),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    ),
    queryClient
  };
}

describe("Feedback page", () => {
  beforeEach(() => {
    mockState.listFeedback.data = null;
    mockState.listFeedback.isLoading = true;
    mockState.listFeedback.error = null;
  });

  it("transitions from loading to returning history", async () => {
    const { rerender } = renderWithProviders(<Feedback />);
    
    // Initially should be loading
    expect(screen.getByTestId("feedback-loading")).toBeInTheDocument();
    
    // Now simulate successful API response with some history
    mockState.listFeedback.isLoading = false;
    mockState.listFeedback.data = {
      items: [
        { id: "f1", kind: "general", status: "open", message: "My first feedback", createdAt: new Date().toISOString() }
      ],
      total: 1
    };
    
    // Rerender to apply new mock state
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Feedback />
      </QueryClientProvider>
    );
    
    // Loading should be gone, history should be visible
    expect(screen.queryByTestId("feedback-loading")).not.toBeInTheDocument();
    expect(screen.getByText("My first feedback")).toBeInTheDocument();
    expect(screen.getByText("General Feedback")).toBeInTheDocument();
  });

  it("exits spinner and shows empty state when data is empty", async () => {
    const { rerender } = renderWithProviders(<Feedback />);
    
    expect(screen.getByTestId("feedback-loading")).toBeInTheDocument();
    
    mockState.listFeedback.isLoading = false;
    mockState.listFeedback.data = {
      items: [],
      total: 0
    };
    
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Feedback />
      </QueryClientProvider>
    );
    
    expect(screen.queryByTestId("feedback-loading")).not.toBeInTheDocument();
    expect(screen.getByText("No feedback yet")).toBeInTheDocument();
  });

  it("renders query errors", async () => {
    const { rerender } = renderWithProviders(<Feedback />);
    
    expect(screen.getByTestId("feedback-loading")).toBeInTheDocument();
    
    mockState.listFeedback.isLoading = false;
    mockState.listFeedback.error = new Error("Failed to load");
    
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Feedback />
      </QueryClientProvider>
    );
    
    expect(screen.queryByTestId("feedback-loading")).not.toBeInTheDocument();
    expect(screen.getByText("Could not load your feedback history. Please try refreshing the page.")).toBeInTheDocument();
  });
  
  it("preserves history labels for legacy question_accuracy items", async () => {
    mockState.listFeedback.isLoading = false;
    mockState.listFeedback.data = {
      items: [
        { id: "f2", kind: "question_accuracy", status: "open", message: "Legacy accuracy feedback", createdAt: new Date().toISOString() }
      ],
      total: 1
    };
    
    renderWithProviders(<Feedback />);
    
    expect(screen.getByText("Legacy accuracy feedback")).toBeInTheDocument();
    expect(screen.getByText("Question Accuracy")).toBeInTheDocument();
  });
});
