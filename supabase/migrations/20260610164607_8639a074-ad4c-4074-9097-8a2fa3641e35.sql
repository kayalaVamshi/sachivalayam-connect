
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('government_authority','admin','officer','citizen');
CREATE TYPE public.admin_verification_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.complaint_status AS ENUM ('submitted','assigned','under_review','in_progress','resolved','rejected');
CREATE TYPE public.complaint_category AS ENUM ('water_supply','drainage','roads','street_lights','sanitation','certificates','pensions','others');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile_number TEXT,
  address TEXT,
  village TEXT,
  department TEXT,
  active_status BOOLEAN NOT NULL DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'government_authority' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'officer' THEN 3
    WHEN 'citizen' THEN 4 END
  LIMIT 1;
$$;

-- Profiles policies
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "gov authority reads all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'government_authority'));
CREATE POLICY "admin reads profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "officer reads profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'officer'));

-- user_roles policies
CREATE POLICY "user reads own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "gov authority reads all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'government_authority'));

-- ============ ADMIN REGISTRATIONS ============
CREATE TABLE public.admin_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL UNIQUE,
  district TEXT NOT NULL,
  mandal TEXT NOT NULL,
  village_ward TEXT NOT NULL,
  department TEXT NOT NULL,
  verification_status public.admin_verification_status NOT NULL DEFAULT 'pending',
  verification_remarks TEXT,
  verification_date TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.admin_registrations TO authenticated;
GRANT ALL ON public.admin_registrations TO service_role;
ALTER TABLE public.admin_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own admin reg" ON public.admin_registrations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "gov authority reads all admin regs" ON public.admin_registrations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'government_authority'));
CREATE POLICY "user inserts own admin reg" ON public.admin_registrations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ============ OFFICERS (extra metadata) ============
CREATE TABLE public.officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.officers TO authenticated;
GRANT ALL ON public.officers TO service_role;
ALTER TABLE public.officers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read officers" ON public.officers FOR SELECT TO authenticated USING (true);

-- ============ COMPLAINTS ============
CREATE SEQUENCE public.complaint_id_seq START 1;

CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_number TEXT NOT NULL UNIQUE,
  citizen_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category public.complaint_category NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  photo_url TEXT,
  status public.complaint_status NOT NULL DEFAULT 'submitted',
  assigned_officer_id UUID REFERENCES auth.users(id),
  department TEXT,
  last_remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "citizen reads own complaints" ON public.complaints FOR SELECT TO authenticated USING (auth.uid() = citizen_id);
CREATE POLICY "officer reads assigned complaints" ON public.complaints FOR SELECT TO authenticated USING (auth.uid() = assigned_officer_id);
CREATE POLICY "admin reads all complaints" ON public.complaints FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "gov authority reads all complaints" ON public.complaints FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'government_authority'));
CREATE POLICY "citizen inserts own complaint" ON public.complaints FOR INSERT TO authenticated WITH CHECK (auth.uid() = citizen_id AND public.has_role(auth.uid(),'citizen'));
CREATE POLICY "officer updates assigned" ON public.complaints FOR UPDATE TO authenticated USING (auth.uid() = assigned_officer_id);
CREATE POLICY "admin updates complaints" ON public.complaints FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- complaint number generator
CREATE OR REPLACE FUNCTION public.gen_complaint_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.complaint_number IS NULL OR NEW.complaint_number = '' THEN
    NEW.complaint_number := 'CMP' || LPAD(nextval('public.complaint_id_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_gen_complaint_number BEFORE INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.gen_complaint_number();

-- ============ COMPLAINT TIMELINE ============
CREATE TABLE public.complaint_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status public.complaint_status NOT NULL,
  remarks TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.complaint_timeline TO authenticated;
GRANT ALL ON public.complaint_timeline TO service_role;
ALTER TABLE public.complaint_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timeline visible to participants" ON public.complaint_timeline FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_id AND (
    c.citizen_id = auth.uid() OR c.assigned_officer_id = auth.uid()
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority')
  ))
);
CREATE POLICY "timeline inserts" ON public.complaint_timeline FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_id AND (
    c.assigned_officer_id = auth.uid() OR public.has_role(auth.uid(),'admin')
  ))
);

-- ============ NOTIFICATIONS ============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user updates own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gov authority reads audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'government_authority'));

-- ============ AUTO PROFILE + DEFAULT ROLE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, mobile_number)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'mobile_number'
  ) ON CONFLICT (id) DO NOTHING;

  v_role := COALESCE((NEW.raw_user_meta_data->>'intended_role')::public.app_role, 'citizen');
  -- For admin self-registration we still insert the role; gating happens via admin_registrations.verification_status
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ BOOTSTRAP STATE TABLE ============
CREATE TABLE public.system_state (
  id INT PRIMARY KEY DEFAULT 1,
  bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT only_one_row CHECK (id = 1)
);
INSERT INTO public.system_state (id, bootstrap_completed) VALUES (1, FALSE);
GRANT SELECT ON public.system_state TO anon, authenticated;
GRANT ALL ON public.system_state TO service_role;
ALTER TABLE public.system_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads system state" ON public.system_state FOR SELECT TO anon, authenticated USING (true);

-- updated_at trigger reuse
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_complaints_updated BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
