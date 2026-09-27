/**
 * A structural check for the one regex shape that can hang the process.
 *
 * `courier_message_templates.pattern` is operator-editable DATA, and the
 * classifier runs it against an inbound email body — up to 500 KB, and
 * supplied by anyone who learns the courier-inbound address (the HMAC
 * authenticates the Cloudflare Worker that relays it, not whoever wrote
 * the mail). A pattern with a quantifier inside a quantified group —
 * `(a+)+`, `(\s+)*`, `([a-z]+)+` — backtracks exponentially, so a body
 * chosen to defeat it pins a CPU with no timeout anywhere: Node's regex
 * engine cannot be interrupted, and every BullMQ worker shares this
 * process (SCALE-1).
 *
 * No seeded pattern has this shape today, which is what makes this
 * latent rather than live. It is checked at the WRITE, because that is
 * the only moment a person is present to be told why — a refusal at
 * match time is an outage nobody can see, which is the argument the
 * promotion path already makes for compiling the pattern up front.
 *
 * A deliberately SIMPLE structural check, not a regex-engine analysis:
 * a full safety proof needs an automaton walk, and a dependency for that
 * would be a large amount of trust bought to reject inputs an operator
 * has no reason to type. This catches the catastrophic family and says
 * plainly what to write instead. The text cap in the classifier is the
 * other half — together they bound the damage of anything this misses.
 */

/** A quantifier that can repeat unboundedly. `?` cannot, so it is not one. */
function isUnboundedQuantifier(pattern: string, i: number): boolean {
  const ch = pattern[i];
  if (ch === '*' || ch === '+') return true;
  if (ch !== '{') return false;
  // `{2,}` and `{2,9}` repeat; `{2}` is a fixed count and cannot blow up
  // on its own, but is treated as unbounded when open-ended.
  const close = pattern.indexOf('}', i);
  if (close === -1) return false;
  return pattern.slice(i + 1, close).includes(',');
}

/**
 * True when `pattern` contains a quantified group whose own body is
 * quantified — the catastrophic-backtracking shape.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  // Index of each group's opening paren, innermost last.
  const open: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\') {
      i += 1; // skip the escaped character outright
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      open.push(i);
      continue;
    }
    if (ch !== ')') continue;

    const start = open.pop();
    if (start === undefined) continue; // unbalanced; the compile check owns that

    // Is the group itself repeated?
    if (!isUnboundedQuantifier(pattern, i + 1)) continue;

    // Then: does its body quantify anything?
    if (bodyQuantifies(pattern.slice(start + 1, i))) return true;
  }

  return false;
}

/** Whether a group body contains an unbounded quantifier of its own. */
function bodyQuantifies(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (isUnboundedQuantifier(body, i)) return true;
  }
  return false;
}

/** The refusal an operator reads. Names the shape and the fix. */
export const NESTED_QUANTIFIER_MESSAGE =
  'That pattern repeats a group that already repeats — for example (a+)+ or (\\s+)*. ' +
  'On a long message this backtracks exponentially and would pin the server, so it is ' +
  'refused. Remove the outer repeat: (\\s+)* means the same as \\s* here.';
