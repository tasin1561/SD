-- AlterEnum
BEGIN;
CREATE TYPE "call_outcome_new" AS ENUM ('confirmed', 'customer_declined', 'wrong_number', 'no_answer', 'busy', 'voicemail_left', 'callback_requested', 'technical_failure', 'language_barrier');
ALTER TABLE "call_attempts" ALTER COLUMN "outcome" TYPE "call_outcome_new" USING ("outcome"::text::"call_outcome_new");
ALTER TYPE "call_outcome" RENAME TO "call_outcome_old";
ALTER TYPE "call_outcome_new" RENAME TO "call_outcome";
DROP TYPE "public"."call_outcome_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "call_queue_status_new" AS ENUM ('pending', 'assigned', 'completed', 'expired');
ALTER TABLE "public"."call_queue_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "call_queue_entries" ALTER COLUMN "status" TYPE "call_queue_status_new" USING ("status"::text::"call_queue_status_new");
ALTER TYPE "call_queue_status" RENAME TO "call_queue_status_old";
ALTER TYPE "call_queue_status_new" RENAME TO "call_queue_status";
DROP TYPE "public"."call_queue_status_old";
ALTER TABLE "call_queue_entries" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "order_status" ADD VALUE 'rejected_by_customer';
ALTER TYPE "order_status" ADD VALUE 'rejected_ndr';

-- AlterTable
ALTER TABLE "agent_call_settings" ALTER COLUMN "max_active_calls" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "call_queue_entries" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "call_max_attempts_before_ndr_override" INTEGER;
