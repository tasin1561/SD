-- Runs on first init of an empty Postgres data dir. Subsequent boots skip it.
-- To re-run after editing, you must reset the volume: `pnpm db:reset`.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- PostGIS: deferred. Enable here if zone-based pricing in Phase 1A ends up needing it.
-- The current image (timescale/timescaledb:latest-pg18) does not ship PostGIS;
-- switching to a PostGIS-capable image (e.g. timescale/timescaledb-ha) is required first.
-- CREATE EXTENSION IF NOT EXISTS postgis;
