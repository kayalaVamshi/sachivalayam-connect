
CREATE POLICY "authenticated upload own folder" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'complaint-photos' AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "owner reads own complaint photo" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'complaint-photos' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'officer')
    OR public.has_role(auth.uid(),'government_authority')
  )
);
