/**
 * The sheet index — the panel that replaced the file tree.
 *
 * The file tree was answering the wrong question. A drawing set is one PDF
 * with 110 sheets in it, so the tree rendered exactly one row and navigated
 * nothing; the thing an estimator actually moves through is the sheets. Which
 * is what the Qt build's left panel showed, and why this is the parity gap
 * that mattered most.
 *
 * Grouping, titles and fallbacks are decided in `sheets.ts` — this component
 * only renders and filters. The one behaviour that lives here is scrolling the
 * current sheet into view, because that is a DOM concern.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Glyph, Search } from './icons.js'
import { useClampedPopover } from './popover.js'
import {
  buildSheetIndex, filterSheets, sheetDots, type SheetIndexInput, type SheetRow,
} from './sheets.js'
import {
  clickSheet, describeSelection, EMPTY_SELECTION, rightClickSheet, selectedInOrder,
  type SheetSelection,
} from './sheetSelection.js'

export interface SheetIndexProps extends SheetIndexInput {
  /** 0-based index of the sheet on screen. */
  current: number
  onGoToPage: (page: number) => void
  /**
   * Set one scale across the selected sheets.
   *
   * The whole 400-series is at one scale and the title block says so on every
   * sheet; setting it forty times is data entry.
   */
  onSetScale?: (pages: number[]) => void
  /** Feet per point per page, for the badge. Absent means not set. */
  scaleOf?: (page: number) => number | null
  /**
   * Shown instead of "no document open" while that is not yet known — the
   * folder is still being read, or the drawing is still opening. An empty
   * index that has not finished loading must not claim to be empty.
   */
  pending?: string | null
}

