/**
 * A folder the user named already sits inside a REDBEAM project.
 *
 * Aaron, 2026-09-23: ask each time — open the parent, or open the subfolder
 * on its own. The silent redirect to the outermost project stays as the
 * safety net when this question never gets asked.
 */
export function nestingChoiceCopy(parentName: string): {
  title: string
  body: string
  parent: string
  own: string
} {
  return {
    title: 'This folder is inside a REDBEAM project',
    body: `${parentName} already has a REDBEAM project. Open that project, or open this folder on its own.`,
    parent: `Open ${parentName}`,
    own: 'Open this folder on its own',
  }
}

export function NestingChoice({
  parentName, onParent, onOwn, onCancel,
}: {
  parentName: string
  onParent: () => void
  onOwn: () => void
  onCancel: () => void
}) {
  const copy = nestingChoiceCopy(parentName)
  return (
    <div className="nesting" role="presentation">
      <div className="nesting-card" role="dialog" aria-labelledby="nesting-title">
        <h2 id="nesting-title">{copy.title}</h2>
        <p>{copy.body}</p>
        <div className="nesting-actions">
          <button type="button" className="st-btn" onClick={onParent}>{copy.parent}</button>
          <button type="button" className="st-btn" onClick={onOwn}>{copy.own}</button>
          <button type="button" className="st-btn subtle" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
