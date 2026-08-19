// ─────────────────────────────────────────────────────────────────────────────
// The note thread on a ticket — who wrote each note, and what it answers.
//
// This is the shared, canonical copy. RabbiMetrics and Shamash Pro 4 both
// import it from this package; neither carries its own version any more.
//
// A reply is just another note. Two optional fields carry the thread:
//
//   by       'owner' | 'coder'   — who wrote it. ABSENT MEANS 'coder': every
//                                  note written before replies existed came
//                                  from the coding side, so the default is the
//                                  truth about the history, not a guess.
//   replyTo  number              — the `atMs` of the note being answered.
//                                  Absent means it is a top-level note.
//
// Nothing migrates and nothing is rewritten. An old note reads as a top-level
// coder note, which is exactly what it was.
//
// Shamash additionally writes `from: 'developer' | 'reporter'` on notes echoed
// between a member's compartment and the developer's ticket. That vocabulary
// predates this file and is READ here rather than migrated — the note's text is
// the record, and rewriting somebody's history to tidy a field name is not
// worth a single lost note.
//
// Pure and dependency-free on purpose: every renderer reads from it, and the
// test suite runs it under plain node with no build and no credentials.
// NOTHING in this package may import a storage client, and nothing here may
// fetch. See README.md — that boundary is what keeps two apps' logs apart.
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER = 'owner';
export const CODER = 'coder';

/**
 * Who wrote a note. Anything not explicitly the reader's own side is the
 * coding side's — which is the truth about every note written before replies
 * existed.
 */
export function noteAuthor(note) {
  if (note?.by === OWNER) return OWNER;
  if (note?.from === 'reporter') return OWNER;
  return CODER;
}

/**
 * A note's identity, and the anchor a reply points at. Shamash writes both `at`
 * (ISO) and `atMs`; the echo functions write `atMs` only; the oldest notes have
 * neither, and get no Reply button rather than an orphaned one.
 */
export function noteKey(note) {
  const ms = note?.atMs ?? (typeof note?.at === 'number' ? note.at : null);
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * Append a note to a ticket's array. Firestore has no array append — a write
 * REPLACES the field — so every caller reads the existing notes, adds to them
 * here, and re-sends the whole array. Getting this wrong once erases every note
 * a ticket ever carried, which is why it is one function with its own test.
 *
 * `at` (ISO) is written alongside `atMs` because Shamash's existing resolve
 * path already stores both and its stored history is read by both spellings.
 *
 * @param {object[]|undefined} existing  whatever is on the ticket now
 * @param {string} text
 * @param {{by?: string, replyTo?: number|null, atMs?: number, from?: string}} [opts]
 */
export function appendNote(existing, text, opts = {}) {
  const { by = CODER, replyTo = null, atMs = Date.now(), from = '' } = opts;
  const prior = Array.isArray(existing) ? existing : [];
  const note = { at: new Date(atMs).toISOString(), atMs, text };
  // Only written when they say something. A `by: 'coder'` stamp on every note
  // would be noise on the wire and would make an old note and a new one that
  // mean the same thing compare differently.
  if (by === OWNER) note.by = OWNER;
  if (from) note.from = from;
  if (typeof replyTo === 'number' && Number.isFinite(replyTo)) note.replyTo = replyTo;
  return [...prior, note];
}

/**
 * The flat array as a two-level thread: top-level notes in the order written,
 * each carrying the replies that point at it, also in order.
 *
 * Two levels and no more. A reply to a reply is stored pointing at the reply,
 * and is shown under the same parent rather than indented a third time — this
 * is a three-line exchange about one fix, not a discussion forum, and a deeper
 * tree would cost more screen width than either panel has.
 *
 * An orphaned reply — one whose parent was never there, or was written before
 * notes carried times — is shown at the top level rather than dropped. A note
 * whose anchor is missing is still a note somebody wrote.
 */
export function threadNotes(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const byKey = new Map();
  for (const n of list) {
    const k = noteKey(n);
    if (k != null && !byKey.has(k)) byKey.set(k, n);
  }
  const roots = [];
  const slots = new Map();
  const rootFor = (n) => {
    // Walk up to the top-level ancestor so a reply-to-a-reply lands beside its
    // sibling instead of starting a second-level branch of its own.
    let cur = n;
    const seen = new Set();
    while (typeof cur?.replyTo === 'number' && byKey.has(cur.replyTo)) {
      const k = noteKey(cur);
      if (k != null && seen.has(k)) break; // a cycle in hand-edited data
      if (k != null) seen.add(k);
      cur = byKey.get(cur.replyTo);
    }
    return cur;
  };
  for (const n of list) {
    const root = rootFor(n);
    if (root === n) {
      const entry = { note: n, replies: [] };
      roots.push(entry);
      const k = noteKey(n);
      if (k != null) slots.set(k, entry);
      continue;
    }
    const k = noteKey(root);
    const entry = k != null ? slots.get(k) : null;
    if (entry) entry.replies.push(n);
    else roots.push({ note: n, replies: [] });
  }
  return roots;
}

/**
 * True when the last thing said on the ticket came from the reader's own side
 * rather than the coding side — the coding side has been replied to and has not
 * answered. This is what makes a reply on a RESOLVED ticket visible to a coding
 * session instead of dying in a panel nobody re-opens.
 */
export function awaitingCoder(bug) {
  const list = Array.isArray(bug?.notes) ? bug.notes : [];
  if (!list.length) return false;
  return noteAuthor(list[list.length - 1]) === OWNER;
}
