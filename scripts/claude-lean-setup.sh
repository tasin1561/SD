#!/usr/bin/env bash
# Skydrop — lean Claude Code setup (WSL / Linux)
# Run from anywhere inside the Skydrop repo:  bash scripts/claude-lean-setup.sh
# Package manager: pnpm (pnpm-lock.yaml). Scope work with e.g.
#   pnpm turbo run typecheck --filter=@skydrop/api
#   pnpm --filter @skydrop/seller test
# Re-runnable: it updates sources and re-copies only the curated pieces.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SRC="$HOME/.cache/claude-sources"
mkdir -p "$SRC" .claude/agents .claude/skills
export PATH="$HOME/.local/bin:$PATH"
export DISABLE_TELEMETRY=1

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

clone_or_pull() { # $1 = repo url, $2 = dir name
  if [ -d "$SRC/$2/.git" ]; then git -C "$SRC/$2" pull --ff-only -q
  else git clone --depth 1 -q "$1" "$SRC/$2"; fi
}

# Force a cheap model on an agent file (adds or replaces `model:` in frontmatter)
set_model() { # $1 = file, $2 = model
  python3 - "$1" "$2" <<'PY'
import sys, re, pathlib
p, model = pathlib.Path(sys.argv[1]), sys.argv[2]
t = p.read_text()
if not t.startswith("---"):
    t = f"---\nname: {p.stem}\nmodel: {model}\n---\n\n" + t
else:
    end = t.index("\n---", 3)
    head, body = t[:end], t[end:]
    head = re.sub(r"(?m)^model:.*$", f"model: {model}", head) if re.search(r"(?m)^model:", head) else head + f"\nmodel: {model}"
    t = head + body
p.write_text(t)
PY
}

# ---------------------------------------------------------------- 1. graphify
say "1/6 graphify — code knowledge graph (biggest token saver)"
# uv + graphify are already installed on this machine (audit 2026-10-20); install only if missing.
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
command -v graphify >/dev/null || uv tool install graphifyy >/dev/null
graphify install --platform claude --project   # skill -> .claude/skills/graphify (project scope)
graphify claude install               # always-on hook: steers Read/Grep to the graph
GRAPHIFY_BACKEND=none graphify extract . --code-only   # local AST only, no LLM tokens spent
graphify hook install                 # rebuild graph on commit/checkout
grep -qxF 'graphify-out/' .gitignore 2>/dev/null || echo 'graphify-out/' >> .gitignore
# NOTE: the hook rebuilds the graph after every commit/checkout.

# ---------------------------------------------------------------- 2. ECC (selective)
say "2/6 ECC — only the skills/agents that fit Skydrop (no rules, no hook runtime)"
# The ECC plugin is NOT installed (audit 2026-10-20), so the selected pieces are copied.
# security-review is skipped: it clashes with the built-in /security-review skill.
clone_or_pull https://github.com/affaan-m/ECC.git ECC
for s in search-first strategic-compact iterative-retrieval verification-loop backend-patterns; do
  if [ -d "$SRC/ECC/skills/$s" ]; then rm -rf ".claude/skills/$s"; cp -R "$SRC/ECC/skills/$s" ".claude/skills/$s"
  else warn "ECC skill '$s' not found — skipped"; fi
done
for a in typescript-reviewer build-error-resolver database-reviewer; do
  if [ -f "$SRC/ECC/agents/$a.md" ]; then cp "$SRC/ECC/agents/$a.md" ".claude/agents/$a.md"; set_model ".claude/agents/$a.md" sonnet
  else warn "ECC agent '$a' not found — skipped"; fi
done

# ---------------------------------------------------------------- 3. agency-agents (selective)
say "3/6 agency-agents — 4 specialists, not 200"
clone_or_pull https://github.com/msitarzewski/agency-agents.git agency-agents
for f in engineering/engineering-minimal-change-engineer.md \
         engineering/engineering-frontend-developer.md \
         engineering/engineering-backend-architect.md \
         testing/testing-test-automation-engineer.md; do
  if [ -f "$SRC/agency-agents/$f" ]; then
    dest=".claude/agents/$(basename "$f")"; cp "$SRC/agency-agents/$f" "$dest"; set_model "$dest" sonnet
  else warn "agency agent '$f' not found — skipped"; fi
done

# ---------------------------------------------------------------- 4. vercel skills
say "4/6 vercel-labs skills — web design guidelines (project scope)"
if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=20)?0:1)' 2>/dev/null; then
  npx -y skills add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code || warn "skills add failed — run it manually"
else
  warn "Node 22.20+ needed for 'npx skills' — skipped (nvm install 22 && rerun)"
fi

# ---------------------------------------------------------------- 5. premium-ui-motion + existing skills
say "5/6 premium-ui-motion"
if [ -d .claude/skills/premium-ui-motion ] || [ -d "$HOME/.claude/skills/premium-ui-motion" ]; then
  echo "found — kept as is"
else
  warn "premium-ui-motion not found in .claude/skills or ~/.claude/skills — copy your skill folder there"
fi

# ---------------------------------------------------------------- 6. firecrawl key
say "6/6 firecrawl MCP (.mcp.json)"
if [ -z "${FIRECRAWL_API_KEY:-}" ]; then
  warn "FIRECRAWL_API_KEY not set. Add to ~/.bashrc:  export FIRECRAWL_API_KEY=fc-xxxx"
else
  echo "key present"
fi

say "Done. Installed:"
ls -1 .claude/skills .claude/agents
cat <<'EOF'

Next: open Claude Code in the repo, run /context to see the baseline,
and /agents + /skills to confirm. Delete anything you never use — every
skill and agent description costs tokens on every turn.
EOF
