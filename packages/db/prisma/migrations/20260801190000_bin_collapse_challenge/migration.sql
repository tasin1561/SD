-- The email challenge guarding a collapse-to-FLOOR.
--
-- A collapse is the one action in this area that destroys information
-- rather than moving goods: it merges every bin into FLOOR and the
-- original placement survives only in the snapshot taken alongside it.
-- So it is gated like god-mode (typed confirmation, long reason,
-- CRITICAL audit) plus a code sent to the actor's own mailbox — the
-- part that a shoulder-surfed session does not get past.
CREATE TABLE "bin_collapse_challenges" (
  "id"            UUID        NOT NULL DEFAULT uuidv7(),
  "warehouse_id"  UUID        NOT NULL,
  "staff_user_id" UUID        NOT NULL,
  "code_hash"     TEXT        NOT NULL,
  "reason"        TEXT        NOT NULL,
  "attempts"      INTEGER     NOT NULL DEFAULT 0,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "consumed_at"   TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bin_collapse_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bin_collapse_challenges_warehouse_id_idx"
  ON "bin_collapse_challenges" ("warehouse_id");
CREATE INDEX "bin_collapse_challenges_expires_at_idx"
  ON "bin_collapse_challenges" ("expires_at");

ALTER TABLE "bin_collapse_challenges"
  ADD CONSTRAINT "bin_collapse_challenges_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bin_collapse_challenges"
  ADD CONSTRAINT "bin_collapse_challenges_staff_user_id_fkey"
  FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
