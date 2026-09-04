import { describe, it, expect } from 'vitest'
import { getWindowRole, windowUrl } from './window.js'

describe('getWindowRole', () => {
  it('defaults to the main role with no project when the query string is empty', () => {
    expect(getWindowRole('')).toEqual({ projectId: null, role: 'main', documentPath: null })
  })

  it('reads projectId and role', () => {
    expect(getWindowRole('?projectId=abc123&role=context')).toEqual({
      projectId: 'abc123',
      role: 'context',
      documentPath: null,
    })
  })

  /*
   * The whole point of popping a tab out: the window that opens must show the
   * sheet you popped, not whatever the project happens to open first.
   */
  it('carries the document a context window was popped out to show', () => {
    const url = windowUrl('C:/Jobs/00045', 'context', '01 Drawings/human takeoff.pdf')
    expect(getWindowRole(url.slice(url.indexOf('?')))).toEqual({
      projectId: 'C:/Jobs/00045',
      role: 'context',
      documentPath: '01 Drawings/human takeoff.pdf',
    })
  })

  it('treats an empty document as absent', () => {
    expect(getWindowRole('?projectId=a&role=context&document=').documentPath).toBeNull()
  })

  it('falls back to main for an unknown role', () => {
    expect(getWindowRole('?projectId=abc123&role=nonsense').role).toBe('main')
  })

  it('treats an empty projectId as absent', () => {
    expect(getWindowRole('?projectId=&role=main').projectId).toBeNull()
  })

  it('round-trips a project id that needs escaping', () => {
    const url = windowUrl('a b&c=d', 'context')
    expect(getWindowRole(url.slice(url.indexOf('?')))).toEqual({
      projectId: 'a b&c=d',
      role: 'context',
      documentPath: null,
    })
  })
})
