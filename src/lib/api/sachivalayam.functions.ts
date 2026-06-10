import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// --- Bootstrap status (public) ---
export const getBootstrapStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("system_state").select("bootstrap_completed").eq("id", 1).maybeSingle();
  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "government_authority");
  return { bootstrapCompleted: !!data?.bootstrap_completed, govAuthorityCount: count ?? 0 };
});

// --- Bootstrap first Government Authority ---
const bootstrapSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});
export const bootstrapGovAuthority = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => bootstrapSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "government_authority");
    if ((count ?? 0) > 0) throw new Error("Government Authority is already configured.");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, intended_role: "government_authority" },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");

    // Trigger created profile + role=government_authority (because intended_role meta)
    // Make sure role is set even if trigger inserted citizen.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "government_authority" });
    await supabaseAdmin.from("system_state").update({ bootstrap_completed: true }).eq("id", 1);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: created.user.id, actor_email: data.email,
      action: "BOOTSTRAP_GOV_AUTHORITY", entity_type: "user", entity_id: created.user.id,
    });
    return { ok: true };
  });

// --- Approve / reject admin (gov authority only) ---
const decisionSchema = z.object({
  registrationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  remarks: z.string().max(500).optional(),
});
export const decideAdminRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => decisionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isGov } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "government_authority",
    });
    if (!isGov) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reg, error: regErr } = await supabaseAdmin
      .from("admin_registrations").select("*").eq("id", data.registrationId).maybeSingle();
    if (regErr || !reg) throw new Error("Registration not found");

    await supabaseAdmin.from("admin_registrations").update({
      verification_status: data.decision,
      verification_remarks: data.remarks ?? null,
      verification_date: new Date().toISOString(),
      verified_by: context.userId,
    }).eq("id", data.registrationId);

    if (data.decision === "approved") {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: reg.user_id, role: "admin" }, { onConflict: "user_id,role" }
      );
      await supabaseAdmin.from("profiles").update({ active_status: true }).eq("id", reg.user_id);
    } else {
      await supabaseAdmin.from("profiles").update({ active_status: false }).eq("id", reg.user_id);
    }

    await supabaseAdmin.from("notifications").insert({
      user_id: reg.user_id,
      title: data.decision === "approved" ? "Admin registration approved" : "Admin registration rejected",
      body: data.remarks ?? null,
      link: "/auth",
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: `ADMIN_${data.decision.toUpperCase()}`,
      entity_type: "admin_registration", entity_id: data.registrationId, metadata: { remarks: data.remarks },
    });
    return { ok: true };
  });

// --- Toggle user active (gov authority only) ---
export const toggleUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isGov } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "government_authority",
    });
    if (!isGov) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("profiles").update({ active_status: data.active }).eq("id", data.userId);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: data.active ? "ENABLE_USER" : "DISABLE_USER",
      entity_type: "user", entity_id: data.userId,
    });
    return { ok: true };
  });

// --- Create officer (admin only) ---
const officerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  department: z.string().min(1).max(100),
  mobileNumber: z.string().max(20).optional(),
});
export const createOfficer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => officerSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
      user_metadata: { full_name: data.fullName, intended_role: "officer", mobile_number: data.mobileNumber },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create officer");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "officer" });
    await supabaseAdmin.from("profiles").update({ department: data.department }).eq("id", created.user.id);
    await supabaseAdmin.from("officers").insert({
      user_id: created.user.id, department: data.department, created_by: context.userId,
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: "OFFICER_CREATED",
      entity_type: "user", entity_id: created.user.id, metadata: { department: data.department },
    });
    return { ok: true };
  });

// --- Assign / update complaint ---
const assignSchema = z.object({
  complaintId: z.string().uuid(),
  officerId: z.string().uuid(),
  remarks: z.string().max(500).optional(),
});
export const assignComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => assignSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: officerProfile } = await supabaseAdmin.from("profiles").select("department").eq("id", data.officerId).maybeSingle();
    const { data: complaint } = await supabaseAdmin.from("complaints")
      .update({
        assigned_officer_id: data.officerId,
        department: officerProfile?.department ?? null,
        status: "assigned",
        last_remark: data.remarks ?? null,
      })
      .eq("id", data.complaintId).select().single();
    if (!complaint) throw new Error("Complaint not found");
    await supabaseAdmin.from("complaint_timeline").insert({
      complaint_id: data.complaintId, status: "assigned", remarks: data.remarks, updated_by: context.userId,
    });
    await supabaseAdmin.from("notifications").insert([
      { user_id: data.officerId, title: `New complaint assigned: ${complaint.complaint_number}`, link: `/complaints/${complaint.id}` },
      { user_id: complaint.citizen_id, title: `Your complaint ${complaint.complaint_number} has been assigned`, link: `/complaints/${complaint.id}` },
    ]);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: "COMPLAINT_ASSIGNED",
      entity_type: "complaint", entity_id: data.complaintId, metadata: { officer_id: data.officerId },
    });
    return { ok: true };
  });

