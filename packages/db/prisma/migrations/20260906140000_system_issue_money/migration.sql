-- Money that moved, or failed to, with nothing downstream to notice.
-- Its own kind because the audience differs: an API_ERROR needs a code
-- change, this needs somebody in finance to look at a real payment.
ALTER TYPE "system_issue_kind" ADD VALUE IF NOT EXISTS 'money';
