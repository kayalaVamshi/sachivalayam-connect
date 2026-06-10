import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, roleHome } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/")({ component: () => {
  const nav = useNavigate(); const { role } = useAuth();
  useEffect(() => { if (role) nav({ to: roleHome(role), replace: true }); }, [role, nav]);
  return <div className="text-muted-foreground">Redirecting…</div>;
}});
