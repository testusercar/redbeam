/**
 * The project-folder half of the drawing embed: a `DrawingFile` backed by the
 * desktop bridge, with the file's SHA-256 as its version so a write is refused
 * when Bluebeam or OneDrive changed the drawing after REDBEAM read it.
 */
import type { ProjectBridge } from '../project/bridge.js'
import type { DrawingFile } from './drawingEmbed.js'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function projectDrawingFile(
  bridge: Pick<ProjectBridge, 'readDocument' | 'writeDocument'>,
  projectPath: string,
  relativePath: string,
): DrawingFile {
  return {
    read: async () => {
      const bytes = await bridge.readDocument(projectPath, relativePath)
      return { bytes, version: await sha256Hex(bytes) }
    },
    write: async (bytes, expectedVersion) => {
      const out = await bridge.writeDocument(projectPath, relativePath, bytes, expectedVersion)
      return out.outcome === 'written'
    },
  }
}
