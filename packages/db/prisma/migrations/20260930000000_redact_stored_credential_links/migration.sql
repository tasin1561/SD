-- Redact the live `?token=` links still sitting in notification_logs.
--
-- `redactTokens` (apps/api/src/modules/email/redact-tokens.ts) has scrubbed
-- the STORED copy of every message since 2026-09-27, so nothing new lands
-- with a credential in it. This is the residue written before that: a
-- password-reset, email-verification or invitation link whose plaintext
-- token appears nowhere else by design (the token tables hold only its
-- SHA-256) and which `notification_logs` — a table with no expiry — kept
-- verbatim, in the body, in the HTML body, and again in the `variables`
-- map that holds the same URL in its own right.
--
-- Measured on production, 2026-09-30: 892 rows, of which 30 carry a live
-- link (29 in `body`, 29 in `html_body`, 30 in `variables`, union 30) —
-- staff/seller/store invitations, password resets and email verifications,
-- 29 Jul to 20 Sep. Every one of those tokens is already expired or used
-- (0 unused, unexpired invitations remain), so this closes blast radius
-- rather than an open door: the bodies are in every hourly off-site backup
-- and would be in any future dump or notification-log viewer.
--
-- The ROW is kept, exactly as the courier-webhook redaction kept its row.
-- Only the credential is replaced, with the same '[redacted]' marker the
-- application writes, so a row redacted at write time and a row redacted
-- here are indistinguishable — which is right; both mean "a live link was
-- here".
--
-- The pattern is `redact-tokens.ts`'s TOKEN_IN_URL transcribed to
-- PostgreSQL ARE, and it must stay that way:
--   * anchored on `token=` preceded by `?`, `&` or `;`, so a sentence
--     containing the word is left alone;
--   * the value runs to the first character that cannot be inside one —
--     `&`, a quote or angle bracket, whitespace, `)` or `]` — which is what
--     stops it swallowing the HTML around an href;
--   * the negative lookahead on the placeholder is what makes it
--     IDEMPOTENT. `[redacted]` ends in `]`, which the value class excludes,
--     so without it a second pass would match `[redacted` and append
--     another bracket. A re-run of this migration therefore matches
--     nothing, and the WHERE clauses below mean it touches nothing.
-- Both halves were smoke-tested against the production database before
-- this was written.

UPDATE "notification_logs"
SET "body" = regexp_replace("body", '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi')
WHERE "body" IS NOT NULL
  AND "body" <> regexp_replace("body", '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi');

UPDATE "notification_logs"
SET "html_body" = regexp_replace("html_body", '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi')
WHERE "html_body" IS NOT NULL
  AND "html_body" <> regexp_replace("html_body", '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi');

-- `variables` is a flat map of scalars (the `EmailVariables` type), so one
-- shallow pass over its string values is the whole surface — the same
-- shape `redactTokensInVariables` takes.
--
-- Rebuilt with jsonb_object_agg over jsonb_each rather than a cast through
-- text: `variables::text::jsonb` would round-trip the whole document
-- through the regex, which would rewrite a token inside a KEY, mangle any
-- value that happens to contain the pattern's boundary characters, and
-- corrupt the row outright if the replacement ever produced something that
-- is not valid JSON. Non-object documents are excluded by the guard (all
-- 892 production rows are objects), and the EXISTS guard also means an
-- empty map is never rebuilt — jsonb_object_agg over no rows returns NULL.
UPDATE "notification_logs" AS l
SET "variables" = (
  SELECT jsonb_object_agg(
           kv.key,
           CASE
             WHEN jsonb_typeof(kv.value) = 'string'
               THEN to_jsonb(regexp_replace(kv.value #>> '{}', '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi'))
             ELSE kv.value
           END
         )
  FROM jsonb_each(l."variables") AS kv
)
WHERE l."variables" IS NOT NULL
  AND jsonb_typeof(l."variables") = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(l."variables") AS kv
    WHERE jsonb_typeof(kv.value) = 'string'
      AND (kv.value #>> '{}') <> regexp_replace(kv.value #>> '{}', '([?&;]token=)(?!\[redacted\])[^]&"''<>)[:space:]]+', '\1[redacted]', 'gi')
  );
