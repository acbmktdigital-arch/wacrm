-- ============================================================
-- 038_contact_note_files.sql
--
-- Lets a contact note carry a file attachment (PDF, spreadsheet,
-- text, image, etc.) so the "attendance memory" of a lead/customer
-- can hold documents — not just text.
--
-- Two parts:
--   1. Attachment columns on `contact_notes` (all nullable) + relax
--      `note_text` so a note can be file-only.
--   2. A PRIVATE `contact-files` Storage bucket with account-scoped
--      RLS (same `account-<account_id>/...` path convention as
--      flow-media/chat-media, migrations 020/023). Private because
--      these are internal client documents — downloads go through
--      short-lived signed URLs, never public links.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Attachment columns on contact_notes
-- ============================================================
ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- A note may now be text-only, file-only, or both.
ALTER TABLE contact_notes ALTER COLUMN note_text DROP NOT NULL;

-- ============================================================
-- 2. contact-files storage bucket (PRIVATE)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-files',
  'contact-files',
  FALSE, -- private: internal client documents, served via signed URLs
  16777216, -- 16 MB
  ARRAY[
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    -- Images
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    -- Archives
    'application/zip', 'application/x-zip-compressed',
    -- Fallback for browsers that label uploads generically (e.g. some
    -- .csv/.xlsx). Keeps a non-technical user from hitting a confusing
    -- "type not allowed" on an ordinary spreadsheet.
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. Account-scoped RLS on storage.objects for contact-files
--    Mirrors the flow-media policies (migration 020): a member may
--    read/write objects under their own `account-<account_id>/` folder.
--    Private bucket → an explicit SELECT policy is required so
--    createSignedUrl works for account members.
-- ============================================================
DROP POLICY IF EXISTS "Members can read contact files" ON storage.objects;
CREATE POLICY "Members can read contact files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contact-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload contact files" ON storage.objects;
CREATE POLICY "Members can upload contact files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contact-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete contact files" ON storage.objects;
CREATE POLICY "Members can delete contact files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contact-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
