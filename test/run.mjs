#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// The whole checked surface of this package, under plain node — no build, no
// browser, no credentials. Two things are being guarded:
//
//   1. The pure logic both apps depend on (threading, appending, hand-off text).
//      appendNote is the one operation here that can DESTROY data if it is
//      wrong, because a Firestore write replaces the notes array rather than
//      appending to it.
//   2. The isolation boundary itself — that no file in src/ can reach a network
//      or a storage client. That is asserted against the source text rather
//      than trusted, because it is the guarantee the two apps' separation
//      rests on.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  OWNER, CODER, noteAuthor, noteKey, appendNote, threadNotes, awaitingCoder,
} from '../src/notes.js';
import {
  typeOf, statusOf, filtersFor, matchesFilter, truncate, displayText, sequenceNumbers,
  needsSummary, TRUNCATE_AT,
} from '../src/model.js';
import { copyForTeam, runBrief } from '../src/handoff.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let failures = 0;
function ok(label, cond, extra = '') {
  if (cond) console.log(`ok    ${label}`);
  else { failures += 1; console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
}
const eq = (label, actual, expected) =>
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('\n── The isolation boundary ─────────────────────────────────────');

const sources = readdirSync(SRC).filter((f) => f.endsWith('.js'));
ok('there are source files to check', sources.length >= 5);

// The point of the package is that it CANNOT reach either app's data. If this
// ever fails, the shared component has grown a way to read or write a store and
// the compartmentalization the two apps depend on is no longer structural.
const banned = [
  [/from\s+['"]firebase/, 'imports firebase'],
  [/require\(\s*['"]firebase/, 'requires firebase'],
  [/\bfetch\s*\(/, 'calls fetch'],
  [/XMLHttpRequest/, 'uses XMLHttpRequest'],
  [/\bWebSocket\b/, 'opens a WebSocket'],
  [/navigator\.sendBeacon/, 'uses sendBeacon'],
  [/\bimport\s+[^;]*\bfrom\s+['"][^.]/, 'imports a third-party module'],
];
for (const file of sources) {
  const text = readFileSync(join(SRC, file), 'utf8');
  // Comments describe the rule ("no firebase, no fetch"), so they are stripped
  // before the check — otherwise the file explaining the boundary would trip it.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [re, why] of banned) {
    ok(`src/${file} never ${why}`, !re.test(code));
  }
}

console.log('\n── Stacking: the host owns it ─────────────────────────────────');

// A hardcoded z-index here shipped a panel that opened UNDERNEATH a host whose
// navigation rail sits at 8600 — it rendered, it was simply painted over, which
// reads as "the buglog is dead" rather than "the buglog is misplaced". The
// level has to come from the host, which is the only side that knows its own
// scale, so this asserts the token exists and that no bare literal is left.
{
  const css = readFileSync(join(SRC, 'styles.js'), 'utf8');
  const hostBlock = css.match(/:host\s*\{[\s\S]*?\n\}/);
  ok('the :host block exists', !!hostBlock);
  const block = hostBlock ? hostBlock[0] : '';
  ok('the host block sets z-index from a custom property', /z-index:\s*var\(--buglog-z/.test(block));
  ok('and not from a bare literal', !/z-index:\s*\d+\s*;/.test(block));
  ok('the default is documented as a fallback', /var\(--buglog-z,\s*\d+\)/.test(block));
}

console.log('\n── Notes: authorship ──────────────────────────────────────────');

{
  const panel = readFileSync(join(SRC, 'panel.js'), 'utf8');
  const css = readFileSync(join(SRC, 'styles.js'), 'utf8');
  ok('icons keep their Material Symbol ligature names', /text:\s*name/.test(panel));
  ok('icons do not degrade into punctuation or words', !/const SYMBOLS\s*=/.test(panel));
  ok('the host can select its Material Symbol family', /--buglog-symbol-font/.test(css));
  ok('the host can anchor the panel at its leading rail', /--buglog-panel-left/.test(css));
  ok('the host can anchor the fallback launcher on the left', /--buglog-fab-left/.test(css));
}

console.log('\n── The text fields keep their drag-to-grow corner ──────────────');

// Owner tickets PlSkCXTy5mSlJwPyEx6x and t86ignvazf1ZbS8HaMHN. @material/web
// 2.4.1 compiles `resize: both` to `n:both`, which is not a CSS property, so
// every M3 textarea is unresizable. The correction was written into ONE host
// first — precisely the drift this package exists to stop — so it lives here
// now and both apps get it. The plain-textarea fallback keeps its own rule in
// the stylesheet, for a host with no Material loaded.
{
  const panel = readFileSync(join(SRC, 'panel.js'), 'utf8');
  const css = readFileSync(join(SRC, 'styles.js'), 'utf8');
  ok('the panel adopts a stylesheet into the Material fields',
    /adoptedStyleSheets/.test(panel));
  ok('and the sheet restores the resize the library broke',
    /resize:vertical/.test(panel) && /resize:inherit/.test(panel));
  ok('it targets the textarea fields, not every field',
    /md-outlined-text-field\[type="textarea"\]/.test(panel));
  ok('a browser without constructable stylesheets is not broken by it',
    /catch\s*\{[^}]*RESIZE_SHEET = null/.test(panel));
  ok('the plain fallback still resizes on its own', /resize:\s*vertical/.test(css));
}

console.log('\n── A partial save is reported, not swallowed ──────────────────');

// Owner ticket Cpqn1e4RkgV9MfFx6zZZ: a ticket whose whole text was a caption
// for a screenshot arrived with no screenshot, because the upload failed and
// the host swallows that failure on purpose. The swallow is right; the silence
// was not.
{
  const panel = readFileSync(join(SRC, 'panel.js'), 'utf8');
  ok('the panel reads a warning off a successful add', /result\.warning/.test(panel));
  ok('and puts it on the banner', /banner = \{ kind: 'error', text: String\(warning\)/.test(panel));
}

eq('a note with no marks is the coding side', noteAuthor({ text: 'x' }), CODER);
eq('by:owner is the owner', noteAuthor({ text: 'x', by: OWNER }), OWNER);
eq("Shamash's from:reporter is the owner's side", noteAuthor({ text: 'x', from: 'reporter' }), OWNER);
eq("Shamash's from:developer is the coding side", noteAuthor({ text: 'x', from: 'developer' }), CODER);
eq('an unknown by: value is not trusted as the owner', noteAuthor({ text: 'x', by: 'someone' }), CODER);

eq('atMs is the anchor', noteKey({ atMs: 42 }), 42);
eq('a numeric at is read too', noteKey({ at: 7 }), 7);
eq('an ISO at is not an anchor', noteKey({ at: '2026-08-19T00:00:00.000Z' }), null);
eq('a note with no time has no anchor', noteKey({ text: 'old' }), null);

console.log('\n── Notes: appending (the one that can destroy data) ────────────');

const existing = [{ text: 'first', atMs: 1 }, { text: 'second', atMs: 2 }];
const after = appendNote(existing, 'third', { atMs: 3 });
eq('every earlier note survives', after.length, 3);
eq('the first is still first', after[0].text, 'first');
eq('the new one is last', after[2].text, 'third');
ok('the original array is not mutated', existing.length === 2);
ok('a plain note carries no by:', after[2].by === undefined);
ok('a plain note carries no replyTo', after[2].replyTo === undefined);
ok('both time spellings are written', after[2].atMs === 3 && typeof after[2].at === 'string');

const reply = appendNote(existing, 'not fixed', { by: OWNER, replyTo: 2, atMs: 9 })[2];
eq("an owner's reply is stamped", reply.by, OWNER);
eq('and points at what it answers', reply.replyTo, 2);

eq('appending to nothing still works', appendNote(undefined, 'x').length, 1);
eq('appending to a non-array still works', appendNote(null, 'x').length, 1);
ok('a non-finite replyTo is dropped', appendNote([], 'x', { replyTo: NaN })[0].replyTo === undefined);

console.log('\n── Notes: threading ───────────────────────────────────────────');

const thread = threadNotes([
  { text: 'work note', atMs: 10 },
  { text: 'resolution', atMs: 20 },
  { text: 'not fixed', atMs: 30, by: OWNER, replyTo: 20 },
  { text: 'try now', atMs: 40, replyTo: 30 },
]);
eq('two top-level notes', thread.length, 2);
eq('the first has no replies', thread[0].replies.length, 0);
eq('the resolution carries both answers', thread[1].replies.length, 2);
eq('a reply to a reply lands beside its sibling, not under it', thread[1].replies[1].text, 'try now');

const orphan = threadNotes([{ text: 'answers nothing that exists', atMs: 5, replyTo: 999 }]);
eq('an orphaned reply is shown, not dropped', orphan.length, 1);

const cyclic = threadNotes([
  { text: 'a', atMs: 1, replyTo: 2 },
  { text: 'b', atMs: 2, replyTo: 1 },
]);
ok('a cycle in hand-edited data terminates', cyclic.length >= 1);
eq('threading nothing is empty', threadNotes(undefined).length, 0);

console.log('\n── Notes: whose turn it is ────────────────────────────────────');

ok('a ticket whose last word is the owner is awaiting the coder',
  awaitingCoder({ notes: [{ text: 'done', atMs: 1 }, { text: 'no it is not', atMs: 2, by: OWNER }] }));
ok('a ticket answered by the coding side is not',
  !awaitingCoder({ notes: [{ text: 'no it is not', atMs: 1, by: OWNER }, { text: 'try now', atMs: 2 }] }));
ok('nor is one with no notes at all', !awaitingCoder({ notes: [] }));
ok('nor is one with no notes field', !awaitingCoder({}));

console.log('\n── Model: vocabulary and filters ──────────────────────────────');

eq('an unknown type falls back to bug', typeOf('nonsense').id, 'bug');
eq('an unknown status falls back to unresolved', statusOf(undefined).id, 'unresolved');
eq('triage sees every status', filtersFor({ triage: true }).length, 7);
eq('a reporter sees only their own two', filtersFor({ triage: false }).length, 5);
ok('a reporter never sees Paused',
  !filtersFor({ triage: false }).some((f) => f.id === 'paused'));

ok('all matches everything', matchesFilter({ status: 'paused' }, 'all'));
ok('a status chip matches its status', matchesFilter({ status: 'resolved' }, 'resolved'));
ok('a type chip matches its type', matchesFilter({ type: 'idea' }, 'idea'));
ok('a ticket with no status reads as unresolved', matchesFilter({}, 'unresolved'));

eq('short text is left alone', truncate('all good'), 'all good');
ok('long text is cut', truncate('x'.repeat(200)).length <= 81);
ok('a sentence boundary is preferred', truncate(`${'a'.repeat(40)}. ${'b'.repeat(60)}`).endsWith('.'));
eq('an AI summary wins over truncation',
  displayText({ text: 'x'.repeat(200), summary: 'the short version' }), 'the short version');

console.log('\n── Model: what earns a summary ────────────────────────────────');

// Owner ticket S3tDR2qgTmiYEbOPsLZP. The summariser had its own threshold —
// raw length over 90 — while the display cut at 80, so an entry of 81 to 89
// characters was ALWAYS shown chopped and could never earn a summary. Four
// tickets filed in one afternoon landed in that band, which from outside reads
// as the summariser having stopped working. The rule is now the display's own
// question, so the band cannot exist.
ok('a row that fits is not sent', !needsSummary({ text: 'x'.repeat(TRUNCATE_AT) }));
ok('a row one character too long IS sent', needsSummary({ text: 'x'.repeat(TRUNCATE_AT + 1) }));
for (const n of [81, 85, 89, 90]) {
  ok(`the old dead band is closed at ${n} characters`, needsSummary({ text: 'x'.repeat(n) }));
}
ok('a row already carrying a summary is not sent again',
  !needsSummary({ text: 'x'.repeat(200), summary: 'done' }));
ok('an empty ticket is not sent', !needsSummary({ text: '   ' }));
ok('nothing at all is not sent', !needsSummary(undefined));
// Wrapped text measures as the single line it is drawn as, not as its source.
ok('a short entry full of newlines is not sent',
  !needsSummary({ text: 'one\n\n\ntwo\n\n\nthree' }));
ok('everything sent to the summariser would otherwise be shown cut off',
  [90, 120, 400].every((n) => {
    const text = 'x'.repeat(n);
    return needsSummary({ text }) && truncate(text) !== text;
  }));

const seq = sequenceNumbers([
  { id: 'c', status: 'unresolved' },
  { id: 'b', status: 'resolved' },
  { id: 'a', status: 'unresolved' },
]);
eq('the newest entry is the whole log length', seq.get('c').all, 3);
eq('the newest open ticket is #1', seq.get('c').open, 1);
eq('a resolved ticket has no open number', seq.get('b').open, null);
eq('the next open one is #2', seq.get('a').open, 2);

console.log('\n── Hand-off: the id is on every line ──────────────────────────');

const queue = [
  { id: 'abc123', type: 'bug', status: 'unresolved', text: 'the thing broke', createdAtMs: 1 },
  { id: 'def456', type: 'idea', status: 'unresolved', text: 'wouldn\'t it be nice', createdAtMs: 2 },
  { id: 'ghi789', type: 'bug', status: 'resolved', text: 'already done', createdAtMs: 3 },
];
const paste = copyForTeam(queue, { productName: 'Test App' });
ok('the product is named', paste.includes('Test App'));
ok('the first id is on its line', paste.includes('[abc123]'));
ok('the second id is on its line', paste.includes('[def456]'));
ok('a resolved ticket is not in the open list', !paste.includes('ghi789'));
ok('the reader is told what the bracket is', /ticket id/i.test(paste));
eq('an empty queue says so', copyForTeam([], { productName: 'X' }).includes('all clear'), true);

const replied = copyForTeam(
  [{ id: 'zz', type: 'bug', status: 'unresolved', text: 'still broken', createdAtMs: 1,
     notes: [{ text: 'fixed it', atMs: 1 }, { text: 'no you did not', atMs: 2, by: OWNER }] }],
  { productName: 'X' },
);
ok('an unanswered reply travels with its ticket', replied.includes('no you did not'));

const brief = runBrief(queue, {
  productName: 'Test App',
  appVersion: '1.0.0',
  repo: 'someone/thing',
  where: ['the tickets are at some/path'],
  gate: ['run the checks'],
});
ok('the brief names the repo', brief.includes('someone/thing'));
ok('the brief carries the queue', brief.includes('abc123'));
ok('the brief carries where they live', brief.includes('some/path'));
ok('the brief carries the release gate', brief.includes('run the checks'));
ok('the brief warns that notes replace', /notes.*REPLACES|REPLACES.*notes/is.test(brief));
ok('an empty queue reads as clear', runBrief([], {}).includes('queue is clear'));

console.log(
  failures === 0
    ? '\nall checks passed\n'
    : `\n${failures} check${failures === 1 ? '' : 's'} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
