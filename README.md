# buglog-core

An in-app bug log — capture, triage, and a two-way note thread — as one native
custom element, shared by two apps built on different frameworks.

## Why it exists

Two apps had grown near-identical bug log panels. One is vanilla DOM built on
`@material/web`; the other is React with its own component wrappers. Because
they could not share a component, they shared a **design document** instead: a
written list of conventions each app implemented for itself.

That failed inside a day. A reply-to-a-note feature was written into both apps
in one sitting, from one spec, by one author — and the two implementations still
came out different. One grew an extra branch in its author-detection; the other
grew an extra field on write.

A document cannot prevent that. It can only record it afterwards.

So the shared thing is the code now, and the substrate is a **native custom
element** — the one thing both apps can host without either changing framework.
It is native in the vanilla-DOM app. React mounts a custom element like any
other tag, so the React app needs one thin wrapper and no rewrite.

## The isolation boundary

The two apps' bug logs live in completely separate databases and must never
touch. That is not enforced by this README — it is enforced by what the package
physically cannot do:

- **It has no dependencies.** Not "does not use a database client" — it has no
  `dependencies` block at all. No import in `src/` resolves outside `src/`.
- **It never loads.** The host assigns `.bugs`, an array it already has.
- **It never saves.** Every action dispatches a `CustomEvent` and stops.
- **It never opens a network connection.** No `fetch`, no `XMLHttpRequest`, no
  `WebSocket`, no `sendBeacon`.

All five are asserted by `npm test` against the source text of every file in
`src/`, so the boundary is a failing build rather than a promise. The only code
that names a collection is each host's own storage adapter, which did not move
here.

Two hosts' logs therefore cannot bleed into each other: nothing in this package
knows either one exists.

## Using it

The panel uses `@material/web` when the host has registered it. When a host has
not, the panel renders compact native controls so capture and triage still work
without loading a second component runtime.

```js
import { defineBuglogPanel } from '@addedlife/buglog-core';

defineBuglogPanel();                    // registers <buglog-panel>
const panel = document.createElement('buglog-panel');
panel.config = { productName: 'My App' };
panel.bugs = [];                        // whatever you already loaded
document.body.append(panel);

panel.addEventListener('buglog:add', (e) => {
  // Answer with a promise and the composer waits for a confirmed write before
  // clearing. Without this it clears optimistically.
  e.detail.result = myStore.add(e.detail);
});
panel.addEventListener('buglog:update', (e) => myStore.update(e.detail.id, e.detail.patch));
panel.addEventListener('buglog:delete', (e) => myStore.remove(e.detail.id));
```

### Events

| Event | `detail` | When |
|---|---|---|
| `buglog:add` | `{ text, type, files }` | Composer submitted. `files` only when attachments are on. |
| `buglog:update` | `{ id, patch }` | Any status change, edit, resolve, or reply. |
| `buglog:delete` | `{ id }` | Delete picked from the row menu. |
| `buglog:run` | `{ brief }` | "Start buglog run" pressed. |
| `buglog:open` / `buglog:close` | — | Panel shown or hidden. |

`buglog:add` and `buglog:update` accept `detail.result = <promise>`; the panel
awaits it before clearing the composer, so a slow or failed write never eats
what was typed.

### Config

Everything is optional, and anything left out is simply off. The defaults are
the smaller of the two panels; each flag below is a feature the larger one has.

| Key | Type | Effect |
|---|---|---|
| `productName` | string | Named in the hand-off text. |
| `appVersion` | string | Enables the "fixed in vX ✓ running" marker with `isNewer`. |
| `triage` | boolean (default `true`) | `false` gives reporter mode: no status control, no hand-off footer, softer vocabulary. |
| `railMode` | boolean | Suppresses the built-in FAB, for a host with its own launcher. |
| `dismissOnOutsideClick` | boolean | Clicking away, or Escape, closes the panel. Escape defers to an open editor first. |
| `draggable` | boolean | Drag by the header, resize from the corner. |
| `sequence` | boolean | Lifetime + open sequence numbers on each row. |
| `reporters` | boolean | Show who filed a ticket, and include it in the paste. |
| `attachments` | boolean | Screenshot paste/picker on the composer, thumbnails on the row. |
| `summarize` | `(items) => Promise<[{id, summary}]>` | Long entries get an AI display summary. Stored text is never rewritten. |
| `startDictation` | `({onPartial,onFinal,onError,onEnd}) => session` | Shows the mic. |
| `cleanTranscript` | `(text) => Promise<string>` | Post-pass over a finished transcript. |
| `verification` | `{ options: [{id,label,blurb}], proven: [id] }` | Resolving also asks how the fix was proven. |
| `runBrief` | `{ repo, where[], gate[] }` | Adds "Start buglog run" to the footer. |
| `isNewer` | `(a, b) => boolean` | Version comparison for the `fixedIn` marker. |

### Stacking — set this, or the panel looks broken

```css
buglog-panel { --buglog-z: 9500; }   /* optional host-specific override */
```

The panel is a fixed overlay and defaults near the top of the browser stacking
range. A host may override the value when it has a documented overlay scale.

### Theming

Colour comes only from `--md-sys-color-*` scheme roles. Custom properties
inherit through a shadow boundary, so the panel follows whatever the host page
sets — including a live theme toggle — with no code on either side.

The Material Symbols **font** is loaded by the host document; a loaded font is
available inside a shadow root, so only the rule that applies it is repeated
here. A host that has not loaded it renders glyph names as words, which is
obviously wrong rather than silently blank.

## The conventions this encodes

Each of these exists because one app hit the problem first:

1. **A ticket id belongs on every hand-off line.** A note, a resolve and a
   status change all address one document by id. A list without ids forces the
   reader to re-fetch the queue just to learn which ticket is which.
2. **Resolving requires a work note, in the UI and not just the CLI.** A ticket
   closed with nothing written on it tells you, a month later, only that
   somebody clicked something.
3. **`notes` is an array and a write REPLACES it.** `appendNote()` is the one
   read-append-resend, with its own test, because getting it wrong once erases
   every note a ticket ever carried.
4. **A resolution note can be answered, and the answer reaches the coding side.**
   Two thread levels, never three. A reply on a resolved ticket reopens it, and
   the button says so. The reply travels in the hand-off text.
5. **Compartmentalization is the whole boundary** — see above.

## Development

```sh
npm test        # plain node, no build and no browser
```

Consumed as a git submodule. After changing anything here, bump the pointer in
each consumer and run that app's own checks — a submodule is a pinned commit,
so no consumer moves until you move it.
