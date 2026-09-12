import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Search, Menu } from "lucide-react";
import { useAuth } from "@clerk/react";
import { LogoutButton } from "@/components/auth/LogoutButton";

export function Navbar() {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReviewer, setIsReviewer] = useState(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsAdmin(false);
      setIsReviewer(false);
      return;
    }
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((state: { user?: { roles: string[] } | null }) => {
        setIsAdmin(state.user?.roles.includes("admin") ?? false);
        setIsReviewer(state.user?.roles.includes("reviewer") ?? false);
      })
      .catch(() => {
        setIsAdmin(false);
        setIsReviewer(false);
      });
  }, [isLoaded, isSignedIn]);

  const handleScroll = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    if (location !== "/") return;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className="w-full bg-white/80 backdrop-blur-md border-b border-border/40 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2" data-testid="link-home">
          <div className="w-8 h-8 flex items-center justify-center text-primary relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full">
              <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" />
              <path d="M12 5.5L13.5 9.5L17.5 11L13.5 12.5L12 16.5L10.5 12.5L6.5 11L10.5 9.5L12 5.5Z" className="opacity-50" />
            </svg>
          </div>
          <span className="font-serif font-semibold text-xl tracking-tight text-foreground">
            AlKabirList
          </span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a 
            href="#community" 
            onClick={(e) => handleScroll(e, 'community')}
            className="text-muted-foreground hover:text-primary transition-colors"
            data-testid="link-nav-community"
          >
            Community
          </a>
          <Link href={isLoaded && isSignedIn ? "/member" : "/"} className="text-primary border-b-2 border-primary py-5">
            Islamic Challenge
          </Link>
          {(isReviewer || isAdmin) && <Link href="/admin/content" className="text-muted-foreground hover:text-primary transition-colors">Content</Link>}
          {(isReviewer || isAdmin) && <Link href="/admin/schedule" className="text-muted-foreground hover:text-primary transition-colors">Schedule</Link>}
          {(isReviewer || isAdmin) && <Link href="/admin/beta" className="text-muted-foreground hover:text-primary transition-colors">Beta</Link>}
          {isAdmin && <Link href="/admin/users" className="text-muted-foreground hover:text-primary transition-colors">Access</Link>}
          <a 
            href="#about" 
            onClick={(e) => handleScroll(e, 'about')}
            className="text-muted-foreground hover:text-primary transition-colors"
            data-testid="link-nav-about"
          >
            About
          </a>
          {isLoaded && isSignedIn && (
            <>
              <Link href="/feedback" className="text-muted-foreground hover:text-primary transition-colors">
                Feedback
              </Link>
              <Link href="/profile" className="text-muted-foreground hover:text-primary transition-colors">
                Profile
              </Link>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button className="text-foreground hover:text-primary transition-colors p-2" aria-label="Search">
            <Search className="w-5 h-5" />
          </button>
          
          {isLoaded && isSignedIn ? (
            <LogoutButton />
          ) : (
            <Link
              href="/sign-in"
              className="hidden md:inline-flex h-9 px-4 items-center justify-center rounded-full border border-border bg-white text-sm font-medium hover:bg-muted transition-colors"
              data-testid="button-signin-trigger"
            >
              Sign in
            </Link>
          )}

          <button className="md:hidden text-foreground p-2" aria-label="Menu">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
