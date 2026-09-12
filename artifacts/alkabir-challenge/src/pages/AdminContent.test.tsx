import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { AdminContent } from "./AdminContent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
  }),
}));

const mockMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
let authPermissions = ["content.view", "content.manage"];

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
        user: { roles: ["admin"], isSuperAdmin: false, permissions: authPermissions },
        authenticated: true,
      },
      isLoading: false,
    }),
    useListAdminQuestions: ({ status }: any) => {
      if (status === "approved") return { data: { items: [] }, isLoading: false };
      if (status === "draft") return {
        data: {
          items: [{
            id: "q-1",
            versionId: "v-1",
            version: 1,
            status: "draft",
            prompt: "Test Question",
            explanation: "",
            points: 15,
            choices: [{ label: "A", position: 0, isCorrect: true }, { label: "B", position: 1, isCorrect: false }],
            sourceMetadata: []
          }]
        },
        isLoading: false
      };
      if (status === "pending_review") return {
        data: {
          items: [{
            id: "q-2",
            versionId: "v-2",
            version: 1,
            status: "pending_review",
            prompt: "Pending Question",
            explanation: "",
            points: 10,
            choices: [{ label: "A", position: 0, isCorrect: true }],
            sourceMetadata: []
          }]
        },
        isLoading: false
      };
      return { data: { items: [] }, isLoading: false };
    },
    useUpdateAdminQuestion: () => ({
      mutate: mockUpdateMutate,
      isPending: false
    }),
    useReviewQuestion: () => ({
      mutate: mockMutate,
      isPending: false
    })
  };
});

describe("AdminContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPermissions = ["content.view", "content.manage"];
  });
  afterEach(() => {
    cleanup();
  });

  it("renders read-only content for view-only permissions", async () => {
    authPermissions = ["content.view"];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Content Workspace")).toBeInTheDocument());
    expect(screen.queryByText("Intake & Generation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders the content workspace for admins", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminContent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Content Workspace")).toBeInTheDocument();
    });
    
    expect(screen.getByText("Question Bank")).toBeInTheDocument();
    expect(screen.getByText("Review Queue")).toBeInTheDocument();
    expect(screen.getByText("Intake & Generation")).toBeInTheDocument();
  });

  it("submits draft for review and calls invalidateQueries", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminContent />
      </QueryClientProvider>
    );

    // Switch to Drafts filter
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "draft" } });

    const submitBtn = await screen.findByRole("button", { name: /Submit for Review/i });
    expect(submitBtn).toBeInTheDocument();

    mockMutate.mockImplementationOnce((args, options) => {
      options.onSuccess();
    });

    fireEvent.click(submitBtn);

    expect(mockMutate).toHaveBeenCalledWith(
      { questionId: "q-1", data: { decision: "submit", expectedStatus: "draft" } },
      expect.any(Object)
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it("submits pending_review for approval and calls invalidateQueries", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminContent />
      </QueryClientProvider>
    );

    // Switch to Review Queue tab
    const queueTab = await screen.findByRole("button", { name: /Review Queue/i });
    fireEvent.click(queueTab);

    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    expect(approveBtn).toBeInTheDocument();

    mockMutate.mockImplementationOnce((args, options) => {
      options.onSuccess();
    });

    fireEvent.click(approveBtn);

    expect(mockMutate).toHaveBeenCalledWith(
      { questionId: "q-2", data: { decision: "approve", expectedStatus: "pending_review" } },
      expect.any(Object)
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it("initializes edit form with existing points and preserves them on save", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AdminContent />
      </QueryClientProvider>
    );

    // Switch to Drafts filter
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "draft" } });

    // Click Edit button
    const editBtn = await screen.findByRole("button", { name: "Edit" });
    fireEvent.click(editBtn);

    // Verify points are initialized to 15
    const pointsInput = await screen.findByLabelText("Points");
    expect(pointsInput).toHaveValue(15);

    // Change a text field to verify payload preserves points
    const promptInput = await screen.findByPlaceholderText("e.g., Which prophet built the Ark?");
    fireEvent.change(promptInput, { target: { value: "Updated prompt" } });

    mockUpdateMutate.mockImplementationOnce((args, options) => {
      options.onSuccess();
    });

    // Save
    const saveBtn = await screen.findByRole("button", { name: "Update Draft" });
    fireEvent.click(saveBtn);

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        questionId: "q-1",
        data: expect.objectContaining({
          prompt: "Updated prompt",
          points: 15
        })
      },
      expect.any(Object)
    );
  });
});
