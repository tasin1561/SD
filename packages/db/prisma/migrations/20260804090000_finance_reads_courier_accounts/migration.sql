-- Finance needs to SEE courier accounts to settle against one.
--
-- `money.settlements.record` was granted to the seeded Finance role;
-- `courier.accounts.view` was not. But a settlement is recorded AGAINST
-- a courier account — the form cannot offer a choice the person is not
-- allowed to read, so the permission it already has was unusable on its
-- own. Found by walking every admin page's queries against the
-- permission each endpoint declares, rather than by somebody hitting it.
--
-- Idempotent: the unique on (role, permission, scope) makes a re-run a
-- no-op, and a hand-edited Finance role that already has it is untouched.
INSERT INTO "staff_role_permissions" ("role_id", "permission")
SELECT r."id", 'courier.accounts.view'
FROM "staff_roles" r
WHERE r."key" = 'finance'
ON CONFLICT DO NOTHING;
