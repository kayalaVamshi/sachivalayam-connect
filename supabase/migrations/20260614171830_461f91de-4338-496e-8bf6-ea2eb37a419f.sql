
-- 1) Harden new-user trigger: never auto-promote to admin/officer/government_authority via signup metadata.
--    The only role granted on signup is 'citizen'. Privileged roles are granted server-side after verification.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_intended text;
  v_active boolean := true;
BEGIN
  v_intended := COALESCE(NEW.raw_user_meta_data->>'intended_role', 'citizen');

  -- Admins must be approved by Government Authority before becoming active.
  IF v_intended = 'admin' THEN
    v_active := false;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, mobile_number, active_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'mobile_number',
    v_active
  ) ON CONFLICT (id) DO NOTHING;

  -- Always assign 'citizen' on signup. Real role is granted later by:
  --   - Government Authority approval (admin)
  --   - Admin creating officer (officer)
  --   - Bootstrap/seed (government_authority)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'citizen')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2) Backfill: demote orphan admins (admin role with no admin_registrations row) to citizen + inactive.
WITH orphans AS (
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_registrations ar
      WHERE ar.user_id = ur.user_id
    )
)
DELETE FROM public.user_roles
WHERE role = 'admin' AND user_id IN (SELECT user_id FROM orphans);

INSERT INTO public.user_roles (user_id, role)
SELECT ur.user_id, 'citizen'
FROM public.profiles p
JOIN (
  SELECT id AS user_id FROM public.profiles
) ur ON ur.user_id = p.id
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = p.id)
ON CONFLICT DO NOTHING;

-- 3) Backfill: any admin whose registration is not approved should be inactive.
UPDATE public.profiles p
SET active_status = false
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin'
)
AND NOT EXISTS (
  SELECT 1 FROM public.admin_registrations ar
  WHERE ar.user_id = p.id AND ar.verification_status = 'approved'
);
