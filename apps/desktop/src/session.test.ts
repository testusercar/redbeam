import { beforeEach, describe, expect, it } from 'vitest'
import { readSession, writeSession } from './session.js'

// A minimal localStorage; the module guards every access, so this is only here
// to exercise the happy path.
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
})

describe('the remembered place in a project', () => {
  it('is empty for a project never opened', () => {
    expect(readSession('C:/jobs/one')).toEqual({})
  })

  it('remembers a document and a page', () => {
    writeSession('C:/jobs/one', { documentPath: 'A-101.pdf', pageIndex: 8 })
    expect(readSession('C:/jobs/one')).toEqual({ documentPath: 'A-101.pdf', pageIndex: 8 })
  })

  it('merges, so a page does not erase the document', () => {
    writeSession('C:/jobs/one', { documentPath: 'A-101.pdf', pageIndex: 8 })
    writeSession('C:/jobs/one', { pageIndex: 3 })
    expect(readSession('C:/jobs/one')).toEqual({ documentPath: 'A-101.pdf', pageIndex: 3 })
  })

  it('keeps projects apart', () => {
    writeSession('C:/jobs/one', { pageIndex: 8 })
    writeSession('C:/jobs/two', { pageIndex: 1 })
    expect(readSession('C:/jobs/one').pageIndex).toBe(8)
    expect(readSession('C:/jobs/two').pageIndex).toBe(1)
  })

  it('survives a corrupt store rather than failing the launch', () => {
    store.set('redbeam.session.v1', 'not json')
    expect(readSession('C:/jobs/one')).toEqual({})
  })
})
