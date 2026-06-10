import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/AppShell";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/citizen/")({ component: CitizenDashboard });

interface Complaint {
  id: string; complaint_number: string; title: string; category: string;
  status: string; created_at: string; department: string | null;
}

function CitizenDashboard() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("complaints").select("id,complaint_number,title,category,status,created_at,department")
      .eq("citizen_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => setComplaints((data as Complaint[]) ?? []));
  }, [user]);

  const filtered = complaints.filter((c) =>
    (filter === "" || c.status === filter) &&
    (search === "" || c.complaint_number.toLowerCase().includes(search.toLowerCase()) || c.title.toLowerCase().includes(search.toLowerCase()))
  );

  const stats = {
    total: complaints.length,
    open: complaints.filter((c) => !["resolved", "rejected"].includes(c.status)).length,
    resolved: complaints.filter((c) => c.status === "resolved").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Grievances</h1>
          <p className="text-sm text-muted-foreground">Submit and track your complaints.</p>
        </div>
        <Link to="/citizen/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" />New Complaint
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ["Total complaints", stats.total],
          ["Open", stats.open],
          ["Resolved", stats.resolved],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border bg-card p-5">
            <div className="text-sm text-muted-foreground">{label as string}</div>
            <div className="mt-1 text-3xl font-bold">{value as number}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <input placeholder="Search by ID or title…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-xs rounded-md border bg-background px-3 py-1.5 text-sm" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border bg-background px-3 py-1.5 text-sm">
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="assigned">Assigned</option>
            <option value="under_review">Under review</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">Complaint ID</th><th className="p-3">Title</th><th className="p-3">Category</th><th className="p-3">Status</th><th className="p-3">Submitted</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No complaints yet. Submit your first complaint to get started.</td></tr>}
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-mono font-semibold">{c.complaint_number}</td>
                  <td className="p-3">{c.title}</td>
                  <td className="p-3 capitalize">{c.category.replace(/_/g, " ")}</td>
                  <td className="p-3"><StatusBadge status={c.status} /></td>
                  <td className="p-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="p-3"><Link to="/complaints/$id" params={{ id: c.id }} className="text-primary font-medium hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
