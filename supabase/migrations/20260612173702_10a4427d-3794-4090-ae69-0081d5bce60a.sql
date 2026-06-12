
-- Service application status enum
CREATE TYPE public.service_app_status AS ENUM (
  'submitted','assigned','under_verification','documents_required','approved','rejected','completed'
);

CREATE TYPE public.service_app_type AS ENUM (
  'income_certificate','pension','ration_card','caste_certificate','residence_certificate','birth_certificate','death_certificate'
);

CREATE SEQUENCE IF NOT EXISTS public.service_app_id_seq START 1;

-- Main applications table
CREATE TABLE public.service_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_number TEXT UNIQUE,
  citizen_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_type public.service_app_type NOT NULL,
  citizen_name TEXT NOT NULL,
  aadhaar_number TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  village TEXT NOT NULL,
  mandal TEXT NOT NULL,
  district TEXT NOT NULL,
  status public.service_app_status NOT NULL DEFAULT 'submitted',
  assigned_officer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  department TEXT,
  last_remark TEXT,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_applications TO authenticated;
GRANT ALL ON public.service_applications TO service_role;
ALTER TABLE public.service_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Citizens manage own applications" ON public.service_applications
  FOR ALL TO authenticated
  USING (citizen_id = auth.uid())
  WITH CHECK (citizen_id = auth.uid());

CREATE POLICY "Officer sees assigned" ON public.service_applications
  FOR SELECT TO authenticated
  USING (assigned_officer_id = auth.uid());

CREATE POLICY "Officer updates assigned" ON public.service_applications
  FOR UPDATE TO authenticated
  USING (assigned_officer_id = auth.uid());

CREATE POLICY "Admin all applications" ON public.service_applications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority'));

-- Auto-generate application number
CREATE OR REPLACE FUNCTION public.gen_application_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.application_number IS NULL OR NEW.application_number = '' THEN
    NEW.application_number := 'APP' || LPAD(nextval('public.service_app_id_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER service_applications_gen_number
  BEFORE INSERT ON public.service_applications
  FOR EACH ROW EXECUTE FUNCTION public.gen_application_number();

CREATE TRIGGER service_applications_touch
  BEFORE UPDATE ON public.service_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Required / uploaded documents
CREATE TABLE public.service_app_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.service_applications(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | uploaded | verified | rejected
  notes TEXT,
  requested_by UUID REFERENCES auth.users(id),
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_app_documents TO authenticated;
GRANT ALL ON public.service_app_documents TO service_role;
ALTER TABLE public.service_app_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Docs: citizen own" ON public.service_app_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id AND a.citizen_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id AND a.citizen_id = auth.uid()));

CREATE POLICY "Docs: officer assigned" ON public.service_app_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id AND a.assigned_officer_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id AND a.assigned_officer_id = auth.uid()));

CREATE POLICY "Docs: admin/authority" ON public.service_app_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority'));

CREATE TRIGGER service_app_documents_touch
  BEFORE UPDATE ON public.service_app_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Timeline
CREATE TABLE public.service_app_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.service_applications(id) ON DELETE CASCADE,
  status public.service_app_status NOT NULL,
  remarks TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.service_app_timeline TO authenticated;
GRANT ALL ON public.service_app_timeline TO service_role;
ALTER TABLE public.service_app_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Timeline visible to participants" ON public.service_app_timeline FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id
            AND (a.citizen_id = auth.uid() OR a.assigned_officer_id = auth.uid()))
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority')
  );

CREATE POLICY "Timeline insert by participants" ON public.service_app_timeline FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.service_applications a WHERE a.id = application_id
            AND (a.citizen_id = auth.uid() OR a.assigned_officer_id = auth.uid()))
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'government_authority')
  );
