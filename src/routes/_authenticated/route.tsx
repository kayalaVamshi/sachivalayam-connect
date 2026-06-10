import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const nav = useNavigate();
  const { user, role, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [loading, user, nav]);
  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (!user) return null;
  if (!role) return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="font-bold text-xl">Account pending</h2>
        <p className="text-muted-foreground mt-2">Your account doesn't have an assigned role yet. Please contact the authority.</p>
      </div>
    </div>
  );
  return <AppShell><Outlet /></AppShell>;
}
