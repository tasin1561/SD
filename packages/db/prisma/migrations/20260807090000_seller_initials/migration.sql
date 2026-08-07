-- Seller short code — "Menev Store" → "MSt".
--
-- An operations handle: the thing written on a tote, said on a call, or
-- scanned down a manifest column. A UUID is unusable for that and the
-- company name is too long for a column.
--
-- NULLABLE on purpose rather than NOT NULL DEFAULT something. The value is
-- derived from the company name by application logic (word count decides
-- the shape, and collisions resolve against letters of the same name), and
-- reimplementing that in SQL to satisfy a NOT NULL would give two
-- generators that drift. Existing rows are backfilled by the application;
-- new rows always get one at signup.
ALTER TABLE "sellers" ADD COLUMN "initials" VARCHAR(4);

-- UNIQUE because a three-character code collides — "Menev Store" and
-- "Modern Stationery" both want MSt — and a code that identifies two
-- companies is worse than no code: it fails at the moment it is trusted,
-- on a physical label. Postgres allows many NULLs under a unique index, so
-- this holds during the backfill window without blocking it.
CREATE UNIQUE INDEX "sellers_initials_key" ON "sellers" ("initials");
