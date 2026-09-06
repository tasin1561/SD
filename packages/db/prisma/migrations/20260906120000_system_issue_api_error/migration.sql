-- An unhandled 5xx is now recorded on the system-issues board rather
-- than only in a log file. Its own kind, not INTEGRATION: that one means
-- somebody else's system is unwell and a retry may fix it; this one is
-- ours and the fix is a code change.
ALTER TYPE "system_issue_kind" ADD VALUE IF NOT EXISTS 'api_error';
