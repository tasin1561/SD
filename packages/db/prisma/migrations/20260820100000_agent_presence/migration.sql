-- Agent presence: availability is a claim about RIGHT NOW, not a stored
-- preference.
--
-- An agent who marked themselves available and walked away kept claiming
-- orders indefinitely: the station's auto-advance re-pulls every 15
-- seconds while the tab is open, so CC-7's 30-minute assignment expiry
-- handed the order back and the abandoned tab immediately took it again.
-- The customer's order sat held by an empty chair, and the pull counter
-- was the only trace.
--
-- Two changes. The default becomes FALSE, so being logged in never
-- implies being at the desk; and `last_seen_at` records when presence
-- was last actually demonstrated, which the sweep uses to stand down
-- agents who are no longer there.

ALTER TABLE "agent_call_settings"
  ALTER COLUMN "is_available" SET DEFAULT false;

ALTER TABLE "agent_call_settings"
  ADD COLUMN "last_seen_at" TIMESTAMPTZ;

-- Stand every existing agent down. Availability has never meant
-- "present" until now, so no stored true can be trusted to mean it;
-- every agent claims it again when they next sit down. Standing someone
-- down costs one click, and leaving a phantom agent available costs a
-- customer their delivery.
UPDATE "agent_call_settings" SET "is_available" = false WHERE "is_available" = true;

-- Anything an absent agent was holding goes back to the queue, keeping
-- its FIFO position (available_at untouched) exactly as the CC-7 expiry
-- would have done.
UPDATE "call_queue_entries"
   SET "status" = 'pending',
       "assigned_agent_id" = NULL,
       "assigned_at" = NULL
 WHERE "status" = 'assigned';

CREATE INDEX "agent_call_settings_available_last_seen_idx"
  ON "agent_call_settings" ("is_available", "last_seen_at");
