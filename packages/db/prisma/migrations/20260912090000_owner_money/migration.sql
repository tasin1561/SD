-- Money the owner puts into, or takes out of, the business. Equity:
-- neither the P&L's income nor its expenses.
ALTER TYPE "bank_entry_type" ADD VALUE 'owner_contribution';
ALTER TYPE "bank_entry_type" ADD VALUE 'owner_drawing';
