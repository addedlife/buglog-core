// ─────────────────────────────────────────────────────────────────────────────
// The hand-off text: what gets pasted into a coding session.
//
// Pure string building, no clipboard and no DOM, so it is testable under plain
// node and so a host can put the result wherever it wants.
//
// Convention 1 of BUGLOG-DESIGN.md lives here and is not optional: EVERY line
// carries its ticket id. A note, a resolve and a status change all address one
// document by its id, so a list without ids forces whoever reads it to re-fetch
// the whole queue just to learn which ticket is which — which, from a cloud
// session, is a ninety-second round trip before any work starts.
// ─────────────────────────────────────────────────────────────────────────────

import { typeOf } from './model.js';
import { awaitingCoder } from './notes.js';

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Who filed it. A ticket with no reporter block was filed by the owner. */
function reporterOf(bug) {
  const r = bug?.reporter;
  if (bug?.source !== 'user' || !r || (!r.email && !r.name)) return 'owner';
  if (r.name && r.email) return `${r.name} <${r.email}>`;
  return r.name || r.email;
}

/**
 * The open queue as a list a human pastes to a coding session.
 *
 * @param {object[]} bugs        the whole log, newest first
 * @param {{productName: string, includeReporter?: boolean}} opts
 */
export function copyForTeam(bugs, { productName = 'this app', includeReporter = false } = {}) {
  const open = (Array.isArray(bugs) ? bugs : []).filter(
    (b) => (b.status || 'unresolved') === 'unresolved',
  );
  const lines = [`Unresolved tickets — ${productName}`];
  if (!open.length) {
    lines.push('', '(none — all clear)');
    return lines.join('\n');
  }
  lines.push(
    'The code in brackets is the ticket id. Use it to write notes and resolve —',
    'no need to fetch the list again.',
    '',
  );
  open.forEach((b, i) => {
    const when = b.createdAtMs ? new Date(b.createdAtMs).toLocaleString() : '';
    lines.push(`${i + 1}. [${b.id}] [${typeOf(b.type).label}] ${oneLine(b.text)}`);
    if (includeReporter) {
      const ver = b.context?.appVersion ? `, v${b.context.appVersion}` : '';
      lines.push(`   from: ${reporterOf(b)}${when ? ` · logged ${when}` : ''}${ver}`);
    } else if (when) {
      lines.push(`   logged ${when}`);
    }
    // Someone reading the paste cannot see a thumbnail, and a ticket filed with
    // a picture was filed with one because the words were not enough alone.
    const shots = Array.isArray(b.attachments) ? b.attachments.filter((a) => a?.path) : [];
    if (shots.length) {
      lines.push(`   ${shots.length} screenshot(s) attached: ${shots.map((a) => a.path).join(', ')}`);
    }
    // A ticket reopened by a reply looks identical to a fresh one without this,
    // and the reply is the whole reason it is back on the list.
    if (awaitingCoder(b)) {
      const last = b.notes[b.notes.length - 1];
      lines.push(`   ↳ reply from the owner, unanswered: ${oneLine(last.text)}`);
    }
  });
  return lines.join('\n');
}

/**
 * The full run brief: everything an agent needs to open a session already
 * knowing the job, rather than spending its first thousand tokens rediscovering
 * paths. Hosts supply their own `where` and `gate` blocks — those are the parts
 * that genuinely differ between two repos.
 *
 * @param {object[]} bugs
 * @param {{
 *   productName: string, appVersion?: string, repo?: string,
 *   where?: string[], gate?: string[],
 * }} opts
 */
export function runBrief(bugs, opts = {}) {
  const { productName = 'this app', appVersion = '', repo = '', where = [], gate = [] } = opts;
  const open = (Array.isArray(bugs) ? bugs : []).filter(
    (b) => (b.status || 'unresolved') === 'unresolved',
  );
  const L = [];
  L.push(
    `Run a buglog session on ${productName}` +
      `${repo ? ` (repo: ${repo}` : ''}${repo && appVersion ? `, currently v${appVersion}` : ''}${repo ? ')' : ''}.`,
  );
  L.push('');
  L.push('Everything you need is below — do not go looking for a key or grep for the queue.');
  if (where.length) {
    L.push('', 'WHERE THE TICKETS LIVE', ...where.map((l) => `  ${l}`));
    L.push('  `notes` is an array: a raw write REPLACES it. Append, never overwrite.');
  }
  if (gate.length) {
    L.push('', 'WHAT A FINISHED TICKET LOOKS LIKE', ...gate.map((l) => `  ${l}`));
  }
  L.push(
    '',
    '  Write the note in PLAIN ENGLISH FIRST — a paragraph the owner can read without',
    '  knowing what a component is: what was broken, what he will see now, what is',
    '  still open. The technical account goes after it, separately. Then resolve.',
    '  Work the whole queue top to bottom. Blocked on one is not blocked on all —',
    '  skip it, finish the rest, and say plainly what you skipped and why.',
  );
  L.push(
    '',
    `THE OPEN QUEUE — ${open.length} ticket${open.length === 1 ? '' : 's'}, verbatim, as of ${new Date().toLocaleString()}`,
    '',
  );
  if (!open.length) {
    L.push('  (none — the queue is clear)');
    return L.join('\n');
  }
  open.forEach((b, i) => {
    const when = b.createdAtMs ? new Date(b.createdAtMs).toLocaleString() : 'unknown';
    L.push(`${i + 1}. id: ${b.id}`);
    L.push(
      `   type: ${typeOf(b.type).label} · from: ${reporterOf(b)} · filed: ${when}` +
        `${b.context?.appVersion ? ` · on v${b.context.appVersion}` : ''}`,
    );
    L.push(`   text: ${oneLine(b.text)}`);
    // Prior notes are the difference between "fix this" and "here is what has
    // already been tried" — without them a run repeats work or contradicts it.
    for (const n of Array.isArray(b.notes) ? b.notes : []) {
      const nt = oneLine(n?.text);
      if (nt) L.push(`   earlier note: ${nt}`);
    }
    L.push('');
  });
  return L.join('\n');
}
