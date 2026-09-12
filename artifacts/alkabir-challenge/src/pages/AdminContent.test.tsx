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
const mockImportMutate = vi.fn();
const { mockExportQuestionsCsv } = vi.hoisted(() => ({
  mockExportQuestionsCsv: vi.fn(),
}));
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
    }),
    useImportAdminQuestionsCsv: () => ({
      mutate: mockImportMutate,
      isPending: false
    }),
    exportAdminQuestionsCsv: mockExportQuestionsCsv,
  };
});

describe("AdminContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPermissions = ["content.view", "content.manage"];
    mockExportQuestionsCsv.mockResolvedValue("question_id,expected_version\nq-1,1\n");
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

  it("downloads the questions shown by the selected status filter", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:question-export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Export all draft" }));

    await waitFor(() => expect(mockExportQuestionsCsv).toHaveBeenCalledWith({ status: "draft" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:question-export");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });

  it("shows an error when a question export fails", async () => {
    mockExportQuestionsCsv.mockRejectedValueOnce(new Error("network failure"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Export all draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The question export could not be downloaded");
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

  it("selects and submits a CSV payload, then clears the file and invalidates questions", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Intake & Generation" }));
    const file = new File(["prompt,explanation"], "questions.csv", { type: "text/csv" });
    const csv = "question_id,expected_version,prompt,explanation,type,points,choice_1,choice_1_correct,choice_2,choice_2_correct,choice_3,choice_3_correct,choice_4,choice_4_correct,source_title,source_url,category_id,difficulty_id,audience_ids\n,,What is 2+2?,,multiple_choice,1,Four,true,Five,false,,,,,,,,";
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(csv) });
    mockImportMutate.mockImplementationOnce((_request, options) => options.onSuccess({ importedCount: 1, createdCount: 1, updatedCount: 0, questionIds: ["q-1"] }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(await screen.findByText(/questions\.csv/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import question changes" }));

    await waitFor(() => expect(mockImportMutate).toHaveBeenCalledWith(
      { data: { filename: "questions.csv", csv } },
      expect.any(Object),
    ));
    expect(screen.queryByText(/questions\.csv/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/1 draft question imported successfully \(1 created, 0 updated\)/);
    expect(mockInvalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.any(Array) }));
  });

  it("renders API row errors in an accessible table", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Intake & Generation" }));
    const file = new File(["csv"], "questions.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue("bad,csv") });
    mockImportMutate.mockImplementationOnce((_request, options) => options.onError({
      data: { error: "CSV validation failed", rowErrors: [{ row: 2, column: "prompt", message: "Prompt is required" }] },
    }));
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Import question changes" }));

    expect(await screen.findByRole("table", { name: "CSV import row errors" })).toBeInTheDocument();
    expect(screen.getByText("Prompt is required")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("CSV validation failed");
  });

  it("rejects an oversized file before reading it or calling the import mutation", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Intake & Generation" }));
    const file = new File(["x"], "too-large.csv", { type: "text/csv" });
    Object.defineProperty(file, "size", { value: 2 * 1024 * 1024 + 1 });
    const text = vi.fn();
    Object.defineProperty(file, "text", { value: text });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

    expect(text).not.toHaveBeenCalled();
    expect(mockImportMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("2 MiB or smaller");
    expect(screen.queryByText("too-large.csv")).not.toBeInTheDocument();
  });

  it("rejects a non-CSV MIME type before reading it", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Intake & Generation" }));
    const file = new File(["csv"], "questions.csv", { type: "application/json" });
    const text = vi.fn();
    Object.defineProperty(file, "text", { value: text });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

    expect(text).not.toHaveBeenCalled();
    expect(mockImportMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("supported MIME type");
    expect(screen.queryByText("questions.csv")).not.toBeInTheDocument();
  });

  it("submits the latest file when an earlier File.text resolves last", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminContent />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Intake & Generation" }));
    let resolveA!: (value: string) => void;
    let resolveB!: (value: string) => void;
    const fileA = new File(["a"], "a.csv", { type: "text/csv" });
    const fileB = new File(["b"], "b.csv", { type: "text/csv" });
    Object.defineProperty(fileA, "text", { value: () => new Promise<string>((resolve) => { resolveA = resolve; }) });
    Object.defineProperty(fileB, "text", { value: () => new Promise<string>((resolve) => { resolveB = resolve; }) });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [fileA] } });
    fireEvent.change(fileInput, { target: { files: [fileB] } });
    resolveB("content-from-b");
    await waitFor(() => expect(screen.getByText(/b\.csv/)).toBeInTheDocument());
    resolveA("stale-content-from-a");
    await waitFor(() => expect(screen.getByRole("button", { name: "Import question changes" })).not.toBeDisabled());
    mockImportMutate.mockImplementationOnce((_request, options) => options.onSuccess({ importedCount: 1, createdCount: 1, updatedCount: 0, questionIds: ["q-b"] }));
    fireEvent.click(screen.getByRole("button", { name: "Import question changes" }));

    await waitFor(() => expect(mockImportMutate).toHaveBeenCalledWith(
      { data: { filename: "b.csv", csv: "content-from-b" } },
      expect.any(Object),
    ));
  });
});
