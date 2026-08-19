// ─────────────────────────────────────────────────────────────────────────────
// The panel's stylesheet, scoped to its shadow root.
//
// Two things make this work in both apps without either one maintaining a copy:
//
//   • COLOUR comes only from `--md-sys-color-*` scheme roles. Custom properties
//     inherit THROUGH a shadow boundary, so whatever the host page sets — light,
//     dark, either app's seed — reaches in and the panel follows a theme toggle
//     with no code on either side. There is not one literal colour below except
//     the two shadow rgba()s, which are M3's own elevation shadow.
//   • TYPE is declared here rather than borrowed from a host class. One host has
//     `md-typescale-*` globally and the other has its own token file; neither
//     reaches into a shadow root, so the panel carries the M3 values itself and
//     reads identically in both.
//
// The Material Symbols FONT is loaded by the host document (a <link> in its
// index.html). A loaded font is available inside a shadow root — only the rule
// that applies it needs repeating, which is the .material-symbols-outlined
// block below. If a host has not loaded the font the glyph names render as
// words, which is legible and obviously wrong, rather than as blank boxes.
// ─────────────────────────────────────────────────────────────────────────────

export const PANEL_CSS = `
:host {
  /* The panel is a fixed-position overlay; the host element itself is only a
     mount point and must never take part in page layout. */
  position: fixed;
  inset: 0;
  /* WHERE THIS SITS IN THE HOST'S STACK IS THE HOST'S CALL, and getting it
     wrong makes the panel look broken rather than misplaced: it opens, and is
     painted over by the app's own chrome, so nothing appears to happen.
     That is exactly what a hardcoded value did here — 50 is a sane default for
     an app whose whole scale is two digits, and it buried the panel under a
     host whose navigation rail sits at 8600. Every host with a stacking scale
     of its own must set --buglog-z above its topmost chrome. */
  z-index: var(--buglog-z, 50);
  pointer-events: none;
  font-family: Roboto, system-ui, sans-serif;
  color: var(--md-sys-color-on-surface);
}
:host([hidden]) { display: none; }
.fab, .panel { pointer-events: auto; }

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}

/* ── FAB ──────────────────────────────────────────────────────────────────
   Rests at low opacity so it never competes with the page it floats over,
   and comes to full strength on hover or keyboard focus. */
.fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  opacity: .55;
  transition: opacity .18s ease;
}
.fab:hover, .fab:focus-within { opacity: 1; }
.fab--hidden { opacity: 0; pointer-events: none; }
.fab__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
  font: 600 10px/16px Roboto, system-ui, sans-serif;
  text-align: center;
  pointer-events: none;
}

/* ── Panel ────────────────────────────────────────────────────────────────
   Deliberately NOT a modal dialog: this is a quick-capture tool used while
   looking at whatever it is about, so it must never block the screen behind
   it. No M3 component covers a non-modal utility panel, so it is built from
   scheme roles directly. */
.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  width: min(400px, calc(100vw - 32px));
  max-height: min(560px, calc(100dvh - 32px));
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 16px;
  box-shadow: 0 4px 8px 3px rgba(0, 0, 0, .15), 0 1px 3px rgba(0, 0, 0, .3);
  overflow: hidden;
}
/* Set only once the panel has actually been dragged; until then the anchored
   right/bottom rules above hold it, which cannot drift on a resize. */
.panel--placed { right: auto; bottom: auto; }
.panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
.panel__header--draggable { cursor: grab; touch-action: none; }
.panel__mark { color: var(--md-sys-color-primary); font-size: 20px; }
.panel__title {
  flex: 1;
  min-width: 0;
  font: 500 16px/24px Roboto, system-ui, sans-serif;
  letter-spacing: .15px;
}
.panel__count {
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  font: 400 12px/16px Roboto, system-ui, sans-serif;
  letter-spacing: .4px;
}
.panel__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow-y: auto;
  min-height: 0;
  flex: 1 1 auto;
}
.panel__footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
/* Bottom-right corner grip. A plain resize affordance, drawn as two rules
   rather than an icon so it stays quiet. */
.panel__grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
  background:
    linear-gradient(135deg, transparent 50%, var(--md-sys-color-outline-variant) 50%);
}

/* ── Banners ───────────────────────────────────────────────────────────── */
.banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  font: 400 12px/1.5 Roboto, system-ui, sans-serif;
  letter-spacing: .4px;
}
.banner .material-symbols-outlined { font-size: 18px; flex-shrink: 0; }
.banner--error {
  background: color-mix(in srgb, var(--md-sys-color-error) 14%, var(--md-sys-color-surface-container));
  cursor: pointer;
}
.banner--error .material-symbols-outlined { color: var(--md-sys-color-error); }
.banner--ok {
  background: color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface-container));
}
.banner--ok .material-symbols-outlined { color: var(--md-sys-color-primary); }

/* ── Composer ──────────────────────────────────────────────────────────── */
.add { display: flex; flex-direction: column; gap: 10px; }
.add md-outlined-text-field { width: 100%; }
.add__controls { display: flex; gap: 10px; align-items: center; }
.add__controls md-outlined-select { flex: 1; min-width: 0; }
.add__status {
  color: var(--md-sys-color-on-surface-variant);
  min-height: 1.2em;
  font: 400 12px/16px Roboto, system-ui, sans-serif;
  letter-spacing: .4px;
}
/* Dictation. The live mic pulses in the error role — the one place in either
   app where that colour means "recording", not "something went wrong", and the
   only honest way to make "we are listening to you" impossible to miss. */
.mic--live {
  --md-icon-button-icon-color: var(--md-sys-color-error);
  animation: mic-pulse 1.4s ease-in-out infinite;
}
@keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .mic--live { animation: none; } }

/* Chosen screenshots, before they are uploaded. A thumbnail rather than a
   filename: every phone screenshot is called the same thing, and the picture
   is the only way to tell two of them apart. */
.shots { display: flex; gap: 8px; flex-wrap: wrap; }
.shot {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.shot__x {
  position: absolute;
  top: 1px;
  right: 1px;
  --md-icon-button-icon-size: 14px;
  --md-icon-button-state-layer-width: 22px;
  --md-icon-button-state-layer-height: 22px;
  --md-icon-button-icon-color: var(--md-sys-color-surface);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 55%, transparent);
  border-radius: 999px;
}
.shot__x .material-symbols-outlined { font-size: 14px; }
.attachments { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.attachments a {
  display: block;
  width: 84px;
  height: 84px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
.attachments img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ── List ──────────────────────────────────────────────────────────────── */
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
  font: 400 14px/20px Roboto, system-ui, sans-serif;
  letter-spacing: .25px;
}
/* M3's own dense-list density step: shrink the container and typescale tokens
   rather than hand-rolling CSS, so rows stay real M3 list items. */
.mdlist {
  --md-list-container-color: transparent;
  --md-list-item-top-space: 6px;
  --md-list-item-bottom-space: 6px;
  --md-list-item-label-text-size: 13px;
  --md-list-item-label-text-line-height: 17px;
  --md-list-item-supporting-text-size: 11px;
  --md-list-item-supporting-text-line-height: 15px;
}
.item__type { font-size: 18px; }
.item__type--bug { color: var(--md-sys-color-error); }
.item__type--idea { color: var(--md-sys-color-tertiary); }
.item__type--user { color: var(--md-sys-color-secondary); }
.item__text { white-space: normal; word-break: break-word; }
.item__meta { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.item__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.item__meta--unresolved { color: var(--md-sys-color-error); }
.item__meta--paused { color: var(--md-sys-color-on-surface-variant); }
.item__meta--resolved { color: var(--md-sys-color-primary); }
.item__meta--future { color: var(--md-sys-color-tertiary); }
.item__when { color: var(--md-sys-color-on-surface-variant); }
.item__seq {
  color: var(--md-sys-color-outline);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.item__seq b { color: var(--md-sys-color-on-surface); font-weight: 600; }
.item__flag { color: var(--md-sys-color-tertiary); }
.item__flag--warn { color: var(--md-sys-color-error); }
.item__flag--ok { color: var(--md-sys-color-primary); }
.item__who {
  color: var(--md-sys-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.item__ctx {
  display: block;
  margin-top: 4px;
  color: var(--md-sys-color-outline);
  white-space: normal;
  word-break: break-word;
}

/* ── The note thread ───────────────────────────────────────────────────── */
.note {
  display: block;
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--md-sys-color-outline-variant);
  white-space: normal;
  word-break: break-word;
  color: var(--md-sys-color-on-surface-variant);
}
.note--none { border-left: none; padding-left: 0; }
/* A reply is indented one level and takes the primary rule, so the owner's
   words and the coding side's are told apart at a glance without a second type
   size or any colour outside the scheme. Two levels only — see threadNotes(). */
.note--reply { margin-left: 14px; border-left-color: var(--md-sys-color-primary); }
.note--owner { color: var(--md-sys-color-on-surface); }
.note__body { display: block; }
.note__meta {
  display: block;
  margin-top: 1px;
  color: var(--md-sys-color-outline);
  font: 400 12px/16px Roboto, system-ui, sans-serif;
  letter-spacing: .5px;
}
/* Sits under its note as a quiet affordance, not a call to action: the density
   here is a thread, and a full-height button on every note would out-shout the
   notes themselves. Height stays at the M3 text-button minimum for the target. */
.note__reply {
  margin-top: 2px;
  margin-left: -8px;
  --md-text-button-container-height: 32px;
}

/* ── Inline editors (edit / resolve / reply) ───────────────────────────── */
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
  width: 100%;
}
.editor md-outlined-text-field { width: 100%; }
.editor__buttons { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.editor__hint {
  flex: 1;
  min-width: 0;
  color: var(--md-sys-color-outline);
  font: 400 12px/16px Roboto, system-ui, sans-serif;
  letter-spacing: .4px;
}
.editor__quote {
  white-space: normal;
  color: var(--md-sys-color-on-surface-variant);
  font: 400 12px/1.45 Roboto, system-ui, sans-serif;
}
.editor__label {
  color: var(--md-sys-color-on-surface-variant);
  font: 400 12px/16px Roboto, system-ui, sans-serif;
  letter-spacing: .4px;
}
.editor__group { display: flex; flex-direction: column; gap: 4px; }
.reply { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; width: 100%; }
.reply md-outlined-text-field { width: 100%; }

.item__actions { position: relative; }
.menu__danger {
  --md-menu-item-label-text-color: var(--md-sys-color-error);
}
.menu__danger .material-symbols-outlined { color: var(--md-sys-color-error); }
`;
