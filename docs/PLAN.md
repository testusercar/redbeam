# Build plan

The live tracker is the source of truth for progress:
**https://claude.ai/code/artifact/c1aaba04-09a9-4950-b428-ef6158501e42**

`docs/tracker.html` is a copy of the published page, kept so the plan is in the
repo as well as in the artifact. The artifact is the one that gets updated.

## How it works

- **86 achievables** across four tiers. An achievable is one unit of agent work
  that ends in a verifiable state — roughly the size of the commits already on
  the board.
- Every phase closes on a **milestone you can test yourself**. If you cannot sit
  down and confirm it in a few minutes, the phase is not done.
- **The plan does not change from inside the page.** Achievables are only added
  by editing the source. Status is the only thing the page writes.
- **Off-plan work gets logged.** Anything worked on that is not an achievable is
  recorded, and the count sits in the header — so detours are visible rather
  than absorbed.

## Decisions

Durable calls with their reasoning live in [DECISIONS.md](./DECISIONS.md).
D1 settles undo semantics across windows.

## Working agreement

1. Achievables may run in parallel when their work does not conflict or overlap
   — separate agents on disjoint file sets, against a contract fixed in advance.
   Anything genuinely shared (a Cargo.toml, a barrel file, an entry point) is
   wired by one owner rather than contended. Every achievable in flight is
   marked in progress before work starts, so the tracker shows what is actually
   happening.
2. It is not marked done until its phase's tests pass and `npm run verify` is green.
3. Work that is not on the plan gets logged as off-plan, with a reason — or it
   does not happen.
4. Phase 06 (layout engine) does not start until Phase 05 (golden fixtures) is done.
5. The Qt build stays alive as the oracle until Phase 07 agrees with a real estimator.


### Sub-agents

Default: **I do the work directly.** Length is not a reason to delegate.

A sub-agent is justified only by genuinely parallel, disjoint, long-running
work on separate files — where the alternative is sitting idle. The Phase 03
fan-out (three tool families, three file sets) qualified. Most work does not.

Never delegate anything touching a shared file — the domain barrel, a config,
a module another agent is editing. That is what broke the build mid-session
when an agent relocated `pattern.ts` out from under `index.ts`.

When delegation IS justified, just do it; do not ask first.

## Running the app for verification

Automated runs must not disturb whoever is using the machine:

```bash
REDBEAM_START_MINIMIZED=1 npm run tauri:dev -w @redbeam/desktop
```

Every window — the first one and any project or context window opened later —
starts minimized and does not take focus. Unset, launches behave normally.
Minimized rather than hidden on purpose: a hidden window is absent from the
taskbar too, which makes an automated run indistinguishable from a crashed one.
