-- CUR-17 — a parcel held for a carrier decision that nobody made.
--
-- Its own SystemIssueKind rather than OTHER: NOTIF-16 addresses an
-- audience per kind, and folding this into OTHER would send it to
-- whoever OTHER goes to rather than to the courier desk.
ALTER TYPE "system_issue_kind" ADD VALUE IF NOT EXISTS 'courier_decision';
