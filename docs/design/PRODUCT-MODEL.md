# User-defined products: the common denominator

*Proposal, 2026-09-18. Aaron asked: "think about how to build a system where
the user can create products. How do we create a common denominator for
products that can let people make different product types in the UI?"*

Nothing here is built. It is the design, with the seams it would be built
along, so the decision can be made on the shape rather than on a screen.

## 1. What a product is, once the six are laid side by side

REDBEAM has six product types, each a branch of `calculatePieces` with its
own inputs, its own layout call and its own list of quantities. Written out
as data rather than code, they are the same sentence with different words:

| Product | Measured as | Laid out as | Primary stock | Its size | Parts that follow |
|---|---|---|---|---|---|
| Panels | area | a grid of modules | panels | W × L | trim per edge |
| Planks | area | parallel runs at a pitch | planks | width, stock length | carrier rails per rail line; trim per edge |
| Baffles | area | parallel runs at a pitch | baffle stock | profile, stock length | rails per connector line; connectors per connector; joiners per joint; end caps per piece |
| Cassettes | area | a grid of modules | cassettes | Cassette W × baffle length | baffles per module; end caps per baffle; trim per edge |
| Linear parts | length | segments along a line | parts | part length | (ordered length, offcut as detail) |
| Custom assembly | area · length · count | none | — | — | — |

Every product answers five questions, and the answers come from a small
fixed vocabulary:

1. **What is measured** — area, length or count. This is the scope's
   `scopeType`, and it already exists.
2. **How the material is laid out** — one of four *layout strategies*:
   `grid` (modules of W × L on a direction), `runs` (parallel pieces at a
   pitch on a direction, cut from stock), `segments` (pieces along a drawn
   line, cut from stock), or `none` (quantified by hand).
3. **What the primary stock is** — its name, its unit, and the dimensions
   the strategy needs (a grid needs W and L; runs need a pitch, a width and a
   stock length; segments need a part length).
4. **What the primary yields** — the offcut lattice: `full`, `half`,
   `third`, `quarter`. This exists (`yieldGranularity`,
   `panelGranularity`).
5. **What else is bought, and by what rule** — each accessory is a name, a
   unit and one *derivation rule* from a fixed set, with the rule's own
   parameter.

Point 5 is the whole of the difference between one product and the next,
and it is where the six products are already speaking one language without
saying so. Every accessory the engine has ever emitted derives by one of
these rules:

| Rule | Reads | Example |
|---|---|---|
| `per-edge` (stock length) | every edge of every area ring, rounded up per edge | perimeter trim |
| `per-piece` (n) | each primary piece laid | end caps, 2 per baffle |
| `per-joint` (n) | each joint between pieces in a run | joiners |
| `per-connector` (n) | each connector location, shared locations once | connectors |
| `per-connector-line` (stock length) | a run perpendicular to the pieces at each connector pitch, cut from stock per run | suspension rails |
| `per-rail-line` (pitch, stock length) | as above, at its own pitch | carrier rails |
| `per-module` (n) | each grid module | baffles in a cassette |
| `per-area` (coverage) | square feet over a coverage per unit | adhesive, a hanger kit per 100 SF — not yet used |
| `per-length` (n per LF) | installed length times a rate | wire, a clip per foot — not yet used |
| `fixed` (n) | once per scope | a starter kit — not yet used |

So the common denominator is: **a product is a measurement, a layout
strategy with its stock, a yield, and a list of accessories each derived by
one rule.** Nothing in the six needs a rule outside this set, and the three
rules not yet used are the ones an estimator would reach for first when
defining a product of their own.

## 2. The product definition, as data

```ts
interface ProductDefinition {
  id: string                 // 'panels' | 'planks' | … for the built-ins; a uuid for a user's
  name: string               // "Acoustic plank, 6in"
  measure: 'area' | 'linear' | 'count'
  layout: Layout             // one of four, with its stock
  yield: Granularity         // full | half | third | quarter
  accessories: Accessory[]
  origin: 'builtin' | 'user' | 'project'
}

type Layout =
  | { kind: 'grid';     stock: StockName; width: Field; length: Field }
  | { kind: 'runs';     stock: StockName; pitch: Field; width: Field; stockLength: Field
                        connectorSpacing?: Field }
  | { kind: 'segments'; stock: StockName; partLength: Field }
  | { kind: 'none' }

interface Accessory {
  key: string                // stable, for commits and exports
  name: string               // "Suspension rail"
  unit: 'EA' | 'LF' | 'SF'
  rule: Rule
}

type Rule =
  | { kind: 'per-edge';           stockLength: Field }
  | { kind: 'per-piece';          each: number }
  | { kind: 'per-joint';          each: number }
  | { kind: 'per-connector';      each: number }
  | { kind: 'per-connector-line'; stockLength: Field }
  | { kind: 'per-rail-line';      pitch: Field; stockLength: Field }
  | { kind: 'per-module';         each: Field }          // e.g. Cassette W ÷ spacing
  | { kind: 'per-area';           coveragePerUnit: Field }
  | { kind: 'per-length';         perFoot: number }
  | { kind: 'fixed';              count: number }

/** A number the scope supplies. The definition names the field; the scope holds the value. */
interface Field { key: string; label: string; unit: 'length' | 'count' | 'area'; default?: string }
```

Two consequences fall out of this shape:

- **The setup grid writes itself.** A scope's editable measures are exactly
  the `Field`s its definition names — the layout's plus every rule's. The
  audit that keeps "a field nothing reads" out of the editor
  (`specs.test.ts`, "offers only what it reads") becomes structural: a field
  exists because a rule reads it.
