# Primitives owed to aaron-design-system

AGENTS.md's feedback loop: when a surface needs a component the primitives
layer does not have, generalize it, add it to `primitives/primitives.css`, log
it in `primitives/LEDGER.md`, bump the minor version, and only then consume it.

REDBEAM built three things the layer does not have. They are written here in
their generalized form, ready to be pushed, and the app consumes local copies
in `shell/shell.css` in the meantime. That order is backwards from the rule and
it is a debt, not a precedent: the primitive is supposed to ship first.

Requesting surface for all three: **REDBEAM desktop**, 2026-08-28.

---

## 1. `.ads-rail` — the icon rail

**What it is.** A 48px (`--ads-sp-9`) vertical strip of icon buttons that
switch which panel occupies the list pane beside it, plus a bottom-anchored
settings button.

**Why it generalizes.** Archetype D describes "sidebar 200px" as a single
thing, but every productivity app with more than two panel modes splits it: a
rail that picks the mode, a pane that shows it. Without the rail, each panel
needs a tab in a strip that runs out of room at four entries, and the tab strip
competes with the document tabs above it. Any second archetype-D surface with
files-plus-outline-plus-search hits this immediately.

**Anatomy.** `.ads-rail` (flex column, `--ads-bg`, 1px `--ads-line` right
border) › `.ads-rail-btn` (32px square, `--ads-radius-s`, `--ads-ink-3` at
rest, `--ads-inset` on hover). Selected is the system's existing selected-row
recipe — `--ads-inset` fill plus `box-shadow: inset 2px 0 0 var(--ads-accent)`
— with the bar on the rail's outer edge so it reads as "this is the panel open
beside me". `.ads-rail-btn--end` takes `margin-top: auto`.

**Open question for the audit.** Standards/07 sets a 32×32 minimum hit target
for standalone icon buttons and the rail is 48px wide, so the button is
centered with 8px of gutter either side. That is `--ads-sp-2`, which works, but
it is a coincidence rather than a stated relationship.

---

## 2. `.ads-dock` — a floating control dock over a document plane

**What it is.** A row of pill-shaped control groups floating over content
rather than taking a band of layout from it, with declarative collapse tiers.

**Why it generalizes.** Any surface where the content is the point and the
controls are the frame — a map, a drawing, an image editor, a timeline — wants
this, and the alternative is a footer that permanently costs 40px of the axis
the content needs most. It is also the answer to a question the system has not
had to face: standards/05 has `.ads-topbar` for chrome above content and
nothing for chrome *over* content.

**Anatomy.** `.ads-dock` (absolute, `pointer-events: none`, children re-enable
it) › `.ads-dock-group` (`--ads-radius-l`, `--ads-bg`, 1px `--ads-line-2`, the
existing tooltip/popover shadow recipe — a dock floats un-scrimmed over content,
which is exactly what that recipe is for) › `.ads-dock-btn` (32px tall,
`--ads-radius-s`, ink fill when pressed).

**The part worth arguing about.** Collapse is a **container query on the
content box**, not a viewport media query, and items opt in with
`data-collapse="<tier>"`. That means closing a side panel un-collapses the
dock, with no resize listener and no JavaScript at all. REDBEAM uses three
tiers (labels, secondary groups, then a secondary readout). Whether the tier
NAMES belong in the system or stay per-surface is the real design question —
the mechanism generalizes, the specific breakpoints probably do not.

---

## 3. A document-annotation colour register — **a gap, not a primitive**

Standards/02 enumerates the complete colour vocabulary: three surfaces, three
ink steps, four functional colours, three chart series, and an accent that is
ink. Every one of them assumes the mark sits on an `--ads-*` plane.

REDBEAM draws on **white paper** — a rendered PDF the system does not own and
cannot theme — and it draws two kinds of mark there:

- **Estimator-chosen scope colours.** These are data, like a chart series, but
  there are more than three and the user picks them. `--ads-s1..s3` cannot
  serve, and standards/06's "fold or facet past three" has no meaning for a
  takeoff with nine scopes.
- **Tool affordances**: the in-progress draft stroke, selection handles, the
  marquee, snap indicators. These must read against arbitrary drawing content
  in both themes, and the system's answer for "the active thing" — ink — is
  invisible on paper in dark mode and near-invisible on it in light.

REDBEAM currently keeps these as literal hex values in `draw.ts` and `hit.ts`.
That is a fork, and it is logged here rather than quietly fixed because the
right answer is a system decision, not an app one. The question for the
quarterly audit: **does the system want a register for marks on a plane it does
not own?** If it does, the existing dE separation machinery from standards/06
is most of the work — the constraint is separation from *drawing ink*, which is
black, rather than from a known surface token.
