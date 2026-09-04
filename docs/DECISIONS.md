# Decisions

Durable calls, with the reasoning. If you are about to change one of these,
read why it was made first.

---

## D1 — Undo is one chronological stack per project, not per window

**Decided:** 2026-08-27 · **Affects:** 01.6, `packages/store/src/commands.ts`

### The call

One undo stack per **open project**, owned by the Rust core. Every window on
that project shares it. `Ctrl+Z` undoes the most recent edit anywhere in the
project, regardless of which window made it or which window has focus.

### Why, when the industry norm is the opposite

Figma, Google Docs and Bluebeam Studio all give each *user* their own undo
stack. That is correct for them and wrong here, because of a fact specific to
this app: **the multiple windows are one human.** A project window plus its
context windows is one estimator looking at two sheets at once — a detail beside
the plan being measured. There is no second person whose work could be undone
out from under them.

Once that is clear, per-window stacks are actively worse:

- You draw in the context window, switch to the main window, press `Ctrl+Z` —
  and nothing happens. The stack that holds your edit belongs to a window you
  are no longer looking at. That is a bug report waiting to be filed.
- "Undo my last action" is exactly what a single user means by `Ctrl+Z`. With
  one human, a chronological project stack *is* that.
- Per-window stacks admit out-of-order undo: window A edits markup M, window B
  edits M, then A undoes and writes a stale before-image over B's work. A single
  ordered stack cannot produce that sequence.

### What it costs, and what pays for it

The real objection is that `Ctrl+Z` can revert something you cannot currently
see — you are on page 3 and the edit was on page 12. Three requirements make
that acceptable rather than alarming:

1. **The control says what it will undo.** Not "Undo" but "Undo move markup —
   sheet A-514A.00". The label is read before the keystroke, not after.
2. **Undo navigates to its target.** If the affected entity is not visible in
   the focused window, that window goes to it and flashes it. An undo you cannot
   see is the failure mode; showing it is the fix.
3. **Undo broadcasts to every window**, including the one that invoked it — the
   mutation happens in the core, not in a window's local state.

### Guards this decision requires

- **Optimistic concurrency on revert.** `editGeometry.revert` writes an absolute
  before-image. Two windows can still race — a drag in one while the other holds
  stale state. Reverting must check the entity's `updated_at` against what the
  command recorded, and refuse with a clear message rather than clobber. The
  other command types are forgiving by construction (soft deletes; `createMarkup`
  already handles a row that still exists); geometry is not.
- **Pop under the same lock as the write.** Otherwise two windows hitting
  `Ctrl+Z` together pop the same entry twice.
- **Commands become serializable records, not closures.** A `Command` is
  currently `{label, apply(db), revert(db)}` closing over JS values; a core that
  never saw the closure cannot revert it. Each needs persisting as data: op,
  entity id, before-image, after-image.
- **Not `activity`, and not `change_sets`.** `activity` stores human-readable
  detail, not exact before-images — which is precisely why undo is not
  replayable today. `change_sets` is the propose/decide review gate. Undo needs
  its own `undo_log`.

### Excluded: agent-origin commands

Commands with `origin != 'user'` do **not** enter the user's undo stack. An
agent's proposal is reversed by rejecting it at the review gate, which is what
that gate is for. Mixing them means `Ctrl+Z` could revert an accepted proposal
while leaving the `change_sets` decision row asserting a decision whose effect
is gone — an audit trail that lies.

### Scope: the session, not forever

The stack lives as long as the project is open and is cleared when it closes. It
is not replayed across restarts. Undo that reaches back into last week invites
reverting an edit whose context is long gone, and the `activity` table already
covers "what happened" for audit. This is a deliberate limit, not an omission.

### Corrections found while implementing it (2026-08-28)

D1 was written before the code existed and three parts of it were wrong. The
call stands; these are the details.

- **The `updated_at` guard as specified produces false positives on its own
  chain.** Recording the entity's `updated_at` at command time and comparing on
  revert means the *second* Ctrl+Z of a chain refuses itself: the first undo
  legitimately moved `updated_at`, so the entry below now looks stale. Caught by
  a test, not by reading. Every stack operation now re-stamps the log entries
  for that entity, so what is still caught is what D1 actually cares about — a
  write that did not come through the stack.
- **`updated_at` alone is not sufficient.** Two writes in the same millisecond
  share a timestamp, so a peer edit landing in the same millisecond passes the
  check. The real invariant is that the row still holds *this command's own
  after-image*; the timestamp is a cheap prefilter in front of it.
