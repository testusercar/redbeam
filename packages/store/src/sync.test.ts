/**
 * Sync tests. The Tauri event API is mocked, so the broadcast/filter logic is
 * exercised without a runtime — including the case that matters most, a window
 * ignoring the echo of its own edit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CHANGE_EVENT,
  CHANGE_KINDS,
  broadcastChange,
  changeAffects,
  currentWindowLabel,
  isProjectChange,
  onChange,
  type ProjectChange,
} from './sync.js'

const emitMock = vi.fn(async () => {})
const unlistenMock = vi.fn()
let delivered: ((event: { event: string; id: number; payload: unknown }) => void) | null = null

const listenMock = vi.fn(async (_event: string, handler: (e: { event: string; id: number; payload: unknown }) => void) => {
  delivered = handler
  return unlistenMock
})

vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => emitMock(...(args as [])),
  listen: (...args: unknown[]) => listenMock(...(args as Parameters<typeof listenMock>)),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'window-a' }),
}))

/** Pretend we are inside a webview; isTauriAvailable() probes this. */
function enterTauri(): void {
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: () => {} }
}

/** Deliver an event as the runtime would, to whatever onChange registered. */
function deliver(payload: unknown): void {
  if (!delivered) throw new Error('no listener registered')
  delivered({ event: CHANGE_EVENT, id: 1, payload })
}

beforeEach(() => {
  emitMock.mockClear()
  listenMock.mockClear()
  unlistenMock.mockClear()
  delivered = null
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('event name', () => {
  it('uses only characters Tauri accepts in an event name', () => {
    // Verified against @tauri-apps/api 2.11.1: alphanumerics, - / : and _ .
    expect(CHANGE_EVENT).toMatch(/^[A-Za-z0-9\-/:_]+$/)
  })
})

describe('outside Tauri', () => {
  it('reports a browser window label', () => {
    expect(currentWindowLabel()).toBe('browser')
  })

  it('broadcastChange is a no-op and never touches the event API', async () => {
    await expect(broadcastChange('markups', 'proj-1')).resolves.toBeNull()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('onChange returns a no-op unsubscribe and never listens', async () => {
    const off = await onChange(() => {
      throw new Error('must not fire')
    })
    expect(listenMock).not.toHaveBeenCalled()
    expect(() => off()).not.toThrow()
  })
})

describe('broadcastChange', () => {
  beforeEach(enterTauri)

  it('emits the full payload on the change event', async () => {
    const before = Date.now()
    const change = await broadcastChange('markups', 'proj-1')

    expect(emitMock).toHaveBeenCalledTimes(1)
    const [name, payload] = emitMock.mock.calls[0] as unknown as [string, ProjectChange]
    expect(name).toBe(CHANGE_EVENT)
    expect(payload.kind).toBe('markups')
    expect(payload.projectId).toBe('proj-1')
    expect(payload.windowLabel).toBe('window-a')
    expect(payload.at).toBeGreaterThanOrEqual(before)
    expect(change).toEqual(payload)
  })

  it('accepts an explicit originating label', async () => {
    await broadcastChange('calibration', 'proj-1', { windowLabel: 'context-3' })
    const [, payload] = emitMock.mock.calls[0] as unknown as [string, ProjectChange]
    expect(payload.windowLabel).toBe('context-3')
  })

  it('carries every change kind', async () => {
    for (const kind of CHANGE_KINDS) {
      const change = await broadcastChange(kind, 'proj-1')
      expect(change!.kind).toBe(kind)
    }
    expect(emitMock).toHaveBeenCalledTimes(CHANGE_KINDS.length)
  })
})

describe('onChange', () => {
  beforeEach(enterTauri)

  const peer = (over: Partial<ProjectChange> = {}): ProjectChange => ({
    kind: 'markups',
    projectId: 'proj-1',
    windowLabel: 'window-b',
    at: Date.now(),
    ...over,
  })

  it('subscribes to the change event', async () => {
    await onChange(() => {})
    expect(listenMock).toHaveBeenCalledTimes(1)
    expect(listenMock.mock.calls[0]![0]).toBe(CHANGE_EVENT)
  })

  it('delivers a peer window change', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c))
    const change = peer()
    deliver(change)
    expect(seen).toEqual([change])
  })

  it('suppresses this window own echo — emit fans out to the emitter too', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c))
    deliver(peer({ windowLabel: 'window-a' })) // 'window-a' is us
    expect(seen).toEqual([])
  })

  it('suppresses the echo of an explicitly labelled window', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c), { windowLabel: 'context-3' })
    deliver(peer({ windowLabel: 'context-3' }))
    deliver(peer({ windowLabel: 'window-a' }))
    expect(seen.map((c) => c.windowLabel)).toEqual(['window-a'])
  })

  it('delivers the echo when includeSelf is set', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c), { includeSelf: true })
    deliver(peer({ windowLabel: 'window-a' }))
    expect(seen).toHaveLength(1)
  })

  it('ignores changes for another project', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c), { projectId: 'proj-1' })
    deliver(peer({ projectId: 'proj-2' }))
    deliver(peer({ projectId: 'proj-1' }))
    expect(seen.map((c) => c.projectId)).toEqual(['proj-1'])
  })

  it('receives every project when no projectId filter is given', async () => {
    const seen: ProjectChange[] = []
    await onChange((c) => seen.push(c))
    deliver(peer({ projectId: 'proj-2' }))
    expect(seen).toHaveLength(1)
  })

  it('drops a malformed payload instead of handing on a half-typed object', async () => {
    const seen: unknown[] = []
    await onChange((c) => seen.push(c))
    deliver(null)
    deliver('markups')
    deliver({ kind: 'markups' })
    deliver({ kind: 'nonsense', projectId: 'proj-1', windowLabel: 'window-b', at: 1 })
    deliver({ kind: 'markups', projectId: 'proj-1', windowLabel: 'window-b', at: '1' })
    expect(seen).toEqual([])
  })

  it('unsubscribes and stops delivering', async () => {
    const seen: ProjectChange[] = []
    const off = await onChange((c) => seen.push(c))
    off()
    expect(unlistenMock).toHaveBeenCalledTimes(1)
    deliver(peer()) // a late in-flight event must not reach a torn-down handler
    expect(seen).toEqual([])
  })
})

describe('helpers', () => {
  const change = (kind: ProjectChange['kind']): ProjectChange => ({
    kind,
    projectId: 'proj-1',
    windowLabel: 'window-b',
    at: 0,
  })

  it('changeAffects matches its own kind', () => {
    expect(changeAffects(change('markups'), 'markups')).toBe(true)
    expect(changeAffects(change('markups'), 'scopes')).toBe(false)
  })

  it("'all' affects every slice", () => {
    for (const kind of CHANGE_KINDS) {
      expect(changeAffects(change('all'), kind)).toBe(true)
    }
  })

  it('isProjectChange validates the wire shape', () => {
    expect(isProjectChange(change('scopes'))).toBe(true)
    expect(isProjectChange({ ...change('scopes'), kind: 'markup' })).toBe(false)
    expect(isProjectChange(undefined)).toBe(false)
  })
})
