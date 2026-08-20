// ─────────────────────────────────────────────────────────────────────────────
// <buglog-panel> — the buglog UI, once, for every app that has one.
//
// A native custom element rather than a React component or a bare function,
// because that is the one substrate both consuming apps can host natively: one
// is vanilla DOM built on @material/web's own custom elements, and React mounts
// a custom element like any other tag behind a thin wrapper.
//
// ── THE ISOLATION BOUNDARY, which is the whole point ────────────────────────
//
// This file cannot reach either app's data, and that is structural, not a
// promise anybody has to keep:
//
//   • It imports NOTHING. No firebase, no fetch, no storage client — this
//     package has no dependencies at all, so a cross-project read or write is
//     not a bug that could slip in, it is a thing the code has no path to do.
//   • It never loads. The host sets `.bugs` to an array it already has.
//   • It never saves. Every action dispatches a CustomEvent and stops. Each
//     host's own storage adapter — which did not move when this package was
//     created — remains the only code in that repo naming a collection.
//
// So the two apps' logs cannot bleed into each other: nothing here knows either
// one exists.
//
// ── What the host provides ──────────────────────────────────────────────────
//
//   el.bugs   = [...]            the whole log, newest first
//   el.config = { … }            see README.md; everything optional
//
// ── What the host listens for ───────────────────────────────────────────────
//
//   buglog:add     { text, type, files }        files only when attachments are on
//   buglog:update  { id, patch }                patch is a plain object
//   buglog:delete  { id }
//   buglog:run     { brief }                    only when runBrief is configured
//   buglog:open / buglog:close                  panel visibility changed
//
// `buglog:add` and `buglog:update` may be answered: set `detail.result` to a
// promise and the panel will await it before clearing the composer or closing
// an editor, so a slow or failed write never silently eats what was typed.
// ─────────────────────────────────────────────────────────────────────────────

import { PANEL_CSS } from './styles.js';
import {
  TYPES, STATUSES, typeOf, statusOf, filtersFor, matchesFilter,
  displayText, formatRel, sequenceNumbers,
} from './model.js';
import { OWNER, noteAuthor, noteKey, appendNote, threadNotes, awaitingCoder } from './notes.js';
import { copyForTeam, runBrief } from './handoff.js';

const FALLBACK_TAGS = {
  'md-fab': 'button',
  'md-filled-button': 'button',
  'md-text-button': 'button',
  'md-icon-button': 'button',
  'md-filter-chip': 'button',
  'md-outlined-text-field': 'textarea',
  'md-outlined-select': 'select',
  'md-select-option': 'option',
  'md-chip-set': 'div',
  'md-divider': 'hr',
  'md-list': 'div',
  'md-list-item': 'button',
  'md-menu': 'div',
  'md-menu-item': 'button',
};

