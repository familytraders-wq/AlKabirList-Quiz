import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminTaxonomies } from "./AdminTaxonomies";

const { mockCreate, mockUpdate, mockReorder, mockToast } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockReorder: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const categories = [
    { id: "11111111-1111-4111-8111-111111111111", kind: "category", slug: "seerah", label: "Seerah", sortOrder: 10, isActive: true },
    { id: "22222222-2222-4222-8222-222222222222", kind: "category", slug: "quran", label: "Qur'an", sortOrder: 20, isActive: false },
  ];
  const difficulties = [
    { id: "33333333-3333-4333-8333-333333333333", kind: "difficulty", slug: "easy", label: "Easy", sortOrder: 10, isActive: true },
  ];
  return {
    ...actual,
    useGetAuthMe: () => ({
      data: {
        authenticated: true,
        user: { roles: ["admin"], isSuperAdmin: false, permissions: ["content.view", "content.manage"] },
      },
      isLoading: false,
    }),
    useListAdminTaxonomies: ({ kind }: { kind: "category" | "difficulty" }) => ({
      data: { items: kind === "category" ? categories : difficulties },
      isLoading: false,
      isError: false,
      error: null,
    }),
    useCreateAdminTaxonomy: () => ({ mutate: mockCreate, isPending: false }),
    useUpdateAdminTaxonomy: () => ({ mutate: mockUpdate, isPending: false }),
    useReorderAdminTaxonomies: () => ({ mutate: mockReorder, isPending: false }),
  };
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminTaxonomies />
    </QueryClientProvider>,
  );
}

describe("AdminTaxonomies", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("adds and reorders categories", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Taxonomy Settings" })).toBeInTheDocument();
    expect(screen.getByText("Seerah")).toBeInTheDocument();
    expect(screen.getByText("Qur'an")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-move-down-11111111-1111-4111-8111-111111111111"));
    expect(mockReorder).toHaveBeenCalledWith(
      {
        data: {
          kind: "category",
          taxonomyIds: [
            "22222222-2222-4222-8222-222222222222",
            "11111111-1111-4111-8111-111111111111",
          ],
        },
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("button-add-category"));
    fireEvent.change(screen.getByTestId("input-new-category-label"), { target: { value: "Islamic History" } });
    expect(screen.getByTestId("input-new-category-slug")).toHaveValue("islamic-history");
    fireEvent.click(screen.getByTestId("button-save-new-category"));
    expect(mockCreate).toHaveBeenCalledWith(
      { data: { kind: "category", label: "Islamic History", slug: "islamic-history" } },
      expect.any(Object),
    );
  });

  it("edits and deactivates a category, then displays difficulties", () => {
    renderPage();

    mockUpdate.mockImplementationOnce((_variables, options) => {
      options.onSuccess();
      options.onSettled();
    });
    fireEvent.click(screen.getByTestId("button-edit-taxonomy-11111111-1111-4111-8111-111111111111"));
    fireEvent.change(screen.getByTestId("input-taxonomy-label-11111111-1111-4111-8111-111111111111"), {
      target: { value: "Prophetic Biography" },
    });
    fireEvent.click(screen.getByTestId("button-save-taxonomy-11111111-1111-4111-8111-111111111111"));
    expect(mockUpdate).toHaveBeenCalledWith(
      {
        taxonomyId: "11111111-1111-4111-8111-111111111111",
        data: { label: "Prophetic Biography", slug: "seerah", isActive: true },
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("button-toggle-taxonomy-11111111-1111-4111-8111-111111111111"));
    expect(mockUpdate).toHaveBeenLastCalledWith(
      {
        taxonomyId: "11111111-1111-4111-8111-111111111111",
        data: { label: "Seerah", slug: "seerah", isActive: false },
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("button-taxonomy-difficulties"));
    expect(screen.getByRole("heading", { name: "Difficulties" })).toBeInTheDocument();
    expect(screen.queryByText("Difficultys")).not.toBeInTheDocument();
    expect(screen.getByText("Easy")).toBeInTheDocument();
  });
});