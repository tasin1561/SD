---
description: Write a short handoff note before /clear so the next session starts cheap
---

Write `.claude/HANDOFF.md` (overwrite it) with at most 25 lines:

- **Task:** one line
- **Status:** done / partial / blocked
- **Changed files:** paths only
- **Decisions made:** bullets, one line each
- **Next step:** the single next action, with the exact command or file to open
- **Gotchas:** anything that cost time this session

No code blocks longer than 5 lines. Then reply only: `Handoff saved — run /clear.`
Next session: read `.claude/HANDOFF.md` first, and only that, before anything else.