const el = (tag, props = {}, ...kids) => {
  const materialReady = !tag.startsWith('md-') || !!customElements.get(tag);
  const actualTag = materialReady ? tag : (FALLBACK_TAGS[tag] || tag);
  const n = document.createElement(actualTag);
  if (!materialReady) {
    n.classList.add('md-fallback', `md-fallback--${tag.slice(3)}`);
    if (tag === 'md-outlined-text-field' && props.label) n.placeholder = props.label;
    if (tag === 'md-filter-chip' && props.label) n.textContent = props.label;
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = `${v}${materialReady ? '' : ` md-fallback md-fallback--${tag.slice(3)}`}`;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
};

const SYMBOLS = {
  bug_report: '!', close: 'x', error: '!', mark_email_read: 'ok',
  add_photo_alternate: '+', stop_circle: 'stop', mic: 'mic',
  person_raised_hand: 'user', lightbulb: 'i', more_vert: '...',
  edit: 'edit', delete: 'x', reply: 'reply', check_circle: 'ok',
  pause_circle: 'pause', content_copy: 'copy', rocket_launch: 'run',
};
const sym = (name, cls = '') =>
  el('span', { class: `buglog-symbol ${cls}`.trim(), text: SYMBOLS[name] || name });

const stop = (e) => e.stopPropagation();

export class BuglogPanel extends HTMLElement {
  #bugs = [];
  #config = {};
  #open = false;
  #filter = 'all';
  #expandedId = null;
  #editId = null;
  // Resolving asks for a note first, the same way every command-line portal
  // does. A ticket closed with nothing written on it tells you, a month later,
  // only that somebody clicked something.
  #resolveId = null;
  #resolveVerified = null;
  // The note being answered, as `${bugId}:${noteAtMs}` — a reply is just
  // another note, so this is the same one-field-at-a-time pattern as resolving
  // rather than a second editing mode.
  #replyKey = null;
  #draftFiles = [];
  #busy = false;
  #banner = null;
  #copied = false;
  #pos = null;
  #size = null;
  #dictation = null;
  #summarized = new Set();
  #root;
  // Working copies of whatever is being typed. Held on the instance rather than
  // read off the DOM so a repaint (a new snapshot arriving, a filter tapped)
  // cannot lose half a sentence.
  #draftText = '';
  #draftType = 'bug';
  #status = '';
  #draftField = null;
  #editText = null;
  #replyText = '';
  #resolveText = '';
  #resolveBtn = null;
  #outside = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.append(el('style', { text: PANEL_CSS }));
  }

  /* ── Host-facing properties ───────────────────────────────────────────── */

  get bugs() { return this.#bugs; }
  set bugs(next) {
    this.#bugs = Array.isArray(next) ? next : [];
    this.#maybeSummarize();
    this.#render();
  }

  get config() { return this.#config; }
  set config(next) {
    this.#config = next && typeof next === 'object' ? next : {};
    this.#render();
  }

  get open() { return this.#open; }
  set open(next) { this.#setOpen(!!next); }

  connectedCallback() { this.#render(); }
  disconnectedCallback() {
    this.#stopDictation();
    this.#unbindOutside();
  }

  /* ── Tap outside to dismiss (opt-in) ──────────────────────────────────────
     Deliberately NOT a full-viewport catcher div, which is the usual way: this
     panel exists to be used WHILE LOOKING AT the thing being reported, so
     blocking scroll and hover on everything behind it would cost more than the
     gesture is worth. A capture-phase document listener gives the same
     dismissal with nothing blocked.

     Nothing is lost by closing: the draft, any open editor and the filter all
     live on the instance, so reopening restores exactly what was there. */

  #bindOutside() {
    if (this.#outside) return;
    const isInside = (e) => {
      // composedPath, not contains: everything in here is inside a shadow root,
      // and e.target for a click on it is the host, which contains() misreads.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      return path.includes(this);
    };
    const onDown = (e) => { if (!isInside(e)) this.#setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Escape belongs to whichever editor is open first.
      if (this.#editId || this.#resolveId || this.#replyKey) return;
      this.#setOpen(false);
    };
    // Deferred a tick: the very pointerdown that opened the panel is still
    // propagating and would otherwise close it again immediately.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    document.addEventListener('keydown', onKey);
    this.#outside = () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }

  #unbindOutside() {
    this.#outside?.();
    this.#outside = null;
  }

  /* ── Config helpers ───────────────────────────────────────────────────── */

  get #triage() { return this.#config.triage !== false; }
  get #unresolved() {
    return this.#bugs.filter((b) => (b.status || 'unresolved') === 'unresolved').length;
  }

  #emit(name, detail = {}) {
    const ev = new CustomEvent(`buglog:${name}`, { detail, bubbles: true, composed: true });
    this.dispatchEvent(ev);
    return ev.detail;
  }

  // Every write goes out as an event and comes back as an optional promise, so
  // a host that answers can make the panel wait for a confirmed save and a host
  // that does not still works synchronously.
  async #send(name, detail) {
    const out = this.#emit(name, detail);
    if (out && typeof out.result?.then === 'function') return out.result;
    return true;
  }

  /* ── Optional AI summaries (host supplies the summarizer) ──────────────── */

  async #maybeSummarize() {
    const summarize = this.#config.summarize;
    if (typeof summarize !== 'function') return;
    const pending = this.#bugs
      .filter((b) => b.id && !b.summary && (b.text || '').trim().length > 90 && !this.#summarized.has(b.id))
      .slice(0, 12);
    if (!pending.length) return;
    for (const b of pending) this.#summarized.add(b.id);
    try {
      const out = await summarize(
        pending.map((b) => ({ id: b.id, kind: b.type === 'idea' ? 'upgrade idea' : 'bug report', source: b.text })),
      );
      for (const row of Array.isArray(out) ? out : []) {
        if (row?.id && row?.summary) this.#send('update', { id: row.id, patch: { summary: row.summary } });
      }
    } catch {
      // A failed pass un-marks its ids so an entry written during an outage is
      // not stuck without a summary forever. Display falls back to truncation,
      // so nothing is blocked either way.
      for (const b of pending) this.#summarized.delete(b.id);
    }
  }

  /* ── Dictation (host supplies the recognizer) ─────────────────────────── */

  #stopDictation() {
    this.#dictation?.session?.stop?.();
    this.#dictation = null;
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  #render() {
    if (!this.isConnected) return;
    for (const node of [...this.#root.children]) if (node.tagName !== 'STYLE') node.remove();
    if (!this.#config.railMode) this.#root.append(this.#renderFab());
    if (this.#open) this.#root.append(this.#renderPanel());
  }

  #renderFab() {
    const n = this.#unresolved;
    const fab = el('md-fab', {
      size: 'small',
      ariaLabel: 'Open bug log',
      title: 'Bug log',
      onclick: () => this.#setOpen(true),
    });
    const ic = sym('bug_report');
    ic.slot = 'icon';
    fab.append(ic);
    return el(
      'div',
      { class: `fab${this.#open ? ' fab--hidden' : ''}` },
      fab,
      n > 0 ? el('span', { class: 'fab__badge', text: String(n) }) : null,
    );
  }

  #setOpen(next) {
    if (this.#open === next) return;
    this.#open = next;
    if (next) {
      if (this.#config.dismissOnOutsideClick) this.#bindOutside();
    } else {
      this.#unbindOutside();
      this.#stopDictation();
      this.#pos = null; // reopens at its anchor, so it never looks randomly placed
    }
    this.#render();
    this.#emit(next ? 'open' : 'close');
  }

  #renderPanel() {
    const draggable = !!this.#config.draggable;
    const style = [
      this.#pos ? `left:${this.#pos.x}px;top:${this.#pos.y}px` : '',
      this.#size ? `width:${this.#size.w}px;height:${this.#size.h}px;max-height:${this.#size.h}px` : '',
    ].filter(Boolean).join(';');

    const panel = el('div', {
      class: `panel${this.#pos ? ' panel--placed' : ''}`,
      style: style || null,
    });

    /* Header — also the drag handle where the host asked for one. */
    const header = el(
      'div',
      { class: `panel__header${draggable ? ' panel__header--draggable' : ''}` },
      sym('bug_report', 'panel__mark'),
      el('span', { class: 'panel__title', text: this.#triage ? 'Bug Log' : 'Report a problem' }),
      el('span', {
        class: 'panel__count',
        text: this.#triage
          ? `${this.#unresolved} open · ${this.#bugs.length} total`
          : this.#bugs.length ? `${this.#bugs.length} sent` : '',
      }),
      el(
        'md-icon-button',
        { ariaLabel: 'Close bug log', onpointerdown: stop, onclick: () => this.#setOpen(false) },
        sym('close'),
      ),
    );
    if (draggable) this.#wireDrag(header, panel);

    const body = el('div', { class: 'panel__body' });
    if (this.#banner) body.append(this.#renderBanner());
    body.append(this.#renderComposer(), this.#renderFilters(), this.#renderList());

    panel.append(header, body, this.#renderFooter());
    if (draggable) panel.append(this.#wireResize(el('div', { class: 'panel__grip' }), panel));
    return panel;
  }

  #renderBanner() {
    const { kind, text } = this.#banner;
    return el(
      'div',
      {
        class: `banner banner--${kind === 'error' ? 'error' : 'ok'}`,
        role: kind === 'error' ? 'alert' : 'status',
        onclick: kind === 'error' ? () => { this.#banner = null; this.#render(); } : null,
      },
      sym(kind === 'error' ? 'error' : 'mark_email_read'),
      el('span', { text, style: 'flex:1;min-width:0' }),
    );
  }

  /* ── Composer ─────────────────────────────────────────────────────────── */

  #renderComposer() {
    const cfg = this.#config;
    const wrap = el('div', { class: 'add' });

    const field = el('md-outlined-text-field', {
      label: this.#triage ? 'Jot a bug or idea…' : 'Describe what went wrong, or what would help…',
      value: this.#draftText || '',
      oninput: (e) => { this.#draftText = e.target.value; },
      onkeydown: (e) => {
        stop(e);
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#submitDraft(); }
      },
      onpaste: cfg.attachments
        ? (e) => {
            // A pasted screenshot is the common case on a PC and never reaches
            // a file picker, so the field takes it directly.
            const files = [...(e.clipboardData?.files || [])];
            if (files.length) { e.preventDefault(); this.#addFiles(files); }
          }
        : null,
    });
    this.#draftField = field;
    wrap.append(field);

    if (this.#draftFiles.length) {
      wrap.append(
        el('div', { class: 'shots' }, ...this.#draftFiles.map((row, i) =>
          el(
            'div',
            { class: 'shot' },
            el('img', { src: row.previewUrl, alt: row.file.name }),
            el(
              'md-icon-button',
              {
                class: 'shot__x',
                title: `Remove ${row.file.name}`,
                ariaLabel: `Remove ${row.file.name}`,
                onclick: () => this.#removeFile(i),
              },
              sym('close'),
            ),
          ),
        )),
      );
    }

    const controls = el('div', { class: 'add__controls' });

    if (typeof cfg.startDictation === 'function') controls.append(this.#renderMic());

    if (cfg.attachments) {
      const picker = el('input', {
        type: 'file',
        accept: 'image/*',
        multiple: true,
        style: 'display:none',
        onchange: (e) => { this.#addFiles([...(e.target.files || [])]); e.target.value = ''; },
      });
      controls.append(
        picker,
        el(
          'md-icon-button',
          { title: 'Add a screenshot', ariaLabel: 'Add a screenshot', onclick: () => picker.click() },
          sym('add_photo_alternate'),
        ),
      );
    }

    const select = el('md-outlined-select', {
      label: 'Type',
      value: this.#draftType || 'bug',
      onchange: (e) => { this.#draftType = e.target.value; },
    });
    for (const t of TYPES) {
      const opt = el('md-select-option', { value: t.id, selected: (this.#draftType || 'bug') === t.id });
      opt.append(el('div', { slot: 'headline', text: t.label }));
      select.append(opt);
    }
    controls.append(select);

    controls.append(
      el('md-filled-button', {
        text: this.#busy ? 'Saving…' : this.#triage ? 'Add' : 'Send',
        disabled: this.#busy,
        onclick: () => this.#submitDraft(),
      }),
    );

    wrap.append(controls, el('span', { class: 'add__status', text: this.#status || '' }));
    return wrap;
  }

  #renderMic() {
    const live = !!this.#dictation?.session;
    const btn = el(
      'md-icon-button',
      {
        class: live ? 'mic--live' : '',
        title: live ? 'Stop dictating' : 'Dictate',
        ariaLabel: 'Dictate a bug or idea',
        disabled: this.#dictation?.cleaning === true,
        onclick: () => (live ? this.#stopDictation() : this.#startDictation()),
      },
      sym(live ? 'stop_circle' : 'mic'),
    );
    return btn;
  }

  #startDictation() {
    const start = this.#config.startDictation;
    const clean = this.#config.cleanTranscript;
    if (typeof start !== 'function') return;
    const base = (this.#draftText || '').trim();
    this.#dictation = { session: null, cleaning: false };
    const setText = (t) => {
      this.#draftText = t;
      if (this.#draftField) this.#draftField.value = t;
    };
    this.#status = 'Listening…';
    const session = start({
      onPartial: (text) => setText(base ? `${base} ${text}` : text),
      onFinal: async (raw) => {
        const joined = base ? `${base} ${raw}` : raw;
        setText(joined);
        if (typeof clean !== 'function') return;
        this.#dictation = { session: null, cleaning: true };
        this.#status = 'Tidying up the transcript…';
        this.#render();
        let cleaned = joined;
        try { cleaned = await clean(joined); } catch { /* raw transcript stands */ }
        // Only overwrite if nothing has been typed over it since.
        if ((this.#draftText || '') === joined) setText(cleaned);
        this.#dictation = null;
        this.#status = '';
        this.#render();
      },
      onError: (message) => { this.#status = message; this.#render(); },
      onEnd: () => {
        // A cleanup pass may still own the status line; leave it alone.
        if (this.#dictation?.cleaning) return;
        this.#dictation = null;
        this.#render();
      },
    });
    if (!session) { this.#dictation = null; this.#status = ''; }
    else this.#dictation.session = session;
    this.#render();
  }

  #addFiles(list) {
    const picked = list.filter((f) => f && /^image\//i.test(f.type) && f.size < 12 * 1024 * 1024);
    if (!picked.length) return;
    this.#draftFiles = [
      ...this.#draftFiles,
      ...picked.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ].slice(0, 6);
    this.#render();
  }

  #removeFile(i) {
    const row = this.#draftFiles[i];
    // Each object URL pins its blob in memory until released, and a screenshot
    // is a few megabytes.
    if (row) { try { URL.revokeObjectURL(row.previewUrl); } catch { /* already gone */ } }
    this.#draftFiles = this.#draftFiles.filter((_, j) => j !== i);
    this.#render();
  }

  // The draft survives until the write is CONFIRMED. Clearing it up front lost
  // the typed text for good whenever a write was slow or failed — five minutes
  // of typing gone with only a console warning nobody sees.
  async #submitDraft() {
    if (this.#busy) return;
    this.#stopDictation();
    const text = (this.#draftText || '').trim();
    if (!text) return;
    this.#busy = true;
    this.#status = 'Saving…';
    this.#render();
    const files = this.#draftFiles.map((r) => r.file);
    try {
      await this.#send('add', { text, type: this.#draftType || 'bug', files });
      this.#draftText = '';
      for (const r of this.#draftFiles) { try { URL.revokeObjectURL(r.previewUrl); } catch { /* already gone */ } }
      this.#draftFiles = [];
      this.#status = '';
    } catch {
      this.#status = 'Could not save — still here, try again.';
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  /* ── Filters ──────────────────────────────────────────────────────────── */

  #renderFilters() {
    const set = el('md-chip-set');
    for (const f of filtersFor({ triage: this.#triage })) {
      set.append(
        el('md-filter-chip', {
          label: f.label,
          selected: this.#filter === f.id,
          // A chip toggles itself off on a second tap; "all" is the resting
          // state, so an unselected chip means every ticket rather than none.
          onclick: () => { this.#filter = this.#filter === f.id ? 'all' : f.id; this.#render(); },
        }),
      );
    }
    return set;
  }

  /* ── List ─────────────────────────────────────────────────────────────── */

  #renderList() {
    const visible = this.#bugs.filter((b) => matchesFilter(b, this.#filter));
    if (!visible.length) {
      return el('div', {
        class: 'empty',
        text: this.#bugs.length
          ? 'Nothing matches this filter.'
          : 'No entries yet — jot your first one above.',
      });
    }
    const seq = this.#config.sequence ? sequenceNumbers(this.#bugs) : null;
    const list = el('md-list', { class: 'mdlist' });
    for (const b of visible) {
      if (this.#resolveId === b.id) list.append(this.#renderResolve(b));
      else if (this.#editId === b.id) list.append(this.#renderEdit(b));
      else list.append(this.#renderItem(b, seq));
    }
    return list;
  }

  #renderItem(b, seq) {
    const t = typeOf(b.type);
    const s = statusOf(b.status);
    const expanded = this.#expandedId === b.id;
    const notes = Array.isArray(b.notes) ? b.notes : [];
    const fromUser = b.source === 'user';

    const item = el('md-list-item', {
      type: 'button',
      title: expanded ? null : b.text,
      onclick: () => { this.#expandedId = expanded ? null : b.id; this.#render(); },
    });

    const lead = sym(fromUser ? 'person_raised_hand' : t.icon,
      `item__type item__type--${fromUser ? 'user' : t.id}`);
    lead.slot = 'start';
    lead.title = fromUser ? `${t.label} — reported by a user` : t.label;

    const headline = el('div', {
      slot: 'headline',
      class: 'item__text',
      text: expanded ? b.text : displayText(b),
    });

    const support = el('div', { slot: 'supporting-text' });
    const meta = el('span', { class: `item__meta item__meta--${b.status || 'unresolved'}` });

    if (seq) {
      const n = seq.get(b.id);
      if (n) {
        const tag = el('span', {
          class: 'item__seq',
          title: n.open
            ? `Open ticket #${n.open} of ${this.#unresolved} · entry ${n.all} of ${this.#bugs.length} in the whole log`
            : `Entry ${n.all} of ${this.#bugs.length} in the whole log`,
        });
        if (n.open) tag.append(el('b', { text: `${n.open} ` }));
        tag.append(document.createTextNode(`[${n.all}]`));
        meta.append(tag);
      }
    }

    // "Unresolved" is triage vocabulary and on a reporter's own copy it also
    // misleads — it reads as though nobody has it, when the point is somebody does.
    meta.append(
      el('span', { class: 'item__dot' }),
      document.createTextNode(this.#triage ? s.label : 'Sent to developer'),
    );

    const pending = awaitingCoder(b);
    const bits = [formatRel(b.createdAtMs)];
    if (!expanded && notes.length && !pending) bits.push(`${notes.length} note${notes.length === 1 ? '' : 's'}`);
    meta.append(el('span', { class: 'item__when', text: ` · ${bits.join(' · ')}` }));

    if (fromUser && (b.reporter?.name || b.reporter?.email)) {
      meta.append(el('span', {
        class: 'item__who',
        title: `Reported by ${b.reporter.email || b.reporter.name}`,
        text: ` · ${b.reporter.name || b.reporter.email}`,
      }));
    }
    // A reply nobody has answered is the one thing here waiting on somebody.
    if (pending) {
      meta.append(el('span', {
        class: 'item__flag',
        title: 'Replied to, and not answered yet',
        text: ' · awaiting reply',
      }));
    }
    // A fix in a version you are not running looks exactly like a fix that
    // never happened. Saying which version, and whether this copy has it,
    // is what removes that confusion.
    if (b.fixedIn && this.#config.appVersion) {
      const stale = this.#config.isNewer?.(b.fixedIn, this.#config.appVersion);
      meta.append(el('span', {
        class: `item__flag item__flag--${stale ? 'warn' : 'ok'}`,
        title: `Fixed in v${b.fixedIn} · you are running v${this.#config.appVersion}`,
        text: stale ? ` · fixed in v${b.fixedIn} — reload to get it` : ` · fixed in v${b.fixedIn} ✓ running`,
      }));
    }
    // How the closure was proven. A ticket closed after watching the symptom go
    // and one closed after reading the code look identical a month later.
    const vb = this.#config.verification;
    if (vb && (b.status || '') === 'resolved') {
      const hit = vb.options?.find((v) => v.id === b.verifiedBy);
      meta.append(el('span', {
        class: `item__flag item__flag--${hit && vb.proven?.includes(hit.id) ? 'ok' : 'warn'}`,
        title: hit?.blurb || 'Closed before this was recorded, or closed without saying how.',
        text: ` · ${(hit?.label || 'unverified').toLowerCase()}`,
      }));
    }
    support.append(meta);

    if (expanded) {
      if (notes.length) {
        for (const { note: n, replies } of threadNotes(notes)) {
          support.append(this.#renderNote(b, n, false));
          for (const r of replies) support.append(this.#renderNote(b, r, true));
        }
      } else {
        support.append(el('span', { class: 'note note--none', text: 'No work notes yet.' }));
      }
      const shots = Array.isArray(b.attachments) ? b.attachments.filter((a) => a?.url) : [];
      if (shots.length) {
        support.append(
          el('span', { class: 'attachments' }, ...shots.map((a) =>
            el(
              'a',
              {
                href: a.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: `Open ${a.name || 'screenshot'} full size`,
                onclick: stop,
              },
              el('img', { src: a.url, alt: a.name || 'screenshot' }),
            ),
          )),
        );
      }
      // Everything needed to reproduce it, on the ticket itself.
      if (fromUser) {
        support.append(el('span', {
          class: 'item__ctx',
          text: `Reported by ${b.reporter?.email || 'a user'}` +
            `${b.context?.appVersion ? ` · v${b.context.appVersion}` : ''}` +
            `${b.context?.userAgent ? ` · ${b.context.userAgent}` : ''}`,
        }));
      }
    }

    const end = el('div', { slot: 'end', class: 'item__actions', onclick: stop });
    end.append(...this.#renderMenu(b));
    item.append(lead, headline, support, end);
    return item;
  }

  #renderMenu(b) {
    const btn = el('md-icon-button', { ariaLabel: 'Ticket actions' }, sym('more_vert'));
    const menu = el('md-menu', { positioning: 'popover' });
    const nativeFallback = menu.classList.contains('md-fallback');
    if (nativeFallback) menu.hidden = true;
    btn.addEventListener('click', () => {
      menu.anchorElement = btn;
      menu.open = !menu.open;
      if (nativeFallback) menu.hidden = !menu.open;
    });

    const mi = (icon, label, onPick, danger = false) => {
      const item = el('md-menu-item', { class: danger ? 'menu__danger' : '', onclick: onPick });
      const ic = sym(icon);
      ic.slot = 'start';
      item.append(ic, el('div', { slot: 'headline', text: label }));
      return item;
    };

    // Status is the developer's call, not a reporter's — someone marking their
    // own bug "Resolved" says nothing true about whether it was fixed.
    if (this.#triage) {
      for (const st of STATUSES) {
        menu.append(mi(st.icon, st.label, () => {
          // Resolving goes through the note composer rather than writing straight
          // through, so a closure always carries an account of what was done.
          if (st.id === 'resolved') {
            this.#resolveId = b.id;
            this.#resolveVerified = null;
            this.#expandedId = b.id;
            this.#render();
            return;
          }
          this.#send('update', { id: b.id, patch: { status: st.id } });
        }));
      }
      menu.append(el('md-divider'));
    }
    menu.append(mi('edit', 'Edit text', () => {
      this.#editId = b.id;
      this.#expandedId = b.id;
      this.#render();
    }));
    if (this.#triage) {
      menu.append(mi('swap_horiz', `Make ${b.type === 'bug' ? 'an idea' : 'a bug'}`, () =>
        this.#send('update', { id: b.id, patch: { type: b.type === 'bug' ? 'idea' : 'bug' } })));
    }
    menu.append(el('md-divider'));
    menu.append(mi('delete', this.#triage ? 'Delete' : 'Remove from my list',
      () => this.#send('delete', { id: b.id }), true));
    return [btn, menu];
  }

  // One note in the thread — the coding side's, or the owner's answer to it.
  // Replies are indented and marked with who wrote them, because the whole
  // point is that a resolution note and the response to it are two different
  // people's words and must not read as one voice.
  #renderNote(b, n, isReply) {
    const mine = noteAuthor(n) === OWNER;
    const wrap = el('span', {
      class: `note${isReply ? ' note--reply' : ''}${mine ? ' note--owner' : ''}`,
    });
    wrap.append(
      el('span', { class: 'note__body', text: n.text }),
      el('span', {
        class: 'note__meta',
        text: `${mine ? 'You' : 'Coding side'}${n.atMs ? ` · ${formatRel(n.atMs)}` : ''}`,
      }),
    );
    const key = noteKey(n);
    // A note with no time on it has nothing for a reply to point at, so it
    // carries no Reply button rather than one that would produce an orphan.
    if (key == null) return wrap;
    if (this.#replyKey === `${b.id}:${key}`) {
      wrap.append(this.#renderReplyField(b, key));
      return wrap;
    }
    wrap.append(el('md-text-button', {
      class: 'note__reply',
      text: 'Reply',
      onclick: (e) => {
        // The row itself toggles expansion on click; without this, opening the
        // reply field would collapse the ticket underneath it.
        stop(e);
        this.#replyKey = `${b.id}:${key}`;
        this.#replyText = '';
        this.#expandedId = b.id;
        this.#render();
      },
    }));
    return wrap;
  }

  // Replying to a RESOLVED ticket reopens it. A response to "here is what was
  // done" is in practice "this is not done", and the coding side's queue IS the
  // unresolved list — a reply that left the ticket closed would sit in a panel
  // where nothing reads it. The button says so rather than doing it quietly.
  #renderReplyField(b, key) {
    const wasResolved = (b.status || 'unresolved') === 'resolved';
    const box = el('span', { class: 'reply', onclick: stop });
    const field = el('md-outlined-text-field', {
      type: 'textarea',
      rows: 2,
      label: 'Your reply',
      value: this.#replyText || '',
      oninput: (e) => { this.#replyText = e.target.value; },
      onkeydown: (e) => {
        // md-list treats bubbled Arrow/Home/End keydowns as item navigation,
        // which yanks focus out of the box mid-sentence.
        stop(e);
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
    });
    const close = () => { this.#replyKey = null; this.#replyText = ''; this.#render(); };
    const commit = () => {
      const text = (this.#replyText || '').trim();
      if (!text) return;
      const patch = { notes: appendNote(b.notes, text, { by: OWNER, replyTo: key }) };
      if (wasResolved) patch.status = 'unresolved';
      this.#send('update', { id: b.id, patch });
      close();
    };
    box.append(
      field,
      el(
        'span',
        { class: 'editor__buttons' },
        el('md-text-button', { text: 'Cancel', onclick: close }),
        el('md-filled-button', { text: wasResolved ? 'Reply & reopen' : 'Reply', onclick: commit }),
      ),
    );
    requestAnimationFrame(() => field.focus?.());
    return box;
  }

  #renderEdit(b) {
    const item = el('md-list-item');
    const wrap = el('div', { slot: 'headline', class: 'editor' });
    const close = () => { this.#editId = null; this.#editText = null; this.#render(); };
    const commit = () => {
      const text = (this.#editText ?? b.text ?? '').trim();
      if (!text) return;
      // Any stale AI summary is cleared so the row re-summarizes from the new
      // wording rather than keeping a description of text that no longer exists.
      this.#send('update', { id: b.id, patch: { text, summary: null } });
      this.#summarized.delete(b.id);
      close();
    };
    const field = el('md-outlined-text-field', {
      type: 'textarea',
      rows: 3,
      label: 'Edit entry',
      value: this.#editText ?? b.text ?? '',
      oninput: (e) => { this.#editText = e.target.value; },
      onkeydown: (e) => {
        stop(e);
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
    });
    wrap.append(
      field,
      el(
        'div',
        { class: 'editor__buttons' },
        el('md-text-button', { text: 'Cancel', onclick: close }),
        el('md-filled-button', { text: 'Save', onclick: commit }),
      ),
    );
    item.append(wrap);
    return item;
  }

  // `notes` is an array and Firestore has no array append — a write REPLACES
  // the field — so appendNote() re-sends the existing notes with the new one.
  // Same semantics as every command-line portal, so a ticket closed from the
  // app and one closed from a coding session read identically.
  #renderResolve(b) {
    const vb = this.#config.verification;
    const item = el('md-list-item');
    const wrap = el('div', { slot: 'headline', class: 'editor' });
    const close = () => {
      this.#resolveId = null;
      this.#resolveText = null;
      this.#resolveVerified = null;
      this.#render();
    };
    const ready = () =>
      (this.#resolveText || '').trim().length >= 4 && (!vb || !!this.#resolveVerified);
    const commit = () => {
      if (!ready()) return;
      const text = (this.#resolveText || '').trim();
      const patch = { status: 'resolved', notes: appendNote(b.notes, text) };
      if (vb && this.#resolveVerified) {
        // Stamped on the ticket as well as the note: the note records how THIS
        // closure was proven, the ticket carries the latest, which is what a
        // filter and an audit read.
        patch.verifiedBy = this.#resolveVerified;
        patch.verifiedAtMs = Date.now();
      }
      this.#send('update', { id: b.id, patch });
      close();
    };

    const lead = sym('check_circle');
    lead.slot = 'start';
    lead.title = 'Resolving';

    wrap.append(
      el('span', { class: 'editor__quote', text: displayText(b) }),
      el('md-outlined-text-field', {
        type: 'textarea',
        rows: 3,
        label: 'What was done? (required to resolve)',
        placeholder: 'One or two plain sentences: what was wrong, what you will see now.',
        value: this.#resolveText || '',
        oninput: (e) => { this.#resolveText = e.target.value; this.#syncResolveReady(); },
        onkeydown: (e) => {
          stop(e);
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        },
      }),
    );

    // How do you know it is fixed? Chips rather than a select, because the
    // answers should all be readable at once — the point is to notice when you
    // are about to pick the weak one. No default: the value of the field is
    // that somebody had to answer it, and a default is an answer nobody gave.
    if (vb?.options?.length) {
      const group = el('div', { class: 'editor__group' });
      group.append(el('span', { class: 'editor__label', text: 'How do you know?' }));
      const set = el('md-chip-set', { style: 'flex-wrap:wrap' });
      for (const v of vb.options) {
        set.append(el('md-filter-chip', {
          label: v.label,
          title: v.blurb,
          selected: this.#resolveVerified === v.id,
          onclick: () => {
            this.#resolveVerified = this.#resolveVerified === v.id ? null : v.id;
            this.#render();
          },
        }));
      }
      group.append(set);
      const hit = vb.options.find((v) => v.id === this.#resolveVerified);
      if (hit) group.append(el('span', { class: 'editor__hint', text: hit.blurb }));
      wrap.append(group);
    }

    const saveBtn = el('md-filled-button', { text: 'Resolve', disabled: !ready(), onclick: commit });
    this.#resolveBtn = saveBtn;
    wrap.append(
      el(
        'div',
        { class: 'editor__buttons' },
        el('span', { class: 'editor__hint', text: 'This note is what the ticket shows from now on.' }),
        el('md-text-button', { text: 'Cancel', onclick: close }),
        saveBtn,
      ),
    );
    item.append(lead, wrap);
    return item;
  }

  // Toggling `disabled` in place rather than re-rendering: a full repaint on
  // every keystroke would rebuild the textarea and drop the caret.
  #syncResolveReady() {
    const vb = this.#config.verification;
    if (!this.#resolveBtn) return;
    this.#resolveBtn.disabled =
      (this.#resolveText || '').trim().length < 4 || (!!vb && !this.#resolveVerified);
  }

  /* ── Footer ───────────────────────────────────────────────────────────── */

  #renderFooter() {
    const foot = el('div', { class: 'panel__footer' });
    if (!this.#triage) {
      foot.append(el('span', { class: 'editor__hint', text: 'These go straight to the developer.' }));
      return foot;
    }
    const n = this.#unresolved;
    const copy = el('md-text-button', {
      disabled: n === 0,
      onclick: () => {
        const text = copyForTeam(this.#bugs, {
          productName: this.#config.productName || 'this app',
          includeReporter: !!this.#config.reporters,
        });
        navigator.clipboard?.writeText(text).catch(() => {});
        this.#copied = true;
        this.#render();
        setTimeout(() => { this.#copied = false; this.#render(); }, 1800);
      },
    });
    const ic = sym('content_copy');
    ic.slot = 'icon';
    copy.append(ic, el('span', { text: this.#copied ? 'Copied!' : `Copy for coding team${n ? ` (${n})` : ''}` }));
    foot.append(copy);

    // Hands an agent a complete job rather than a readable list: where the
    // queue is, what a finished ticket looks like, and every open ticket in
    // full with its id.
    if (this.#config.runBrief) {
      const run = el('md-text-button', {
        onclick: () => {
          const brief = runBrief(this.#bugs, {
            productName: this.#config.productName || 'this app',
            appVersion: this.#config.appVersion || '',
            ...this.#config.runBrief,
          });
          navigator.clipboard?.writeText(brief).catch(() => {});
          this.#emit('run', { brief });
        },
      });
      const ric = sym('rocket_launch');
      ric.slot = 'icon';
      run.append(ric, el('span', { text: 'Start buglog run' }));
      foot.append(run);
    }
    return foot;
  }

  /* ── Drag / resize (opt-in) ───────────────────────────────────────────── */

  #wireDrag(handle, panel) {
    let d = null;
    handle.addEventListener('pointerdown', (e) => {
      const r = panel.getBoundingClientRect();
      d = { ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height };
      try { handle.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!d) return;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      this.#pos = {
        x: clamp(e.clientX - d.ox, 4, window.innerWidth - d.w - 4),
        y: clamp(e.clientY - d.oy, 4, window.innerHeight - d.h - 4),
      };
      panel.classList.add('panel--placed');
      panel.style.left = `${this.#pos.x}px`;
      panel.style.top = `${this.#pos.y}px`;
    });
    const end = (e) => {
      d = null;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  #wireResize(grip, panel) {
    let d = null;
    grip.addEventListener('pointerdown', (e) => {
      stop(e);
      const r = panel.getBoundingClientRect();
      d = { sx: e.clientX, sy: e.clientY, w: r.width, h: r.height };
      try { grip.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    });
    grip.addEventListener('pointermove', (e) => {
      if (!d) return;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      this.#size = {
        w: clamp(d.w + (e.clientX - d.sx), 300, Math.min(900, window.innerWidth - 24)),
        h: clamp(d.h + (e.clientY - d.sy), 280, Math.min(900, window.innerHeight - 24)),
      };
      panel.style.width = `${this.#size.w}px`;
      panel.style.height = `${this.#size.h}px`;
      panel.style.maxHeight = `${this.#size.h}px`;
    });
    const end = (e) => {
      d = null;
      try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    return grip;
  }
}

/** Register the element. Safe to call more than once. */
export function defineBuglogPanel(tag = 'buglog-panel') {
  if (!customElements.get(tag)) customElements.define(tag, BuglogPanel);
  return tag;
}