export function SheetIndex({
  current, onGoToPage, onSetScale, scaleOf, pending = null, ...input
}: SheetIndexProps) {
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<SheetSelection>(EMPTY_SELECTION)
  const [menu, setMenu] = useState<{ x: number, y: number, pages: number[] } | null>(null)
  const groups = useMemo(() => buildSheetIndex(input), [
    input.pageCount, input.shape, input.outline, input.labels, input.takeoffPages, input.pageScopes,
  ])
  const shown = useMemo(() => filterSheets(groups, query), [groups, query])

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const menuClamp = useClampedPopover<HTMLDivElement>(menu !== null)

  // Follow the document. Without this, paging with the dock leaves the index
  // showing wherever it was last scrolled, which is the sheet you just left.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const withTakeoff = groups.reduce((n, g) => n + g.rows.filter((r) => r.hasTakeoff).length, 0)

  /*
   * The pages currently ON SCREEN, in order, which is what a shift-range
   * means. Groups collapse and the search box filters, so this is not simply
   * 0..pageCount — and a range that quietly included sheets nobody can see
   * would apply a scale to them too.
   */
  const visible = useMemo(() => {
    const out: number[] = []
    for (const g of shown) {
      if (g.label !== null && collapsed.has(g.label)) continue
      for (const r of g.rows) out.push(r.page)
    }
    return out
  }, [shown, collapsed])

  const labelFor = (page: number) => {
    for (const g of groups) {
      const hit = g.rows.find((r) => r.page === page)
      if (hit !== undefined) return hit.number
    }
    return `Page ${page + 1}`
  }

  const row = (r: SheetRow) => (
    <button
      key={r.page}
      ref={r.page === current ? currentRef : undefined}
      className={`sheetrow${r.page === current ? ' active' : ''}`
        + `${selection.pages.has(r.page) ? ' picked' : ''}`}
      aria-current={r.page === current ? 'true' : undefined}
      aria-selected={selection.pages.has(r.page)}
      onClick={(e) => {
        setSelection((prev) => clickSheet(
          prev, r.page, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey }, visible,
        ))
        // A modified click is building a selection, not asking to read that
        // sheet — paging away mid-selection loses the drawing you were on.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onGoToPage(r.page)
      }}
      onContextMenu={(e) => {
        if (onSetScale === undefined) return
        e.preventDefault()
        const next = rightClickSheet(selection, r.page)
        setSelection(next)
        setMenu({ x: e.clientX, y: e.clientY, pages: selectedInOrder(next) })
      }}
      title={r.title === '' ? r.number : `${r.number} — ${r.title}`}
    >
      {/*
        ONE LINE. The number and the title used to stack, which put nine
        sheets on a screen with room for sixteen — and an index is scanned
        down the number column, not read. The number is the identifier, so
        it is never the thing that truncates: the title takes what is left
        and gives way first. The row's grid says so (see `.sheetrow`).
      */}
      <span className="sheetnum">{r.number}</span>
      {/* Nested so the title can hide itself when its cell is too narrow to
          say anything — a container query styles only what is inside. */}
      <span className="sheettitle"><span>{r.title}</span></span>
      {/*
        ONE trailing cell. The row is a grid — number, title, trailing — and
        the badge used to be a fourth child, which grid wrapped onto a second
        row: every unscaled sheet showed its page number alone on a line
        beneath the title. The things that trail share a cell.
      */}
      <span className="sheettrail">
        {/*
          An unscaled sheet says so. Nothing on it can be measured, and finding
          that out from a quantity that came back empty is the long way round.
        */}
        {scaleOf !== undefined && r.hasTakeoff && scaleOf(r.page) === null && (
          <span className="sheetunscaled" title="This sheet has no scale set">no scale</span>
        )}
        <SheetDots row={r} />
        <span className="sheetpage">{r.page + 1}</span>
      </span>
    </button>
  )

  return (
    <>
      <div className="panesearch">
        <Glyph icon={Search} role="small" />
        <input
          value={query}
          placeholder="Find a sheet"
          aria-label="Find a sheet"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
        />
      </div>

      <div className="panebody">
        {shown.length === 0 && input.pageCount === 0 && pending !== null && (
          <div className="paneempty pending" role="status">{pending}</div>
        )}
        {shown.length === 0 && (input.pageCount > 0 || pending === null) && (
          <div className="paneempty">
            {input.pageCount === 0
              ? (
                <>
                  <div>No drawing open.</div>
                  <div className="panehint">
                    Open one from Project files, or press + in the tab strip to
                    add a PDF. Its sheets are listed here.
                  </div>
                </>
                )
              : `No sheet matches “${query}”.`}
          </div>
        )}
        {shown.map((g, i) => {
          if (g.label === null) return <div key={i}>{g.rows.map(row)}</div>
          const isOpen = !collapsed.has(g.label)
          return (
            <section className="sheetgroup" key={g.label}>
              <button
                className="sheetgrouphead"
                aria-expanded={isOpen}
                onClick={() => setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(g.label!)) next.delete(g.label!)
                  else next.add(g.label!)
                  return next
                })}
              >
                <Glyph icon={ChevronRight} role="small" />
                <span className="grow">{g.label}</span>
                <span>{g.rows.length}</span>
              </button>
              {isOpen && g.rows.map(row)}
            </section>
          )
        })}
      </div>

      {menu !== null && onSetScale !== undefined && (
        <>
          {/* A scrim, so the next click anywhere dismisses the menu rather than
              also landing on whatever is underneath it. */}
          <div
            className="menuscrim"
            onPointerDown={(e) => { e.stopPropagation(); setMenu(null) }}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
          />
          {/*
            `sheetmenu`, not a bare `dockmenu`: the dock's menus rise from a
            pill (`bottom: calc(100% + 8px)`), and a pointer-anchored `top`
            on top of that gave the box a negative height. It rendered as a
            one-pixel sliver, and "Set scale…" on a selection was unreachable
            by the gesture that offers it.
          */}
          <div
            className="dockmenu sheetmenu"
            role="menu"
            ref={menuClamp.ref}
            style={{ left: menu.x, top: menu.y, ...menuClamp.style }}
          >
            <div className="menuhead">
              {describeSelection({ pages: new Set(menu.pages), anchor: null }, labelFor)}
            </div>
            <button
              className="menuitem"
              role="menuitem"
              onClick={() => { onSetScale(menu.pages); setMenu(null) }}
            >
              <span className="grow">Set scale…</span>
            </button>
          </div>
        </>
      )}

      <div className="panefoot">
        {input.pageCount === 0
          ? (pending ?? 'No sheets')
          : selection.pages.size > 1
            ? `${selection.pages.size} of ${input.pageCount} sheets selected`
            : `${input.pageCount} sheets · ${withTakeoff} with takeoff`}
      </div>
    </>
  )
}

/**
 * What is drawn on a sheet, as dots in the scopes' own colours.
 *
 * On the RIGHT of the row, beside the page number, because that is where the
 * eye lands after the number and the title — and because a dot on the left
 * used to be the only signal, in ink, saying "something is here" without
 * saying what. A ceiling plan carrying the metal panel scope and the baffle
 * scope now shows amber and green; a sheet with markups that belong to no
 * scope shows a hollow dot, so the takeoff is not invisible just because it
 * is unfiled.
 *
 * The count past the cap is decided in `sheets.ts`; the page number never
 * moves because this cell has a budget and the number has its own.
 */
function SheetDots({ row }: { row: SheetRow }) {
  if (!row.hasTakeoff) return null
  const { shown, more } = sheetDots(row.scopes)
  const names = row.scopes.map((s) => s.label).join(', ')
  const said = names === ''
    ? 'Carries takeoff in no scope'
    : `${row.scopes.length === 1 ? 'Scope' : 'Scopes'} on this sheet: ${names}`
  return (
    <span className="sheetscopes" role="img" aria-label={said} title={said}>
      {shown.length === 0 && <span className="sheetdot unscoped" />}
      {shown.map((s) => (
        <span key={s.id} className="sheetdot" style={{ background: s.color }} />
      ))}
      {more > 0 && <span className="sheetmore">+{more}</span>}
    </span>
  )
}
