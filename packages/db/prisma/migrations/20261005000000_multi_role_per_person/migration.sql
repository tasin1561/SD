-- A person may hold SEVERAL roles.
--
-- Skydrop's staff roles are JOB FUNCTIONS (Call agent, Warehouse staff,
-- Finance) and they stay that way: they encode distinctions a tier
-- ladder cannot — picking versus supervising, who may collapse a
-- warehouse's bins. The access TIERS are a second axis. Somebody who
-- takes calls and also handles tickets should hold both rather than
-- have a bespoke role invented for them, so the relationship is
-- many-to-many and a single `role_id` column cannot say it. The same
-- argument holds for a seller's team and a reseller store's.
--
-- ── PURELY ADDITIVE, AND THAT IS NOT TIDINESS ───────────────────────
-- `scripts/deploy.sh` runs `prisma migrate deploy` and builds the apps
-- AFTERWARDS, so for a few minutes the OLD code runs against the NEW
-- schema. `*_users.role_id` is NOT NULL and the old guards read it, so
-- nothing here drops or alters it. The join tables are created and
-- BACKFILLED from it; a FOLLOW-UP migration drops the columns once this
-- one is deployed and the new code is live (expand/contract).
--
-- While both exist the JOIN TABLE is the authority for authorisation
-- and the column is written with the person's first role purely to stay
-- non-null and truthful. A column two things disagree about is exactly
-- the drift CNS-2 and BIN-1 exist to prevent, so which one decides is
-- stated rather than left to be inferred.

-- ── Staff ───────────────────────────────────────────────────────────
CREATE TABLE "staff_user_roles" (
    "staff_user_id" UUID        NOT NULL,
    "role_id"       UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_user_roles_pkey" PRIMARY KEY ("staff_user_id", "role_id")
);
CREATE INDEX "staff_user_roles_role_id_idx" ON "staff_user_roles"("role_id");

-- Cascade on the person: removing somebody removes what they held.
ALTER TABLE "staff_user_roles"
    ADD CONSTRAINT "staff_user_roles_staff_user_id_fkey"
    FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict on the role: a role somebody holds must not vanish under them.
ALTER TABLE "staff_user_roles"
    ADD CONSTRAINT "staff_user_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "staff_invitation_roles" (
    "invitation_id" UUID        NOT NULL,
    "role_id"       UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_invitation_roles_pkey" PRIMARY KEY ("invitation_id", "role_id")
);
CREATE INDEX "staff_invitation_roles_role_id_idx" ON "staff_invitation_roles"("role_id");

ALTER TABLE "staff_invitation_roles"
    ADD CONSTRAINT "staff_invitation_roles_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "staff_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_invitation_roles"
    ADD CONSTRAINT "staff_invitation_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Seller teams ────────────────────────────────────────────────────
CREATE TABLE "seller_user_roles" (
    "seller_user_id" UUID        NOT NULL,
    "role_id"        UUID        NOT NULL,
    "granted_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_user_roles_pkey" PRIMARY KEY ("seller_user_id", "role_id")
);
CREATE INDEX "seller_user_roles_role_id_idx" ON "seller_user_roles"("role_id");

ALTER TABLE "seller_user_roles"
    ADD CONSTRAINT "seller_user_roles_seller_user_id_fkey"
    FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_user_roles"
    ADD CONSTRAINT "seller_user_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "seller_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "seller_user_invitation_roles" (
    "invitation_id" UUID        NOT NULL,
    "role_id"       UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_user_invitation_roles_pkey" PRIMARY KEY ("invitation_id", "role_id")
);
CREATE INDEX "seller_user_invitation_roles_role_id_idx" ON "seller_user_invitation_roles"("role_id");

ALTER TABLE "seller_user_invitation_roles"
    ADD CONSTRAINT "seller_user_invitation_roles_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "seller_user_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_user_invitation_roles"
    ADD CONSTRAINT "seller_user_invitation_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "seller_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Reseller store teams ────────────────────────────────────────────
CREATE TABLE "store_user_roles" (
    "store_user_id" UUID        NOT NULL,
    "role_id"       UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_user_roles_pkey" PRIMARY KEY ("store_user_id", "role_id")
);
CREATE INDEX "store_user_roles_role_id_idx" ON "store_user_roles"("role_id");

ALTER TABLE "store_user_roles"
    ADD CONSTRAINT "store_user_roles_store_user_id_fkey"
    FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_user_roles"
    ADD CONSTRAINT "store_user_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "store_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "store_user_invitation_roles" (
    "invitation_id" UUID        NOT NULL,
    "role_id"       UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_user_invitation_roles_pkey" PRIMARY KEY ("invitation_id", "role_id")
);
CREATE INDEX "store_user_invitation_roles_role_id_idx" ON "store_user_invitation_roles"("role_id");

