-- Removing a staff member or a seller team member marked them deleted and
-- left their refresh sessions open until they expired. Every guard and both
-- refresh paths re-read the user, so none of those sessions could be used,
-- but a removed person must hold no live session at all. Removal now revokes
-- them in the same transaction; this closes the ones left behind (on
-- 2026-09-15: one staff member and one seller team member, both test
-- accounts). Store users were already revoked at removal; included so the
-- statement is the whole rule.
UPDATE "staff_refresh_tokens" t
   SET "revoked_at" = now()
  FROM "staff_users" s
 WHERE t."staff_user_id" = s."id"
   AND s."deleted_at" IS NOT NULL
   AND t."revoked_at" IS NULL;

UPDATE "seller_refresh_tokens" t
   SET "revoked_at" = now()
  FROM "seller_users" u
 WHERE t."seller_user_id" = u."id"
   AND u."deleted_at" IS NOT NULL
   AND t."revoked_at" IS NULL;

UPDATE "store_refresh_tokens" t
   SET "revoked_at" = now()
  FROM "store_users" u
 WHERE t."store_user_id" = u."id"
   AND u."deleted_at" IS NOT NULL
   AND t."revoked_at" IS NULL;