- **The parts list writes itself.** Primary stock is the primary line; each
  accessory is an accessory line; the detail lines (breakdown, ordered
  length, offcut) come from the layout kind. The board-4 rules hold for a
  product nobody has seen yet.

## 3. The six built-ins are definitions, not branches

The first step is not a UI. It is expressing the six existing products in
the definition language and running the whole domain test suite against
them — the golden panel fixtures, the plank and baffle arithmetic, the
cassette module test, per-edge trim, per-run rails. When every test passes
with `calculatePieces(definition, scope, markups, cal)` instead of the
six-way branch, the engine is generic and the built-ins are just the first
six rows of a table. Nothing an estimator sees changes at that step.

```ts
const PLANKS: ProductDefinition = {
  id: 'planks', name: 'Planks', measure: 'area', yield: 'full', origin: 'builtin',
  layout: { kind: 'runs', stock: 'Planks',
            pitch: F('spacing', 'Spacing OC'), width: F('plankWidth', 'Plank W'),
            stockLength: F('stockLength', 'Stock'), connectorSpacing: F('maxConnectorSpacing', 'Conn. Max') },
  accessories: [
    { key: 'suspension_rails', name: 'Carrier rails', unit: 'EA',
      rule: { kind: 'per-rail-line', pitch: F('maxRailSpacing', 'Rail Max'), stockLength: F('railLength', 'Rail Len') } },
    { key: 'perimeter_trim', name: 'Perimeter trim', unit: 'EA',
      rule: { kind: 'per-edge', stockLength: F('perimeterTrimLength', 'Trim Len') } },
  ],
}
```

The field keys are the ones the Qt build wrote into project files, so every
existing scope round-trips unchanged: `productType: 'planks'` resolves to
the built-in definition and the specifications already carry its fields.

## 4. Where a definition lives

Three scopes of ownership, in the order a value is looked up:

- **Built-in** — the six, in the domain package, versioned with the engine.
- **The user's library** — a JSON file beside `recents.json` in the app's
  data folder: the products an estimator has made and wants in every
  project. Exportable as a file, so a library can be handed to a colleague.
- **The project** — a `products` table in `redbeam.db`, holding a copy of
  every non-built-in definition any scope in the project uses. A project is
  self-contained: opening it on another machine calculates the same
  numbers whether or not that machine's library has the product.

A scope stores `productId`. A built-in id resolves to the domain; anything
else resolves to the project table, which was filled from the library the
moment the scope chose the product. Editing a product in the library does
not silently change a project already using it; the project's copy is what
its numbers came from, and a locked round's numbers must stay reproducible.
The scope page says "Library has a newer definition — update this project's
copy?" and the estimator decides.

## 5. The UI, in one sentence per screen

- **Products** is a page of Settings, and a section of the scope's Setup
  behind "New product…". A list of definitions: the six built-ins (read-only,
  duplicable), then the user's own.
- **A product editor** asks the five questions in order, top to bottom:
  *What is measured* (three radio cards) · *How it is laid out* (four cards
  with a small diagram each: grid, runs, segments, by hand) · *The stock*
  (name, unit, and the size fields the layout kind needs, labelled in the
  estimator's words) · *Yield* (the four granularities) · *Accessories* (a
  list; "Add accessory" opens a picker of the ten rules, each described by
  what it counts — "one per edge of the area, cut from a stock length" — and
  asks only for that rule's parameter).
- **The scope's Setup grid** shows the fields the chosen product names, with
  the product's own labels. Changing a scope's product is the same picker.
- **The parts list** needs nothing: it already reads a `PieceResult`.

The editor is a form, not a formula language. An estimator who wants "a
hanger every four feet along each rail" picks *per rail line* for the rails
and *per length* for the hangers; they never see the rule's name in code.

## 6. What the engine has to give up, and what it keeps

- `calculatePieces` stops branching on `productType` and dispatches on
  `layout.kind`; `runQuantities` and the panels branch become the two
  layout back ends plus one accessory evaluator that walks the rule list.
- `resolveRunInputs` becomes "read the layout's fields"; the per-product
  quirks it carries today (a plank's connector spacing falling back to its
  rail spacing, a cassette's trim length being its width) become defaults
  written into the built-in definitions rather than conditions in code.
- The BOM, exports and commit deltas already key on `itemKey`; an
  accessory's `key` is that item key. Nothing downstream changes.
- Confidence: a user-defined product is `unverified` by construction, and
  says so once on the Parts header, as the run products do today.

## 7. Order of work

1. Express the six as definitions and make the engine generic, test-green.
   No UI. This is most of the work and all of the risk, and it is entirely
   covered by the existing suite.
2. The project `products` table and the library file; `productId` on scopes
   with the built-ins as the default; migration writes `productId` from
   `productType`.
3. The Products page and editor, drawn as a board first.
4. The three unused rules (`per-area`, `per-length`, `fixed`) get their
   arithmetic tests when the editor can reach them, not before.

## 8. Open questions for Aaron

- Does an accessory ever need *two* rules (a rail that is both per line and
  has a fixed minimum)? The model says no; a second accessory says yes.
- Should the library be a file the estimator can see and share, or a
  sync'd thing? A file is the honest first answer.
- Is there a product whose primary stock is bought in a unit other than EA —
  a roll, a sheet cut to size — that the four layout kinds do not cover?
