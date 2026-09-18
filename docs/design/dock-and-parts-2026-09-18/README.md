# Boards approved by Aaron, 2026-09-18 ("All of your mockups are approved. Go ahead and build.")

Built the same day. Two numbers on board 2 differ in the build, both
measured rather than drawn: Spacious (labels on the tools) begins at 1440px
of drawing rather than 1280, because the labelled row plus the sheet surface
runs ~1500px; and Compact folds the read tools not in hand, the page arrows
and Fit into the overflows (the board kept them to 600px), because at 658px
the real row ran 856px and the sheet surface painted over the tools. Minimum
begins at 640. Everything else is as drawn.

---

(The text below is the proposal as it was put to Aaron.)

Aaron asked (2026-09-18) for the dock to be reassessed against Fluent's
CommandBar "at different density levels and in all different states", and
for a full audit of the parts list per product type ("I want the parts list
to be as minimal as possible. The count tile at the top maybe shouldn't be
there. Installed length doesn't need to go on the part list.").

These boards are the proposal. Nothing on them is built until Aaron says so
in his own words. The PNGs are the renders; boards.html draws its glyphs
from a `fluent-icons.js` extracted from @fluentui/react-icons (6 MB, not
committed).

Findings are drawn from the code as it stands: Dock.tsx, shell.css's
collapse tiers, packages/domain/src/{takeoff,runs,bom}.ts and
RightWorkspace.tsx's QuantityStrip and PartsTable.