- **"The other commands are forgiving by construction" was incomplete.**
  `reassignScope.revert` writes an absolute previous scope id and has the
  identical clobber hazard — it is guarded now. `setCalibration.revert` also
  writes an absolute previous value and is **not** guarded: calibration is
  page-scoped and there is no per-entity `updated_at` to hang the check on.
  That gap is real and still open.

### Not yet satisfied

D1 requires undo to name and navigate to its target. Three of the six ops —
delete, geometry edit, rescope — carry no document or page in their command
factories, so `undoTarget.pageId` is null for them until the call sites pass a
location. Until then the control can say *what* it will undo but not take you
there.

### Left to judgement, and decided

D1 did not say whether an agent-origin command invalidates the redo branch. It
does not: it is logged with its origin, never popped, and never clears redo. A
batch containing any agent command is treated as agent-origin.

### What would change this call

A second human editing the same project at the same time. If REDBEAM ever grows
real multi-user sessions, per-user stacks with conflict detection become correct
and this decision should be revisited rather than patched.

---

## D2 — Authoring a migration is a write to live client data

**Recorded:** 2026-09-03 · **Affects:** `packages/store/migrations/`, `apps/desktop/src/db.ts`

### What happens

`db.ts` loads the schema with Vite's eager glob:

```ts
const migrationSql = import.meta.glob('../../../packages/store/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
})
```

A running dev instance therefore picks up a NEWLY CREATED `.sql` file over HMR
and applies it to whatever project it currently has open. Not on reload, not on
request — seconds after the file appears.

This is not hypothetical. Both migrations written on 2026-09-03 landed on a
real client database this way: `008_scaleregions.sql` and, about twenty seconds
after it was drafted, `009_scalesource.sql` — against
`00045 - Barclays Toronto`, while the file was still being reviewed. An early
draft of 009 carried `updated_at = datetime('now')`; it was corrected before
the file was committed, but six calibration rows in that project had already
been restamped by the draft. Nothing reads `calibrations.updated_at`, so the
damage was cosmetic. It did not have to be.

### The rule

**Draft a migration outside `packages/store/migrations/` and move it in only
after it has been reviewed.** A scratch directory, a `.sql.txt` suffix,
anywhere the glob does not see. The directory is not a workspace; putting a
file in it is the act of applying it.

### Why it is not "fixed" instead

The glob is right for what it does — the schema has to be in the bundle, and
the browser build has no filesystem to read it from at runtime. The hazard is
not the loader; it is that a DEVELOPMENT instance is routinely pointed at REAL
CLIENT PROJECTS, because that is where the drawings are. Any guard that made
dev refuse to migrate would also make dev unable to open a project that needs
migrating, which is the normal case after any schema change.

The honest mitigation is the process rule above, plus knowing that a dev
instance open on a client folder is a live database and not a sandbox.

### What would change this call

A dev fixture project — a small, disposable set with the same shape as a real
one — that a developer could point at instead. Then the glob could stay and the
blast radius would be a throwaway database. Worth doing; nobody has.

---

## D3 — A shared working tree makes verification lie

**Recorded:** 2026-09-03 · **Affects:** how anything here is verified

### What happens

Several agents and sessions worked one checkout at once on 2026-09-03. Nothing
was lost and the tree ended clean, but three separate wrong conclusions came
out of it, all the same shape: **a working tree with live peers is a snapshot
of everyone's uncommitted state, and reading it as repo state is a category
error.**

- A full suite was run at 16:51 and reported one failure in
  `classnames.test.ts`. It was labelled pre-existing after correctly checking
  that stashing the reader's own changes did not fix it. But the file did not
  exist in ANY commit at that moment — it arrived whole, helper and all, in
  4b187d9. Stashing your own work proves a failure is not YOURS; it proves
  nothing about whose it is.
- `git add -A` swept a peer's in-progress edits into two commits, so the
  report-title fix is recorded inside a harness commit and its tests inside a
  commit about scale-source spelling.
- A migration was reviewed, quoted in a commit message, and found to have been
  corrected by its author between the read and the commit — the file under
  review was still being written.

### The rules

**Stage explicit paths.** `git add <path>`, never `-A` or `commit -a`, whenever
another session may be live in the tree.

**A green suite proves the tree is green, not that your change is good.** When
peers are active, the run includes their unfinished work in both directions: it
can hide your regression and it can invent one.

**Before calling a failure pre-existing, ask whether the file has ever been
committed.** `git log -- <path>` is one command and settles it.

### Why not just forbid concurrent sessions

Because the parallelism was worth it — a UI audit, a bridge extension and two
defect fixes landed together. The cost is that "I ran the tests and they
passed" stops being a claim about the repository, and every verification needs
to say WHICH tree it was made against.