ALTER TABLE "store_user_invitation_roles"
    ADD CONSTRAINT "store_user_invitation_roles_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "store_user_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_user_invitation_roles"
    ADD CONSTRAINT "store_user_invitation_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "store_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Backfill ────────────────────────────────────────────────────────
-- Everybody keeps exactly what they had. `ON CONFLICT DO NOTHING` so a
-- re-run is a no-op rather than a failure.
INSERT INTO "staff_user_roles" ("staff_user_id", "role_id")
SELECT "id", "role_id" FROM "staff_users"
ON CONFLICT DO NOTHING;

INSERT INTO "seller_user_roles" ("seller_user_id", "role_id")
SELECT "id", "role_id" FROM "seller_users"
ON CONFLICT DO NOTHING;

INSERT INTO "store_user_roles" ("store_user_id", "role_id")
SELECT "id", "role_id" FROM "store_users"
ON CONFLICT DO NOTHING;

-- Invitations still waiting on somebody keep the role they were sent
-- with. A staff or seller invitation carries only the LEGACY ENUM, so
-- the role is found by the key the seeded roles took from it; a store
-- invitation already carries a role id.
--
-- A seller invitation whose enum value names a role that company has
-- since deleted is SKIPPED rather than guessed at: the join finds
-- nothing, the invitation keeps its enum, and the resolver falls back to
-- it exactly as it does today. Nothing is lost that was not already
-- unresolvable.
INSERT INTO "staff_invitation_roles" ("invitation_id", "role_id")
SELECT i."id", r."id"
FROM "staff_invitations" i
JOIN "staff_roles" r ON r."key" = i."role"::text AND r."deleted_at" IS NULL
WHERE i."used_at" IS NULL AND i."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "seller_user_invitation_roles" ("invitation_id", "role_id")
SELECT i."id", r."id"
FROM "seller_user_invitations" i
JOIN "seller_roles" r
  ON r."seller_id" = i."seller_id" AND r."key" = i."role"::text AND r."deleted_at" IS NULL
WHERE i."used_at" IS NULL AND i."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "store_user_invitation_roles" ("invitation_id", "role_id")
SELECT "id", "role_id" FROM "store_user_invitations"
WHERE "used_at" IS NULL AND "deleted_at" IS NULL
ON CONFLICT DO NOTHING;

-- Nobody is left without a role. If this fires, a user row points at a
-- role the join could not copy, and continuing would mean a person with
-- a live session and an empty permission set — which the guards read as
-- "sign in again", for ever.
DO $$
DECLARE missing INT;
BEGIN
  SELECT
      (SELECT COUNT(*) FROM "staff_users"  u WHERE NOT EXISTS (SELECT 1 FROM "staff_user_roles"  x WHERE x."staff_user_id"  = u."id"))
    + (SELECT COUNT(*) FROM "seller_users" u WHERE NOT EXISTS (SELECT 1 FROM "seller_user_roles" x WHERE x."seller_user_id" = u."id"))
    + (SELECT COUNT(*) FROM "store_users"  u WHERE NOT EXISTS (SELECT 1 FROM "store_user_roles"  x WHERE x."store_user_id"  = u."id"))
  INTO missing;
  IF missing > 0 THEN
    RAISE EXCEPTION 'multi-role backfill left % user row(s) with no role', missing;
  END IF;
END $$;

-- ── The legacy enums become OPTIONAL ────────────────────────────────
-- A person's roles are now role IDS, so they can name a role nobody
-- ever added to the enum — and the three access tiers this change ships
-- beside it (`admin`, `support`, `readonly`) are exactly that. Somebody
-- invited as Support alone has NO enum spelling at all, which makes
-- "none" the ordinary case rather than an edge.
--
-- Writing an enum anyway would be a lie a stale reader could act on, and
-- the codebase's own stance on these columns is already "left alone
-- rather than filled with a lie" (`StaffInvitationService.updateRole`).
-- So the enum is written when the person's first role HAS a spelling and
-- left NULL when it does not. It is display and history; nothing
-- consults it for authorisation, and a follow-up migration drops all
-- four columns along with `role_id`.
--
-- A RELAXATION, not a drop: old code reads these columns and every row
-- it ever wrote is non-null, so the deploy window is unaffected.
ALTER TABLE "staff_invitations" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "seller_user_invitations" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "staff_users" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "seller_users" ALTER COLUMN "role" DROP NOT NULL;
