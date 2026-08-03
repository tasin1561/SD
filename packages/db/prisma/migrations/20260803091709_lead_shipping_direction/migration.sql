-- CreateEnum
CREATE TYPE "shipping_direction" AS ENUM ('bd_to_in', 'in_to_bd', 'both');

-- AlterTable
ALTER TABLE "invite_leads" ADD COLUMN     "alt_phone" TEXT,
ADD COLUMN     "shipping_direction" "shipping_direction";
