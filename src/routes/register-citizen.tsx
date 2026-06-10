import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/register-citizen")({ component: RegisterCitizen });

const schema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email(),
  mobile_number: z.string().min(5).max(20),
  address: z.string().max(300).optional(),
  village: z.string().max(120).optional(),
  password: z.string().min(8).max(72),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords don't match" });

function RegisterCitizen() {
  const nav = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", mobile_number: "", address: "", village: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`,
          data: { full_name: form.full_name, mobile_number: form.mobile_number, intended_role: "citizen" },
        },
      });
      if (error) throw error;
      if (data.user) {
        await supabase.from("profiles").update({
          full_name: form.full_name, mobile_number: form.mobile_number, address: form.address, village: form.village,
        }).eq("id", data.user.id);
      }
      toast.success("Account created. You can sign in now.");
      nav({ to: "/auth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">Citizen Registration</h1>
        <p className="mb-5 text-sm text-muted-foreground">Create your account to submit and track grievances.</p>
        <form onSubmit={submit} className="space-y-3">
          {[
            ["full_name", "Full Name", "text", true],
            ["email", "Email", "email", true],
            ["mobile_number", "Mobile Number", "tel", true],
            ["village", "Village / Ward", "text", false],
            ["address", "Address", "text", false],
            ["password", "Password", "password", true],
            ["confirm", "Confirm Password", "password", true],
          ].map(([k, label, type, req]) => (
            <div key={k as string}>
              <label className="block text-sm font-medium">{label as string}{req ? " *" : ""}</label>
              <input required={req as boolean} type={type as string} value={form[k as keyof typeof form]} onChange={update(k as keyof typeof form)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
          ))}
          <button disabled={busy} className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-sm text-center"><Link to="/auth" className="text-primary hover:underline">Back to login</Link></p>
      </div>
    </div>
  );
}
