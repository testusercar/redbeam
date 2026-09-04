/**
 * Project lifecycle — open, close, recent projects, folder ingest.
 *
 * Everything here is self-contained: the components take explicit props and
 * callbacks and import nothing from the app's state. Wiring is:
 *
 * ```tsx
 * const project = useProject({
 *   onOpened: async (info) => {
 *     const db = await openDatabase(info.dbPath)     // the real folder, not '.'
 *     const scan = await projectBridge.scanProject(info.path)
 *     await ingestDocuments(db.driver, toIngestDocuments(scan), {
 *       reconcile: shouldReconcile(scan),
 *     })
 *   },
 * })
 *
 * if (!project.project) {
 *   return (
 *     <ProjectStartScreen
 *       recents={project.recents}
 *       onOpenPath={project.open}
 *       onOpenRecent={project.openRecent}
 *       onForgetRecent={project.forget}
 *       onBrowse={project.browse}
 *       busy={project.busy}
 *       busyPath={project.busyPath}
 *       error={project.error}
 *     />
 *   )
 * }
 * ```
 */
export { ProjectPicker } from './ProjectPicker.js'
export type { ProjectPickerProps } from './ProjectPicker.js'

export { RecentProjectList } from './RecentProjectList.js'
export type { RecentProjectListProps } from './RecentProjectList.js'

export { ProjectStartScreen } from './ProjectStartScreen.js'
export type { ProjectStartScreenProps } from './ProjectStartScreen.js'

export { useProject } from './useProject.js'
export type { UseProjectOptions, UseProjectState } from './useProject.js'

export {
  createProjectBridge,
  projectBridge,
  projectNameFromPath,
  BROWSER_RECENTS_KEY,
  MAX_RECENTS,
} from './bridge.js'
export type { InvokeFn, KeyValueStore, ProjectBridge, ProjectBridgeOptions } from './bridge.js'

export {
  createCoreBlobUrlResolver,
  createWorkerPageProbe,
  describeScan,
  shouldReconcile,
  toIngestDocument,
  toIngestDocuments,
} from './ingest.js'
export type { IngestDocumentLike, PageProbeOptions, PageSpecLike } from './ingest.js'

export {
  FILTER_THRESHOLD,
  INITIAL_VISIBLE,
  dedupeRecents,
  filterRecents,
  formatLastOpened,
  isPlausibleProjectPath,
  projectPathProblem,
  shortenPath,
} from './recents.js'

export type {
  IngestCounts,
  PickOutcome,
  ProjectInfo,
  RecentProject,
  ScanResult,
  ScannedFile,
} from './types.js'
