/**
 * The scales on this sheet — a section of the dock's scale control.
 *
 * Drawing a region is half the job. A details page grows four of them, one gets
 * drawn over the wrong detail, and without a list the only way to remove it is
 * to know it is there and find it — which is a poor trade for a box that
 * silently governs every measurement inside it.
 *
 * It floated loose at the bottom-left of the drawing, a panel with no anchor
 * and a "Done" in its own corner. The sheet's scale has ONE control — the
 * pill at the bottom right that reads "1/8" = 1'-0" +2 regions" — and the
 * regions are that number's small print, so they are listed under it. With
 * the region tool in hand the control stays open so the list is beside the
 * box being drawn; the rest of the time the regions are a section of the same
 * menu the page scale is chosen from.
 */
import { scaleLabel, type ScaleRegion } from '@redbeam/domain'
import { Glyph, TriangleAlert, X } from '../shell/icons.js'

export interface RegionListProps {
  /** The page's own scale, or null when it has none. */
  pageScale: number | null
  regions: readonly ScaleRegion[]
  /** Regions that overlap another at a different scale, by id. */
  conflicting: ReadonlySet<string>
  onDelete: (id: string) => void
  /**
   * Whether the region tool is in hand. Then the list carries the drawing
   * hint and the way to put the tool down; otherwise it is an inventory.
   */
  toolActive?: boolean
  /** Put the region tool down. */
  onClose?: () => void
}

export function RegionList({
  pageScale, regions, conflicting, onDelete, toolActive = false, onClose,
}: RegionListProps) {
  return (
    <div className="sheetscales" role="group" aria-label="Scales on this sheet">
      <div className="menuhead">Scales on this sheet</div>

      {/*
        The page scale is listed first and as a peer, because that is what it
        is: the scale for everything no region covers. Leaving it out would
        make the list look like the whole story when it is the exception list.
      */}
      <div className="sheetscalerow pagerow">
        <span className="grow">Rest of the sheet</span>
        <span className={pageScale === null ? 'wswarnink' : 'wsmuted'}>
          {pageScale === null ? 'no scale' : scaleLabel(pageScale)}
        </span>
      </div>

      {regions.map((r) => (
        <div className={`sheetscalerow${conflicting.has(r.id) ? ' conflict' : ''}`} key={r.id}>
          <span className="grow">{r.label === '' ? 'Unnamed region' : r.label}</span>
          <span className="wsmuted">{scaleLabel(r.feetPerPoint)}</span>
          <button
            className="paneact"
            title="Remove this region"
            aria-label={`Remove ${r.label === '' ? 'unnamed region' : r.label}`}
            onClick={() => onDelete(r.id)}
          ><Glyph icon={X} role="small" /></button>
        </div>
      ))}

      {toolActive && (
        <div className="sheetscalehint">
          Drag a box over a detail to give it its own scale.
        </div>
      )}

      {/*
        Overlap is fine when it is nesting — the smaller one wins, and a detail
        inside a detail is a real thing. A PARTIAL overlap between two
        different scales is not: neither contains the other, so which applies
        depends on where a markup happens to land.
      */}
      {conflicting.size > 0 && (
        <div className="wswarn">
          <Glyph icon={TriangleAlert} role="row" />
          <span>
            {conflicting.size} region{conflicting.size === 1 ? '' : 's'} overlap another at a
            different scale without sitting inside it, so what a markup measures at
            depends on where it falls.
          </span>
        </div>
      )}

      {toolActive && onClose !== undefined && (
        <div className="sheetscalefoot">
          <button className="primarybtn" onClick={onClose}>Done</button>
        </div>
      )}
    </div>
  )
}
