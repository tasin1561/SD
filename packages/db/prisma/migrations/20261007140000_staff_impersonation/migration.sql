-- Support impersonation: a staff member acting inside a seller's or a
-- reseller store's account, for a bounded time, for a stated reason.
--
-- ── WHY THE ENUM GAINS TWO VALUES RATHER THAN REUSING `seller` ───────
-- If an order placed by staff-as-seller wrote a row identical to one the
-- seller placed themselves, the audit would be a SEPARATE CLAIM sitting
-- beside the data rather than part of it — and six months into "we never
-- placed that order" the answer would be matching timestamps across two
-- tables. The row itself has to say which it was.
--
-- `audit_logs.impersonated_by_staff_user_id` carries the other half:
-- `actor_id` stays the seller or store user, because the action really
-- did happen in their account, and this says who was at the keyboard.
-- `AuditLogService` stamps both from the request's ambient context, so
-- none of the ~200 callers can forget — a caller that did would write a
-- row claiming the seller acted alone, and this table is append-only
-- (MUST NOT #3). There would be no correcting it.
--
-- ── THIS MIGRATION WAS MISSING, AND THAT IS THE POINT ────────────────
-- The schema declared all of this and no migration created any of it.
-- The generated client had `prisma.impersonationSession`, so nothing in
-- the build complained: it compiled, type-checked, and passed 464 unit
-- tests — every one of which constructs its service by hand and so never
-- touches a database. The first real support session would have died on
-- its first INSERT, and the audit guarantee the whole feature rests on
-- would have had no column behind it. Found by the e2e suite, which is
-- the only thing that runs migrations and boots the real app.
--
-- Adding enum values in a transaction is safe here: PostgreSQL 12+
-- permits it, and nothing below USES the new labels — they are written
-- by the application after this has committed.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "actor_type" ADD VALUE 'staff_as_seller';
ALTER TYPE "actor_type" ADD VALUE 'staff_as_store';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "impersonated_by_staff_user_id" UUID;

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "staff_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "reason" TEXT NOT NULL,
    "may_write" BOOLEAN NOT NULL DEFAULT false,
    "otp_verified_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "ended_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "write_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_sessions_staff_user_id_created_at_idx" ON "impersonation_sessions"("staff_user_id", "created_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_seller_id_created_at_idx" ON "impersonation_sessions"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_store_id_created_at_idx" ON "impersonation_sessions"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_ended_at_idx" ON "impersonation_sessions"("ended_at");

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

