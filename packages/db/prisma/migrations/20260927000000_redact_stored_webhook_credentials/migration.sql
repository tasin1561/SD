-- Clear courier credentials that were persisted into courier_webhooks.headers.
--
-- `redactAuthHeaders` only ever blanked `x-skydrop-signature`. The scan and
-- document controllers ALSO read `x-api-key` as the authenticating
-- credential (Shiprocket's scheme is SHARED_SECRET, so that header's value
-- IS the secret), and it was stored verbatim on every push -- and therefore
-- in every backup. `authorization` and `cookie` are blanked for the same
-- reason even though no courier has sent one: if one is there, it is a
-- secret.
--
-- The ROW is kept. It is the raw ledger TRK-1/TRK-2 dedup and every
-- forensic question are read from; only the credential is replaced, with
-- the same '[redacted]' marker the code writes, so a redacted-at-ingest row
-- and a redacted-by-this-migration row are indistinguishable -- which is
-- correct, both mean "a credential was here".
--
-- Idempotent: a re-run matches nothing because every such key is already
-- '[redacted]'.
UPDATE "courier_webhooks" AS w
SET "headers" = (
  SELECT jsonb_object_agg(
           kv.key,
           CASE
             WHEN lower(kv.key) IN ('x-skydrop-signature', 'x-api-key', 'authorization', 'cookie')
               THEN '"[redacted]"'::jsonb
             ELSE kv.value
           END
         )
  FROM jsonb_each(w."headers") AS kv
)
WHERE jsonb_typeof(w."headers") = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(w."headers") AS kv
    WHERE lower(kv.key) IN ('x-skydrop-signature', 'x-api-key', 'authorization', 'cookie')
      AND kv.value <> '"[redacted]"'::jsonb
  );
