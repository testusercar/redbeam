import { describe, expect, it } from 'vitest'
import { groupMatches, search, type Command, type CommandKind } from './commands.js'

/*
 * Every assertion below is a RELATIVE one — "this ranks above that", "this does
 * not match" — never an absolute score. The weights in commands.ts are chosen
 * to encode an ordering, so pinning the numbers would make the suite object to
 * retuning rather than to regression.
 */

let seq = 0
const cmd = (title: string, over: Partial<Command> = {}): Command => ({
  id: `c${(seq += 1)}`, kind: 'command', title, run: () => {}, ...over,
})

const titles = (commands: Command[], query: string): string[] =>
  search(commands, query).map((m) => m.command.title)

const rank = (commands: Command[], query: string, title: string): number =>
  titles(commands, query).indexOf(title)

describe('search · ranking', () => {
  it('ranks an exact prefix of the title above a mid-string match', () => {
    const list = [cmd('Best fit'), cmd('Fit width')]
    expect(titles(list, 'fit')).toEqual(['Fit width', 'Best fit'])
  })

  it('ranks a word-boundary match above a mid-word one', () => {
    // Same first-match position in both, so lead position cannot be what
    // decides it: only the boundary bonus separates them.
    const list = [cmd('Bandwidth limit'), cmd('Fit width')]
    expect(titles(list, 'wid')).toEqual(['Fit width', 'Bandwidth limit'])
  })

  it('ranks a contiguous run above the same characters scattered', () => {
    // Both start matching at index 5, and the scattered one picks up an extra
    // word-boundary bonus on its `r`. Contiguity has to win anyway.
    const list = [cmd('Show auto rescale'), cmd('Show arc length')]
    expect(rank(list, 'arc', 'Show arc length')).toBeLessThan(rank(list, 'arc', 'Show auto rescale'))
  })

  it('ranks a whole-word keyword above a fuzzy title, and a title prefix above both', () => {
    const list = [
      // A keyword the query is a prefix of, against a title hit as weak as
      // one gets: two gaps and no prefix. The keyword wins — that is what an
      // alias is for — but a title the query is a prefix of still beats it.
      cmd('Lock page layout', { keywords: ['freeze'] }),
      cmd('Set frame size'),
      cmd('Fresh start'),
    ]
    expect(titles(list, 'fre')).toEqual(['Fresh start', 'Lock page layout', 'Set frame size'])
  })

  it('keeps a keyword the query only fuzzy-matches below every title match', () => {
    const list = [
      cmd('Lock page layout', { keywords: ['freeze'] }),
      cmd('Fizz buzz'),
    ]
    // "fz" is in "freeze" with a gap and starts no word of it; the title
    // "Fizz buzz" only fuzzy-matches too, and a title still outranks it.
    expect(titles(list, 'fz')).toEqual(['Fizz buzz', 'Lock page layout'])
  })

  it('finds a command through a plain-language alias, and marks nothing in the title', () => {
    // Commands spec §4.4: "second window" finds Open Context Window.
    const list = [cmd('Open Context Window', { keywords: ['second window', 'duplicate view'] })]
    const [hit] = search(list, 'second window')
    expect(hit?.command.title).toBe('Open Context Window')
    expect(hit?.ranges).toEqual([])
  })
})

describe('search · sheet numbers', () => {
  it('matches a punctuated code from its unpunctuated digits', () => {
    const list = [cmd('AE6-01-02 ARCHITECTURAL CEILING PLAN', { kind: 'page' })]
    expect(titles(list, 'ae60102')).toEqual(['AE6-01-02 ARCHITECTURAL CEILING PLAN'])
  })

  it('ignores separators typed in the query', () => {
    const list = [cmd('A-101 FLOOR PLAN', { kind: 'page' })]
    for (const typed of ['a101', 'a-101', 'a 101', 'a.101']) {
      expect(titles(list, typed), typed).toEqual(['A-101 FLOOR PLAN'])
    }
  })

  it('does not scatter query digits across a neighbouring code', () => {
    // "A-102 LEVEL 1" is the trap: a generic subsequence matcher takes a/1/0
    // from the code and the final 1 from the level, and ranks the wrong sheet.
    const list = [cmd('A-102 LEVEL 1 PLAN', { kind: 'page' }), cmd('A-101 FLOOR PLAN', { kind: 'page' })]
    expect(titles(list, 'a101')).toEqual(['A-101 FLOOR PLAN'])
  })

  it('does not scatter query digits across a title either', () => {
    const list = [cmd('AREA 1 LEVEL 0 PLAN 1', { kind: 'page' })]
    expect(titles(list, 'a101')).toEqual([])
  })

  it('abandons a dead-ended start and finds the code further along', () => {
    // The obvious start — `a` at 0, then the digit run of A-102 — dies on the
    // final `1`. The match has to give up on both and re-enter at "A-101".
    const [hit] = search([cmd('A-102 / A-101 COMBINED PLAN', { kind: 'page' })], 'a101')
    expect(hit?.command.title).toBe('A-102 / A-101 COMBINED PLAN')
    expect(hit?.ranges).toEqual([[8, 9], [10, 13]])
  })

  it('will not enter a digit run part-way through', () => {
    // The cost of SHEET RULE 1, stated as a test rather than left to be
    // discovered: `101` is not a prefix of the run `1101`, so it is not a match.
    expect(titles([cmd('A-1101 ROOF', { kind: 'page' })], '101')).toEqual([])
    expect(titles([cmd('A-1101 ROOF', { kind: 'page' })], '1101')).toEqual(['A-1101 ROOF'])
  })

  it('highlights the matched characters and skips the separators it crossed', () => {
    const [hit] = search([cmd('A-101 FLOOR PLAN', { kind: 'page' })], 'a101')
    // "A" then "101": the hyphen is crossed, not matched, so it is not marked.
    expect(hit?.ranges).toEqual([[0, 1], [2, 5]])
  })
})