const updateStatusSchema = z.object({
  complaintId: z.string().uuid(),
  status: z.enum(["under_review", "in_progress", "resolved", "rejected"]),
  remarks: z.string().max(1000).optional(),
});
const VALID_TRANSITIONS: Record<string, string[]> = {
  submitted: ["assigned"],
  assigned: ["under_review", "rejected"],
  under_review: ["in_progress", "rejected"],
  in_progress: ["resolved"],
  resolved: [],
  rejected: [],
};
export const updateComplaintStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateStatusSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: complaint } = await supabaseAdmin.from("complaints").select("*").eq("id", data.complaintId).maybeSingle();
    if (!complaint) throw new Error("Complaint not found");

    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const isAssigned = complaint.assigned_officer_id === context.userId;
    if (!isAdmin && !isAssigned) throw new Error("Forbidden");

    if (!VALID_TRANSITIONS[complaint.status]?.includes(data.status)) {
      throw new Error(`Invalid transition: ${complaint.status} → ${data.status}`);
    }

    await supabaseAdmin.from("complaints").update({
      status: data.status, last_remark: data.remarks ?? null,
    }).eq("id", data.complaintId);
    await supabaseAdmin.from("complaint_timeline").insert({
      complaint_id: data.complaintId, status: data.status, remarks: data.remarks, updated_by: context.userId,
    });
    await supabaseAdmin.from("notifications").insert({
      user_id: complaint.citizen_id,
      title: `Complaint ${complaint.complaint_number}: status changed to ${data.status.replace("_", " ")}`,
      link: `/complaints/${complaint.id}`,
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: "COMPLAINT_STATUS_CHANGED",
      entity_type: "complaint", entity_id: data.complaintId,
      metadata: { from: complaint.status, to: data.status, remarks: data.remarks },
    });
    return { ok: true };
  });

// --- Dev-only: seed demo accounts. Refuses to run if any non-dev marker is missing. ---
export const seedDemoAccounts = createServerFn({ method: "POST" }).handler(async () => {
  // Refuse if not preview/dev. We use the request URL host as a guardrail.
  const { getRequest } = await import("@tanstack/react-start/server");
  const req = getRequest();
  const host = req?.headers.get("host") ?? "";
  const isDev =
    host.includes("id-preview--") || host.includes("-dev.lovable.app") ||
    host.startsWith("localhost") || host.startsWith("127.");
  if (!isDev) throw new Error("Demo seed disabled in production.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const accounts: Array<{ email: string; password: string; role: "government_authority" | "admin" | "officer" | "citizen"; full_name: string; extra?: Record<string, unknown> }> = [
    { email: "authority@sachivalayam.gov", password: "Authority@123", role: "government_authority", full_name: "State IT Authority" },
    { email: "admin1@sachivalayam.gov", password: "Admin1@123", role: "admin", full_name: "Demo Admin",
      extra: { employee_id: "EMP-DEMO-001", district: "Krishna", mandal: "Vijayawada Urban", village_ward: "Ward 12", department: "Revenue" } },
    { email: "officer1@sachivalayam.gov", password: "Officer1@123", role: "officer", full_name: "Demo Officer", extra: { department: "Sanitation" } },
    { email: "citizen1@example.com", password: "Citizen1@123", role: "citizen", full_name: "Demo Citizen" },
  ];

  const results: Array<{ email: string; created: boolean }> = [];
  for (const a of accounts) {
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = existing?.users.find((u) => u.email === a.email);
    let userId = found?.id;
    if (!userId) {
      const { data: c, error } = await supabaseAdmin.auth.admin.createUser({
        email: a.email, password: a.password, email_confirm: true,
        user_metadata: { full_name: a.full_name, intended_role: a.role },
      });
      if (error || !c.user) { results.push({ email: a.email, created: false }); continue; }
      userId = c.user.id;
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: a.role });
    if (a.role === "admin") {
      const ex = a.extra as { employee_id: string; district: string; mandal: string; village_ward: string; department: string };
      await supabaseAdmin.from("admin_registrations").upsert({
        user_id: userId,
        employee_id: ex.employee_id, district: ex.district, mandal: ex.mandal,
        village_ward: ex.village_ward, department: ex.department,
        verification_status: "approved", verification_date: new Date().toISOString(),
      }, { onConflict: "user_id" });
      await supabaseAdmin.from("profiles").update({ department: ex.department, active_status: true }).eq("id", userId);
    }
    if (a.role === "officer") {
      const ex = a.extra as { department: string };
      await supabaseAdmin.from("officers").upsert({ user_id: userId, department: ex.department }, { onConflict: "user_id" });
      await supabaseAdmin.from("profiles").update({ department: ex.department }).eq("id", userId);
    }
    if (a.role === "government_authority") {
      await supabaseAdmin.from("system_state").update({ bootstrap_completed: true }).eq("id", 1);
    }
    results.push({ email: a.email, created: true });
  }
  return { ok: true, results };
});
