import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfileForm } from "./ProfileForm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock the API client
const mockMutate = vi.fn();
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useUpdateMyProfile: () => ({
      mutate: mockMutate,
      isPending: false,
    }),
    getGetMyProfileQueryKey: () => ["mockProfileKey"],
    getGetAuthMeQueryKey: () => ["mockAuthMeKey"],
  };
});

// Mock wouter location
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useLocation: () => ["/", vi.fn()],
  };
});

describe("ProfileForm", () => {
  const queryClient = new QueryClient();

  const renderForm = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ProfileForm {...props} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("requires consent during onboarding", async () => {
    renderForm({ isOnboarding: true });

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "John" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Doe" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "London" } });
    
    // Select GB (not US, so state is not required)
    const countrySelect = screen.getByTestId("select-country");
    fireEvent.click(countrySelect);
    const gbOptions = await screen.findAllByText("United Kingdom");
    fireEvent.click(gbOptions[gbOptions.length - 1]);

    // Try to submit without consent
    const submitBtn = screen.getByTestId("button-save-profile");
    fireEvent.click(submitBtn);

    // Should show error for consent
    await waitFor(() => {
      expect(screen.getByText("Consent is required to continue")).toBeInTheDocument();
    });
    
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows state input for US and requires it", async () => {
    renderForm({ isOnboarding: false });

    // Select US
    const countrySelect = screen.getByTestId("select-country");
    fireEvent.click(countrySelect);
    const usOptions = await screen.findAllByText("United States");
    fireEvent.click(usOptions[usOptions.length - 1]);

    // Verify State field appeared
    const stateInput = await screen.findByLabelText(/state/i);
    expect(stateInput).toBeInTheDocument();

    // Submit form (missing state)
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "John" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Doe" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "New York" } });
    
    const submitBtn = screen.getByTestId("button-save-profile");
    fireEvent.click(submitBtn);

    // Error about state should appear
    await waitFor(() => {
      expect(screen.getByText("State is required for US")).toBeInTheDocument();
    });
    
    expect(mockMutate).not.toHaveBeenCalled();
    
    // Fill state
    fireEvent.change(stateInput, { target: { value: "NY" } });
    fireEvent.click(submitBtn);
    
    // Now it should pass
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  it("submits successful profile update payload", async () => {
    renderForm({ isOnboarding: false });

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "Toronto" } });
    
    // Select CA
    const countrySelect = screen.getByTestId("select-country");
    fireEvent.click(countrySelect);
    const caOptions = await screen.findAllByText("Canada");
    fireEvent.click(caOptions[caOptions.length - 1]);

    fireEvent.click(screen.getByTestId("checkbox-consent"));

    const submitBtn = screen.getByTestId("button-save-profile");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: "Jane",
          lastName: "Smith",
          city: "Toronto",
          country: "CA",
          state: null,
          announcementConsent: true,
        })
      });
    });
  });

  it("allows selecting Other and typing a custom country code", async () => {
    renderForm({ isOnboarding: true });

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "John" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Doe" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "Paris" } });
    
    // Select OTHER
    const countrySelect = screen.getByTestId("select-country");
    fireEvent.click(countrySelect);
    const otherOptions = await screen.findAllByText("Other");
    fireEvent.click(otherOptions[otherOptions.length - 1]);

    // Custom input appears
    const customCountryInput = await screen.findByTestId("input-country-code");
    expect(customCountryInput).toBeInTheDocument();

    fireEvent.change(customCountryInput, { target: { value: "fr" } }); // lowercase to test normalization

    // Ensure it stays mounted and allows submission
    expect(screen.getByTestId("input-country-code")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("checkbox-consent"));

    const submitBtn = screen.getByTestId("button-save-profile");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: "John",
          lastName: "Doe",
          city: "Paris",
          country: "FR", // should be uppercase
          state: null,
          announcementConsent: true,
        })
      });
    });
  });
});