describe('search · the flat rules', () => {
  it('returns everything in input order for an empty query', () => {
    const list = [cmd('Zoom in'), cmd('Fit width'), cmd('Archive scope')]
    expect(titles(list, '')).toEqual(['Zoom in', 'Fit width', 'Archive scope'])
    expect(titles(list, '   ')).toEqual(['Zoom in', 'Fit width', 'Archive scope'])
  })

  it('caps at the limit, with and without a query', () => {
    const list = [cmd('Fit width'), cmd('Fit page'), cmd('Fit height')]
    expect(search(list, '', { limit: 2 })).toHaveLength(2)
    expect(search(list, 'fit', { limit: 2 })).toHaveLength(2)
    expect(search(list, 'fit', { limit: 0 })).toHaveLength(0)
  })

  it('keeps input order among equal scores', () => {
    // Identical titles score identically by construction, so the only thing
    // that can order them is the sort's stability.
    const list = [
      cmd('Fit width', { id: 'first' }),
      cmd('Fit width', { id: 'second' }),
      cmd('Fit width', { id: 'third' }),
    ]
    const scores = search(list, 'fit').map((m) => m.score)
    expect(new Set(scores).size).toBe(1)
    expect(search(list, 'fit').map((m) => m.command.id)).toEqual(['first', 'second', 'third'])
  })

  it('returns nothing when nothing matches', () => {
    const list = [cmd('Fit width'), cmd('Archive scope')]
    expect(search(list, 'xylophone')).toEqual([])
  })
})

describe('groupMatches', () => {
  const kinds: CommandKind[] = ['project', 'page', 'document', 'estimate', 'scope', 'command']

  it('orders groups and drops the empty ones', () => {
    // Deliberately built in reverse of the intended order.
    const list = kinds.map((kind) => cmd(`Ceiling ${kind}`, { kind }))
    const groups = groupMatches(search(list, 'ceiling'))
    expect(groups.map((g) => g.kind)).toEqual([
      'command', 'scope', 'estimate', 'document', 'page', 'project',
    ])
    expect(groups.map((g) => g.label)).toEqual([
      'Commands', 'Scopes', 'Estimates', 'Documents', 'Pages', 'Projects',
    ])
  })

  it('omits kinds with no matches', () => {
    const list = [cmd('Ceiling grid', { kind: 'scope' }), cmd('Ceiling plan', { kind: 'page' })]
    expect(groupMatches(search(list, 'ceiling')).map((g) => g.kind)).toEqual(['scope', 'page'])
    expect(groupMatches([])).toEqual([])
  })

  it('keeps ranked order inside a group', () => {
    const list = [cmd('Best fit', { kind: 'scope' }), cmd('Fit width', { kind: 'scope' })]
    const [group] = groupMatches(search(list, 'fit'))
    expect(group?.matches.map((m) => m.command.title)).toEqual(['Fit width', 'Best fit'])
  })
})

/**
 * `whenTyped` exists because the palette is the only way to reach most of the
 * application, and 46 generated scale presets listed unconditionally filled
 * the untyped list to its row limit — pushing the estimates, scopes and
 * documents below them off the bottom. Opening the palette to reach a scope
 * showed a wall of scales.
 */
describe('whenTyped', () => {
  const cmd = (id: string, title: string, extra: Partial<Command> = {}): Command =>
    ({ id, kind: 'command', title, run: () => {}, ...extra })

  const commands = [
    cmd('fit', 'Fit sheet'),
    cmd('scale-quarter', 'Set scale 1/4" = 1\'-0"', { whenTyped: true }),
    cmd('scope', 'Scope specifications'),
  ]

  it('is left out of an untyped palette', () => {
    expect(search(commands, '').map((m) => m.command.id)).toEqual(['fit', 'scope'])
  })

  it('is found the moment it is typed for', () => {
    expect(search(commands, 'scale').map((m) => m.command.id)).toContain('scale-quarter')
  })

  it('does not consume a row of the untyped limit', () => {
    // The bug was one of displacement, not of noise: the hidden rows were
    // counted before the limit was applied, so the commands that mattered
    // were the ones that fell off.
    const many = [
      ...Array.from({ length: 60 }, (_, i) => cmd(`s${i}`, `Set scale ${i}`, { whenTyped: true })),
      cmd('last', 'Quantities and bill of materials'),
    ]
    expect(search(many, '').map((m) => m.command.id)).toEqual(['last'])
  })
})
