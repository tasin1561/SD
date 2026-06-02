# CI/CD

Two workflows:

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | every PR + every push to `main` | Postgres 18 + Redis services, `pnpm install`, typecheck + lint + unit tests for every package + app, then a full Next build of all 4 apps |
| `.github/workflows/deploy.yml` | after CI succeeds on `main` (or manual via Actions tab) | SSH to the droplet, run `scripts/deploy.sh`, which `git pull`s, builds, runs `prisma migrate deploy`, reseeds only if the seed file changed, restarts only the apps whose code changed, and smoke-tests `/health` / `/login` / `/` |

The deploy is **auto-on-merge-to-main** but the **CI gate is the merge bar**. A PR opener sees CI run before merge; main never advances past a red CI. Manual deploys are still available from the Actions tab (`workflow_dispatch`).

## One-time setup — add 3 GitHub secrets

The deploy workflow SSHs into the droplet as the `skydrop` user. You need:

### 1. Generate a deploy SSH key on the droplet

```bash
ssh skydrop
# (on droplet)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github-deploy -N ""
cat ~/.ssh/github-deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github-deploy        # <- copy the entire private key (multi-line)
```

### 2. Add the three secrets at `https://github.com/<owner>/<repo>/settings/secrets/actions`

| Name | Value |
|---|---|
| `DROPLET_HOST` | `157.245.109.39` (or `skydrop-app-prod.skydrop.online` if you have a DNS A record) |
| `DROPLET_USER` | `skydrop` |
| `DROPLET_SSH_KEY` | the contents of `~/.ssh/github-deploy` from step 1 — the whole thing including `-----BEGIN OPENSSH PRIVATE KEY-----` and trailing newline |

### 3. (Optional) Restrict by IP

Add the droplet's IP to a firewall allow list if you want SSH only from GitHub's runner ranges. Their IP ranges are published at `https://api.github.com/meta` → `actions` array. Most setups leave SSH open to anywhere since the deploy key + `authorized_keys` is the actual auth.

## What the deploy script does

`scripts/deploy.sh` runs on the droplet. It's idempotent and computes a per-deploy diff against the previously deployed SHA:

1. `git fetch && git merge --ff-only origin/main` — fail if main isn't a fast-forward (someone force-pushed; bail).
2. `pnpm install --frozen-lockfile` — same lock as CI.
3. Build `packages/db`, `packages/api-client`, `packages/ui` (apps consume `dist/`).
4. `prisma migrate deploy` — no-op if no new migrations.
5. `prisma db seed` ONLY if `prisma/seed.ts` or `schema.prisma` changed.
6. Build all four apps (`api`, `admin`, `seller`, `track`).
7. `pm2 restart` only the apps whose code changed. If any package changed, restart all four. Saves the pm2 process list.
8. Smoke `curl` against each of the four local ports — exit non-zero if any returns 5xx.

The script is committed to the repo so changes to the deploy process go through CI / PR review like any other change.

## Rolling back

If a deploy goes bad:

```bash
ssh skydrop
cd ~/app
git reset --hard <previous-sha>          # the deploy log prints both SHAs
bash scripts/deploy.sh                    # re-runs build + restart
```

Or via the Actions tab → Deploy → Re-run the previous successful run.

## Local pre-push hook (optional)

If you want to catch CI failures before pushing:

```bash
# .git/hooks/pre-push  (chmod +x)
#!/usr/bin/env bash
set -e
pnpm -r typecheck
pnpm -r --if-present lint
pnpm --filter @skydrop/api test
pnpm --filter @skydrop/admin test
pnpm --filter @skydrop/seller test
```

Mirrors what CI runs.
