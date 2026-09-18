# Boards approved by Aaron on 2026-09-18, with one change

Round three of the 2026-09-18 surfaces: the start page, the project switcher
as a flyout, the search pane in three states, and a second pass at Settings.

Approval: "'open a drawing set' should not be the primary option and should
not create a project instantly. it should just open the file for quick
viewing. if any markup actions need to be taken it should prompt the user to
select the file's project folder first. The rest of the boards are approved.
BUILD" — and, mid-build, "also use the windows accent color for all accent
colored items."

So the built start page differs from 1-start-page.png in one place: "Open a
project folder" is the primary card, and "Open a drawing set to look at"
opens the PDF for viewing in a memory store. The first markup action asks for
the drawing's project folder.

boards.html draws its glyphs from a `fluent-icons.js` extracted from
@fluentui/react-icons (6 MB, not committed); the PNGs are the approved renders.
