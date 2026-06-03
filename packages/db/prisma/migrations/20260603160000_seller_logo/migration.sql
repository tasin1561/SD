-- Phase 1B — seller logo / company branding.
--
-- One logo per seller (the common UX). Stored in DigitalOcean
-- Spaces under sellers/<sellerId>/logo.<ext>; URL is the CDN URL
-- for public display.
--
-- All three columns nullable — logo is optional.

ALTER TABLE "sellers"
  ADD COLUMN "logo_storage_key" TEXT,
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "logo_mime_type" TEXT;
