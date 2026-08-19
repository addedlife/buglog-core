# buglog-core

The buglog panel, written once, used by RabbiMetrics and Shamash Pro 4.

> Buglog ticket `lJEtZlwwIS76Uo3p0f6i`: "This buglog clones the shamash pro
> buglog, but for a completely separate app. That buglog has undergone
> extensive improvements that aren't mirrored. So create one design portal for
> buglogs that's pulled by both apps, just design, data remains
> compartmentalized."

The first answer to that ticket was a shared **document** (`BUGLOG-DESIGN.md`),
on the reasoning that the two apps are different frameworks and so could share
conventions but not code. That reasoning was right about the frameworks and
wrong about the conclusion, and it failed in practice within a day: the
reply-to-a-note feature was written into both apps in one sitting, from one
spec, and the two copies came out different anyway — `noteAuthor` grew an extra
branch in one, `appendNote` grew an extra field in the other.

A document cannot stop that. It can only record it afterwards.

So the shared thing is now the code, and the substrate is a **native custom
element** — the one thing both apps can host without either changing framework.
RabbiMetrics is vanilla DOM built on `@material/web`'s own custom elements, so
this is native there. React mounts a custom element like any other tag, so
Shamash needs one thin wrapper and no rewrite.

## The isolation boundary

The ticket says "data remains compartmentalized," and that is not enforced by
this README. It is enforced by what the package physically cannot do:

- **It has no dependencies.** Not "does not use firebase" — has no `dependencies`
  block at all. There is no import in `src/` that resolves outside `src/`.
- **It never loads.** The host assigns `.bugs`, an array it already has.
- **It never saves.** Every action dispatches a `CustomEvent` and stops.
- **It never opens a network connection.** No `fetch`, no `XMLHttpRequest`, no
  `WebSocket`, no `sendBeacon`.

All five of those are asserted by `npm test` against the source text of every
file in `src/`, so the boundary is a failing build rather than a broken promise.
The only code in either repo that names a Firestore collection is that app's own
adapter — `src/data/bugStore.js` in RabbiMetrics, `Store` in Shamash — and
neither of those moved here.

Two apps' logs therefore cannot bleed into each other: nothing in this package
knows either one exists.

## Using it

The host must already have `@material/web` registered — this package uses the
`md-*` tags but deliberately does not import them, because two copies of
`@material/web` in one page would try to define the same custom elements twice
and throw.

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

Everything is optional. Anything left out is simply off — the defaults are
RabbiMetrics's panel, and each flag below is a Shamash feature the smaller app
deliberately does not have.

| Key | Type | Effect |
|---|---|---|
| `productName` | string | Named in the hand-off text. |
| `appVersion` | string | Enables the "fixed in vX ✓ running" marker with `isNewer`. |
| `triage` | boolean (default `true`) | `false` gives reporter mode: no status control, no hand-off footer, softer vocabulary. |
| `railMode` | boolean | Suppresses the built-in FAB, for a host with its own launcher. |
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

### Theming

Colour comes only from `--md-sys-color-*` scheme roles. Custom properties
inherit through a shadow boundary, so the panel follows whatever the host page
sets — including a live theme toggle — with no code on either side.

The Material Symbols **font** is loaded by the host document; a loaded font is
available inside a shadow root, so only the rule that applies it is repeated
here. A host that has not loaded it renders glyph names as words, which is
obviously wrong rather than silently blank.

## The conventions this encodes

These are the rules that used to live only in `BUGLOG-DESIGN.md`, each one
because one app hit the problem first:

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
npm test        # 105 assertions, plain node, no build and no browser
```

Consumed by both apps as a git submodule. After changing anything here, bump
the pointer in each consumer and run that app's own checks — a submodule is a
pinned commit, so neither app moves until you move it.
