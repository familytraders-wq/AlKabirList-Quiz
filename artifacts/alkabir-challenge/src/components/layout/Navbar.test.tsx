import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "./Navbar";

let currentLocation = "/admin/content";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => [currentLocation, vi.fn()],
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("@/components/auth/LogoutButton", () => ({
  LogoutButton: () => null,
}));

afterEach(() => cleanup());

describe("Navbar", () => {
  it("shows a back link on secondary routes", () => {
    currentLocation = "/admin/content";
    render(<Navbar />);

    expect(screen.getByRole("link", { name: "Back to challenge" }))
      .toHaveAttribute("href", "/member");
  });

  it("does not show a redundant back link on the challenge home", () => {
    currentLocation = "/member";
    render(<Navbar />);

    expect(screen.queryByRole("link", { name: "Back to challenge" }))
      .not.toBeInTheDocument();
  });
});