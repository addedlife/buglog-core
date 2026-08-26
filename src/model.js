// ─────────────────────────────────────────────────────────────────────────────
// The vocabulary every buglog shares: what a ticket can be, where it can stand,
// and how its text and times are rendered for a list.
//
// Both apps had their own copy of all of this, and it had already drifted in
// small ways. It lives here now so a new status or a changed label is one edit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a ticket IS.
 *
 * The second type is labelled "Feature" (owner ticket f912y0ti). Its id stays
 * `idea`: every ticket already filed carries that value, and renaming the id
 * would orphan them.
 */
export const TYPES = [
  { id: 'bug', label: 'Bug', icon: 'bug_report', role: 'error' },
  { id: 'idea', label: 'Feature', icon: 'lightbulb', role: 'tertiary' },
];

/** Where a ticket STANDS. */
export const STATUSES = [
  { id: 'unresolved', label: 'Unresolved', icon: 'error', role: 'error' },
  { id: 'paused', label: 'Paused', icon: 'pause_circle', role: 'on-surface-variant' },
  { id: 'resolved', label: 'Resolved', icon: 'check_circle', role: 'primary' },
  { id: 'future', label: 'Future update', icon: 'schedule', role: 'tertiary' },
];

export const TYPE_BY = Object.fromEntries(TYPES.map((t) => [t.id, t]));
export const STATUS_BY = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

export const typeOf = (id) => TYPE_BY[id] || TYPE_BY.bug;
export const statusOf = (id) => STATUS_BY[id] || STATUS_BY.unresolved;

/**
 * The filter chips. Triage sees every status; a reporter sees only the two
 * states their own copy can be in — "paused" and "future update" are triage
 * decisions and mean nothing on a reporter's ticket.
 */
export function filtersFor({ triage = true } = {}) {
  if (!triage) {
    return [
      { id: 'all', label: 'All' },
      { id: 'unresolved', label: 'Open' },
      { id: 'resolved', label: 'Fixed' },
      { id: 'bug', label: 'Bugs' },
      { id: 'idea', label: 'Features' },
    ];
  }
  return [
    { id: 'all', label: 'All' },
    ...STATUSES.map((s) => ({ id: s.id, label: s.id === 'future' ? 'Future' : s.label })),
    { id: 'bug', label: 'Bugs' },
    { id: 'idea', label: 'Features' },
  ];
}

/** Does this ticket belong under this filter chip? */
export function matchesFilter(bug, filter) {
  if (filter === 'all') return true;
  if (filter === 'bug' || filter === 'idea') return bug?.type === filter;
  return (bug?.status || 'unresolved') === filter;
}

/**
 * How much of an entry a collapsed row shows. Exported because the summariser
 * is aimed at exactly this number — see `needsSummary` below.
 */
export const TRUNCATE_AT = 80;

/** One line, no runs of whitespace. What a row is measured and drawn against. */
const oneLine = (text = '') => String(text).trim().replace(/\s+/g, ' ');

/**
 * Display fallback for a long entry: first sentence, capped. The stored text is
 * NEVER touched — truncation is display-only, and tapping the row shows it in
 * full. An AI summary, where a host provides one, is preferred over this.
 */
export function truncate(text = '') {
  const t = oneLine(text);
  if (t.length <= TRUNCATE_AT) return t;
  const stop = t.slice(0, TRUNCATE_AT).lastIndexOf('. ');
  return stop > 30 ? t.slice(0, stop + 1) : `${t.slice(0, TRUNCATE_AT - 3)}…`;
}

/**
 * Whether a ticket should be sent to the host's summariser.
 *
 * The answer is simply "would this row be shown cut off" — which is what a
 * summary is FOR. Owner ticket S3tDR2qgTmiYEbOPsLZP ("buglog does not seem to
 * be autosummarizing entries anymore"): the summariser used to have its own
 * threshold, a raw length over 90, while the display cut at 80. Everything
 * between the two was guaranteed to appear chopped off mid-word and could
 * never earn a summary, and four tickets filed in one afternoon landed in that
 * band. Asking truncate() itself removes the second number rather than
 * choosing a better one, so the two cannot drift apart again.
 */
export const needsSummary = (bug) => {
  if (bug?.summary) return false;
  const t = oneLine(bug?.text || '');
  return t.length > 0 && truncate(t) !== t;
};

/** What a list row shows before it is expanded. */
export const displayText = (bug) => bug?.summary || truncate(bug?.text || '');

export function formatRel(ms) {
  if (!ms) return '';
  const d = Date.now() - ms;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 604800000) return `${Math.floor(d / 86400000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Two numbers per ticket, both computed over the WHOLE log rather than the
 * filtered view — a number that changes when you tap a filter chip is not an
 * identifier.
 *
 *   all   where it falls in the history of the log, counting from the first
 *         ticket ever filed. `bugs` arrives newest-first.
 *   open  its place in the unresolved queue alone, newest = 1.
 */
export function sequenceNumbers(bugs) {
  const map = new Map();
  const list = Array.isArray(bugs) ? bugs : [];
  let open = 0;
  list.forEach((b, i) => {
    map.set(b.id, {
      all: list.length - i,
      open: (b.status || 'unresolved') === 'unresolved' ? ++open : null,
    });
  });
  return map;
}
