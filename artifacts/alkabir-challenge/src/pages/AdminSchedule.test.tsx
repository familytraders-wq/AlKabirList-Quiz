import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { AdminSchedule } from "./AdminSchedule";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
  }),
}));

const mockCreateQuiz = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries
    })
  };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    useGetAuthMe: () => ({
      data: {
        user: { roles: ["admin"] },
        authenticated: true,
      },
      isLoading: false,
    }),
    useListAdminQuizzes: () => ({
      data: { items: [] },
      isLoading: false,
    }),
    useListAdminQuestions: () => ({
      data: { 
        items: [{
          id: "q-1",
          versionId: "v-1",
          version: 1,
          status: "approved",
          prompt: "Test Question with 15 points",
          explanation: "",
          points: 15,
          choices: [{ label: "A", position: 0, isCorrect: true }, { label: "B", position: 1, isCorrect: false }],
          sourceMetadata: []
        }]
      },
      isLoading: false,
    }),
    useCreateAdminQuiz: () => ({
      mutate: mockCreateQuiz,
      isPending: false
    })
  };
});

describe("AdminSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the schedule workspace for admins", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminSchedule />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Schedule Quizzes")).toBeInTheDocument();
    });
    
    expect(screen.getByText("Create Quiz")).toBeInTheDocument();
  });

  it("selects a question, inherits its points, and submits successfully", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminSchedule />
      </QueryClientProvider>
    );

    const createBtn = await screen.findByRole("button", { name: "Create Quiz" });
    fireEvent.click(createBtn);

    const titleInput = await screen.findByLabelText("Quiz Title");
    fireEvent.change(titleInput, { target: { value: "Test Quiz" } });
    
    const dateInput = await screen.findByLabelText(/Scheduled Date/i);
    fireEvent.change(dateInput, { target: { value: "2025-10-15" } });

    const checkbox = await screen.findByRole("checkbox", { name: "" }); // the question checkbox
    fireEvent.click(checkbox);

    // Verify it inherited 15 points
    const pointsInput = await screen.findByLabelText(/Points for Test Question with 15 points/i);
    expect(pointsInput).toHaveValue(15);

    // Validate empty input error
    fireEvent.change(pointsInput, { target: { value: "" } });
    const saveBtn = screen.getByRole("button", { name: "Save Quiz" });
    fireEvent.click(saveBtn);
    expect(await screen.findByText(/All selected questions must have a valid positive integer/i)).toBeInTheDocument();

    // Fix and submit
    fireEvent.change(pointsInput, { target: { value: "15" } });
    
    mockCreateQuiz.mockImplementationOnce((args, options) => {
      options.onSuccess();
    });

    fireEvent.click(saveBtn);

    expect(mockCreateQuiz).toHaveBeenCalledWith(
      {
        data: {
          title: "Test Quiz",
          scheduledDate: "2025-10-15",
          timezone: "UTC",
          isActive: false,
          questions: [{ versionId: "v-1", points: 15 }]
        }
      },
      expect.any(Object)
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });
});
