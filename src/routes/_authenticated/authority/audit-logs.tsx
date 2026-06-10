import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/authority/audit-logs")({ component: AuditLogs });

interface Row { id: string; actor_email: string | null; action: string; entity_type: string | null; entity_id: string | null; metadata: unknown; created_at: string }

function AuditLogs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  useEffect(() => {
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  const filtered = rows.filter((r) => search === "" || r.action.toLowerCase().includes(search.toLowerCase()) || r.actor_email?.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Logs</h1>
      <div className="rounded-lg border bg-card">
        <div className="border-b p-4"><input placeholder="Filter by action or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-md rounded-md border bg-background px-3 py-1.5 text-sm" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3">Metadata</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No log entries.</td></tr>}
              {filtered.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-3">{r.actor_email ?? "system"}</td>
                  <td className="p-3 font-mono text-xs">{r.action}</td>
                  <td className="p-3 text-xs">{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0,8)}…` : ""}</td>
                  <td className="p-3 text-xs text-muted-foreground"><code>{r.metadata ? JSON.stringify(r.metadata) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
