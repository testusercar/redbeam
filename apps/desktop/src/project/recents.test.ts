import { describe, it, expect } from 'vitest'
import {
  dedupeRecents,
  filterRecents,
  formatLastOpened,
  isPlausibleProjectPath,
  projectPathProblem,
  shortenPath,
} from './recents.js'
import type { RecentProject } from './types.js'

const project = (path: string, name = path, lastOpenedAt = '2026-08-28T00:00:00.000Z'): RecentProject => ({
  path,
  name,
  lastOpenedAt,
  missing: false,
})

describe('filterRecents', () => {
  const list = [
    project('C:/Jobs/260415 - REDBEAM', '260415 - REDBEAM'),
    project('C:/Jobs/260119 - Fleet', '260119 - Fleet'),
    project('D:/Archive/260415 - REDBEAM', '260415 - REDBEAM'),
  ]

  it('returns everything for an empty query', () => {
    expect(filterRecents(list, '')).toHaveLength(3)
    expect(filterRecents(list, '   ')).toHaveLength(3)
  })

  it('matches name case-insensitively', () => {
    expect(filterRecents(list, 'fleet')).toHaveLength(1)
    expect(filterRecents(list, 'FLEET')).toHaveLength(1)
  })

  it('matches the path too, because names repeat across drives', () => {
    // Two projects share a name; only the path tells them apart.
    expect(filterRecents(list, '260415')).toHaveLength(2)
    expect(filterRecents(list, 'D:/Archive')).toHaveLength(1)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterRecents(list, 'zzz')).toHaveLength(0)
  })
})

describe('dedupeRecents', () => {
  it('keeps the first occurrence and folds case', () => {
    const deduped = dedupeRecents([
      project('C:/Jobs/A', 'newest'),
      project('c:/jobs/a', 'older'),
      project('C:/Jobs/B', 'b'),
    ])
    expect(deduped).toHaveLength(2)
    expect(deduped[0]!.name).toBe('newest')
  })
})

describe('shortenPath', () => {
  it('leaves a short path alone', () => {
    expect(shortenPath('C:/Jobs/A', 52)).toBe('C:/Jobs/A')
  })

  it('elides the middle, keeping the drive and the folder name', () => {
    const long = 'C:/Users/aaron/Dev Projects/260415 - REDBEAM/packages/store/deep/deeper'
    const short = shortenPath(long, 30)
    expect(short.length).toBe(30)
    expect(short.startsWith('C:/Users/')).toBe(true)
    expect(short.endsWith('deeper')).toBe(true)
    expect(short).toContain('…')
  })

  it('refuses to mangle an absurdly small budget', () => {
    expect(shortenPath('C:/Jobs/AAAAAAAAAA', 4)).toBe('C:/Jobs/AAAAAAAAAA')
  })
})

describe('formatLastOpened', () => {
  const now = Date.parse('2026-08-28T12:00:00.000Z')

  it('reads recent times in human units', () => {
    expect(formatLastOpened('2026-08-28T11:59:30.000Z', now)).toBe('just now')
    expect(formatLastOpened('2026-08-28T11:46:00.000Z', now)).toBe('14m ago')
    expect(formatLastOpened('2026-08-28T09:00:00.000Z', now)).toBe('3h ago')
    expect(formatLastOpened('2026-08-27T09:00:00.000Z', now)).toBe('yesterday')
  })

  it('falls back to a date, with the year only when it differs', () => {
    expect(formatLastOpened('2026-08-12T09:00:00.000Z', now)).toBe('12 Aug')
    expect(formatLastOpened('2025-08-12T09:00:00.000Z', now)).toBe('12 Aug 2025')
  })

  it('does not render a negative age when a clock has gone backwards', () => {
    expect(formatLastOpened('2026-08-28T13:00:00.000Z', now)).toBe('just now')
  })

  it('renders nothing for a timestamp it cannot parse', () => {
    expect(formatLastOpened('', now)).toBe('')
    expect(formatLastOpened('not a date', now)).toBe('')
  })
})

describe('isPlausibleProjectPath', () => {
  it('accepts absolute paths in every spelling that reaches us', () => {
    expect(isPlausibleProjectPath('C:\\Jobs\\260415')).toBe(true)
    expect(isPlausibleProjectPath('C:/Jobs/260415')).toBe(true)
    expect(isPlausibleProjectPath('\\\\server\\share\\260415')).toBe(true)
    expect(isPlausibleProjectPath('/home/aaron/jobs/260415')).toBe(true)
  })

  it('rejects the relative paths that caused the wart', () => {
    // openDatabase() defaulted to '.', so the database landed beside whatever
    // binary happened to be running.
    expect(isPlausibleProjectPath('.')).toBe(false)
    expect(isPlausibleProjectPath('./jobs')).toBe(false)
    expect(isPlausibleProjectPath('jobs/260415')).toBe(false)
    expect(isPlausibleProjectPath('')).toBe(false)
    expect(isPlausibleProjectPath('   ')).toBe(false)
  })
})

describe('projectPathProblem', () => {
  it('stays quiet on an empty field', () => {
    expect(projectPathProblem('')).toBeNull()
    expect(projectPathProblem('  ')).toBeNull()
  })

  it('stays quiet on a good path', () => {
    expect(projectPathProblem('C:/Jobs/260415')).toBeNull()
  })

  it('explains a relative path', () => {
    expect(projectPathProblem('jobs')).toContain('full path')
  })
})
