import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { migrate, type Migration, type SqlDriver } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import { ensureDocumentAndPage } from './repo.js'
import {
  boxesForSpans,
  buildSnippet,
  clearPageText,
  findSpans,
  getPageText,
  hasFts5,
  indexPageText,
  searchDocumentText,
  searchProjectText,
  textIndexCoverage,
  toFts5Match,
  toLikePattern,
  type PageLayout,
} from './search.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
      return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
    })
}

/**
 * `node:sqlite` is reached through createRequire, not a static import: Vite's
 * dependency scanner does not know that builtin and tries to resolve a package
 * called "sqlite", which fails before a single test runs.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => NodeDb
}

interface NodeDb {
  exec(sql: string): void
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown }
  close(): void
}

/**
 * SqlDriver over Node's built-in SQLite.
 *
 * This exists for one reason: the FTS5 path must be exercised against real
 * SQLite with a real FTS5 module, not a mock. sql.js ships FTS3, so under it
 * `page_text_fts` is never created and only the LIKE path can run. Node 25's
 * bundled SQLite (3.51.1) has FTS5 compiled in, so the same migrations, the
 * same MATCH expressions and the same snippets run here exactly as they will
 * on the desktop core's native SQLite.
 */
class NodeSqliteDriver implements SqlDriver {
  constructor(readonly db: NodeDb) {}
  static open(): NodeSqliteDriver {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    return new NodeSqliteDriver(db)
  }
  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }
  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]))
  }
  close(): void {
    this.db.close()
  }
}

const DOC = { id: 'doc-1', relativePath: 'PKG-A-ARCH.pdf', displayName: 'PKG A ARCH' }
const DOC2 = { id: 'doc-2', relativePath: 'PKG-B-MECH.pdf', displayName: 'PKG B MECH' }

const PAGE_TEXT: Record<string, string> = {
  'p1': 'ROOM 101 REFLECTED CEILING PLAN\r\nCL03 BAFFLE 24"x48"\r\nSTAIR A',
  'p2': 'ROOM 102 FLOOR PLAN\r\nplanning notes for the ceiling grid\r\nCL-03 tag',
  'p3': 'MECHANICAL SCHEDULE\r\nDUCT 24 x 12\r\nno ceiling here',
}

async function seed(db: SqlDriver) {
  await ensureDocumentAndPage(db, DOC, { id: 'p1', documentId: 'doc-1', pageNumber: 1, width: 3456, height: 2592 })
  await ensureDocumentAndPage(db, DOC, { id: 'p2', documentId: 'doc-1', pageNumber: 2, width: 3456, height: 2592 })
  await ensureDocumentAndPage(db, DOC2, { id: 'p3', documentId: 'doc-2', pageNumber: 1, width: 612, height: 792 })
  // A fourth page that is never indexed — coverage must notice it.
  await ensureDocumentAndPage(db, DOC2, { id: 'p4', documentId: 'doc-2', pageNumber: 2, width: 612, height: 792 })
  for (const [pageId, content] of Object.entries(PAGE_TEXT)) {
    await indexPageText(db, { pageId, documentId: pageId === 'p3' ? 'doc-2' : 'doc-1', content })
  }
}

// ------------------------------------------------------------ pure helpers --

describe('toFts5Match — user input is not FTS5 syntax', () => {
  it('quotes each token as a phrase, ANDing them', () => {
    expect(toFts5Match('ceiling plan').match).toBe('"ceiling" "plan"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    // The Qt build shipped a defect where an unbalanced quote reached MATCH raw
    // and produced a parse error.
    expect(toFts5Match('24"x48"').match).toBe('"24""x48"""')
    expect(toFts5Match('a"b').match).toBe('"a""b"')
  })

  it('neutralises every FTS5 operator by making it phrase text', () => {
    expect(toFts5Match('a AND b').match).toBe('"a" "AND" "b"')
    expect(toFts5Match('NEAR(a b)').match).toBe('"NEAR(a" "b)"')
    expect(toFts5Match('content:secret').match).toBe('"content:secret"')
    expect(toFts5Match('pre*').match).toBe('"pre*"')
    expect(toFts5Match('^start').match).toBe('"^start"')
  })

  it('drops tokens with nothing indexable in them and says so', () => {
    const r = toFts5Match('- ceiling "')
    expect(r.match).toBe('"ceiling"')
    expect(r.dropped).toEqual(['-', '"'])
  })

  it('yields an empty expression when nothing survives', () => {
    expect(toFts5Match('  --  ').match).toBe('')
    expect(toFts5Match('').tokens).toEqual([])
  })

  it('keeps hyphenated and non-ASCII tokens', () => {
    expect(toFts5Match('CL-03').match).toBe('"CL-03"')
    expect(toFts5Match('café').match).toBe('"café"')
  })
})

describe('toLikePattern', () => {
  it('escapes LIKE wildcards so they cannot be injected', () => {
    expect(toLikePattern('100%')).toBe('%100\\%%')
    expect(toLikePattern('a_b')).toBe('%a\\_b%')
    expect(toLikePattern('c\\d')).toBe('%c\\\\d%')
  })
})

describe('findSpans', () => {
  it('whole-word mode does not match inside a longer word', () => {
    expect(findSpans('plan planning', 'plan', true)).toEqual([{ start: 0, length: 4 }])
  })

  it('substring mode does', () => {
    expect(findSpans('plan planning', 'plan', false)).toHaveLength(2)
  })

  it('treats regex metacharacters as literals', () => {
    expect(findSpans('a.b axb', 'a.b', false)).toEqual([{ start: 0, length: 3 }])
    expect(findSpans('x', '(', false)).toEqual([])
  })
})

describe('buildSnippet', () => {
  const content = 'ROOM 101 REFLECTED CEILING PLAN\r\nCL03 BAFFLE'

  it('centres on the first match and reports offsets into the snippet', () => {
    const s = buildSnippet(content, [{ start: 19, length: 7 }], 40)
    expect(s.snippet).toContain('CEILING')
    const hl = s.snippetSpans[0]!
    expect(s.snippet.slice(hl.start, hl.start + hl.length)).toBe('CEILING')
  })

  it('collapses newlines so a snippet is one line', () => {
    const s = buildSnippet(content, [{ start: 33, length: 4 }], 200)
    expect(s.snippet).not.toMatch(/[\r\n]/)
    const hl = s.snippetSpans[0]!
    expect(s.snippet.slice(hl.start, hl.start + hl.length)).toBe('CL03')
  })

  it('falls back to a head excerpt when there are no spans', () => {
    expect(buildSnippet(content, [], 20).snippetSpans).toEqual([])
    expect(buildSnippet(content, [], 20).snippet.endsWith('…')).toBe(true)
  })
})

describe('boxesForSpans', () => {
  const layout: PageLayout = {
    runs: [
      { start: 0, length: 4, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.12 },
      { start: 5, length: 3, x0: 0.3, y0: 0.1, x1: 0.35, y1: 0.12 },
    ],
  }

  it('returns only the runs a span touches', () => {
    expect(boxesForSpans(layout, [{ start: 5, length: 3 }])).toEqual([
      { x0: 0.3, y0: 0.1, x1: 0.35, y1: 0.12 },
    ])
  })

  it('returns nothing for no spans', () => {
    expect(boxesForSpans(layout, [])).toEqual([])
  })

  it('picks up a span that only partially overlaps a run', () => {
    expect(boxesForSpans(layout, [{ start: 2, length: 1 }])).toHaveLength(1)
  })
})

// -------------------------------------------------------- FTS5, real SQLite --

describe('search — FTS5 path on real SQLite', () => {
  let db: NodeSqliteDriver

  beforeEach(async () => {
    db = NodeSqliteDriver.open()
    const r = await migrate(db, loadMigrations())
    // The whole point of this driver: nothing was skipped.
    expect(r.skipped).toEqual([])
    await seed(db)
  })

  it('really has FTS5 and its shadow tables', async () => {
    expect(await hasFts5(db)).toBe(true)
    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name LIKE 'page_text_fts%' ORDER BY name",
    )
    expect(rows.map((r) => r.name)).toEqual([
      'page_text_fts',
      'page_text_fts_config',
      'page_text_fts_content',
      'page_text_fts_data',
      'page_text_fts_docsize',
      'page_text_fts_idx',
    ])
  })

  it('answers in fts5 mode with no degradation notice', async () => {
    const r = await searchProjectText(db, 'ceiling')
    expect(r.mode).toBe('fts5')
    expect(r.degraded).toBeNull()
    expect(r.hits.map((h) => h.pageId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('matches whole tokens, not substrings', async () => {
    // p2 contains "planning"; an FTS5 search for "plan" must not return it on
    // that basis. p2 also contains "PLAN" as a word, so scope to p1/p3 logic:
    const r = await searchProjectText(db, 'lan')
    expect(r.hits).toEqual([])
  })

  it('ANDs multiple terms across the page', async () => {
    expect((await searchProjectText(db, 'ceiling baffle')).hits.map((h) => h.pageId)).toEqual(['p1'])
    expect((await searchProjectText(db, 'ceiling mechanical')).hits.map((h) => h.pageId)).toEqual(['p3'])
  })

  it('scopes to one document', async () => {
    const r = await searchDocumentText(db, 'doc-1', 'ceiling')
    expect(r.hits.map((h) => h.pageId)).toEqual(['p1', 'p2'])
    expect(r.totalPageCount).toBe(2)
  })

  it('reports coverage so an empty result is not mistaken for absence', async () => {
    const r = await searchProjectText(db, 'nonexistentterm')
    expect(r.hits).toEqual([])
    expect(r.indexedPageCount).toBe(3)
    expect(r.totalPageCount).toBe(4)
    expect(r.ftsPageCount).toBe(3)
  })

  it('returns page id, page number, path, snippet and highlight offsets', async () => {
    const [hit] = (await searchProjectText(db, 'baffle')).hits
    expect(hit!.pageId).toBe('p1')
    expect(hit!.pageNumber).toBe(1)
    expect(hit!.documentId).toBe('doc-1')
    expect(hit!.relativePath).toBe('PKG-A-ARCH.pdf')
    expect(hit!.spans).toHaveLength(1)
    const s = hit!.snippetSpans[0]!
    expect(hit!.snippet.slice(s.start, s.start + s.length).toLowerCase()).toBe('baffle')
  })

  it('returns normalized boxes when a layout is supplied, null when not', async () => {
    const plain = await searchProjectText(db, 'baffle')
    expect(plain.hits[0]!.boxes).toBeNull()

    const content = PAGE_TEXT['p1']!
    const at = content.indexOf('BAFFLE')
    const layout: PageLayout = {
      runs: [
        { start: content.indexOf('CL03'), length: 4, x0: 0.1, y0: 0.5, x1: 0.15, y1: 0.52 },
        { start: at, length: 6, x0: 0.2, y0: 0.5, x1: 0.28, y1: 0.52 },
      ],
    }
    const withBoxes = await searchProjectText(db, 'baffle', { layout: (id) => (id === 'p1' ? layout : undefined) })
    expect(withBoxes.hits[0]!.boxes).toEqual([{ x0: 0.2, y0: 0.5, x1: 0.28, y1: 0.52 }])
  })

  it('treats a hyphenated token as an adjacent phrase, as FTS5 does', async () => {
    // FTS5 tokenizes the phrase "CL-03" to cl + 03 and requires them ADJACENT.
    // p2 has "CL-03" and matches. p1 has "CL03", which is the single token
    // cl03, and does NOT — pinned here because it is a real and surprising
    // difference from the LIKE path, which finds neither.
    const r = await searchProjectText(db, 'CL-03')
    expect(r.hits.map((h) => h.pageId)).toEqual(['p2'])
    // The hit still has something to highlight: the literal token is on the
    // page, so the span lands without needing the sub-term fallback.
    expect(r.hits[0]!.spans.length).toBeGreaterThan(0)
  })

  it('falls back to sub-terms when the literal token is not on the page', async () => {
    // "24\"x48\"" tokenizes to 24 + x + 48. p1 carries that string literally;
    // p3 has "DUCT 24 x 12", which does not contain the token as typed.
    const r = await searchProjectText(db, '24 x')
    const p3 = r.hits.find((h) => h.pageId === 'p3')
    expect(p3).toBeTruthy()
    expect(p3!.spans.length).toBeGreaterThan(0)
  })

  it('groups by document then page by default, and ranks on request', async () => {
    // Page number alone would interleave the two documents as 1, 1, 2.
    const byPage = await searchProjectText(db, 'ceiling')
    expect(byPage.hits.map((h) => `${h.documentId}#${h.pageNumber}`)).toEqual([
      'doc-1#1', 'doc-1#2', 'doc-2#1',
    ])
    const byRank = await searchProjectText(db, 'ceiling', { orderBy: 'relevance' })
    expect(byRank.mode).toBe('fts5')
    expect(byRank.hits).toHaveLength(3)
  })

  it('truncates and says so', async () => {
    const r = await searchProjectText(db, 'ceiling', { limit: 1 })
    expect(r.hits).toHaveLength(1)
    expect(r.truncated).toBe(true)
  })

  // ---- the injection / crash surface, against a live FTS5 parser ----

  const HOSTILE = [
    '"',
    '""',
    'a"b',
    '24"x48"',
    'CL-03',
    '-',
    '- ceiling',
    '*',
    'pre*',
    '^ceiling',
    'ceiling OR baffle',
    'ceiling AND baffle',
    'ceiling NOT baffle',
    'NEAR(ceiling baffle, 3)',
    'content:ceiling',
    '(ceiling',
    'ceiling)',
    '{content} : ceiling',
    "'; DROP TABLE page_text; --",
    'ceiling"" OR "1"="1',
    ' ceiling',
    'ceiling ',
    // A NUL anywhere in the MATCH expression aborts the statement with
    // "unterminated string" — quoting does not help, because it is the FTS5
    // grammar that chokes, not SQL parsing. Found by accident; kept on purpose.
    'ceil\u0000ing',
    '\u0000',
  ]

  it('never throws on hostile input, whatever it is', async () => {
    for (const q of HOSTILE) {
      // Name the input in the failure, or a parse error is a mystery.
      const r = await searchProjectText(db, q).catch((e: unknown) => {
        throw new Error(`${JSON.stringify(q)} threw: ${e instanceof Error ? e.message : String(e)}`)
      })
      expect(r.mode).toBe('fts5')
      expect(Array.isArray(r.hits)).toBe(true)
    }
    // and the table is still there afterwards
    expect((await textIndexCoverage(db)).indexedPageCount).toBe(3)
  })

  it('treats FTS5 boolean operators as literal words, not operators', async () => {
    // If OR were honoured this would return every page with either term.
    // As phrases it means "a page containing ceiling, OR and baffle" — none.
    expect((await searchProjectText(db, 'ceiling OR baffle')).hits).toEqual([])
  })

  it('treats a column filter as literal text', async () => {
    expect((await searchProjectText(db, 'content:ceiling')).hits).toEqual([])
  })

  it('does not expand a trailing asterisk into a prefix search', async () => {
    // "ceil*" would match "ceiling" if * reached the parser.
    expect((await searchProjectText(db, 'ceil*')).hits).toEqual([])
  })

  it('handles a query that is only punctuation without running a MATCH', async () => {
    const r = await searchProjectText(db, '--- "" ---')
    expect(r.hits).toEqual([])
    expect(r.droppedTokens).toEqual(['---', '""', '---'])
    expect(r.matchExpression).toBe('')
  })

  it('reports the MATCH expression it actually ran', async () => {
    expect((await searchProjectText(db, '24"x48"')).matchExpression).toBe('"24""x48"""')
  })
})

describe('indexing — real SQLite', () => {
  let db: NodeSqliteDriver

  beforeEach(async () => {
    db = NodeSqliteDriver.open()
    await migrate(db, loadMigrations())
    await seed(db)
  })

  it('writes page_text and page_text_fts with the migration column names', async () => {
    expect(await getPageText(db, 'p1')).toBe(PAGE_TEXT['p1'])
    const fts = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM page_text_fts WHERE page_id=?', ['p1'])
    expect(Number(fts[0]!.n)).toBe(1)
  })

  it('re-indexing replaces rather than duplicating the FTS row', async () => {
    await indexPageText(db, { pageId: 'p1', documentId: 'doc-1', content: 'REPLACED CEILING' })
    const fts = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM page_text_fts WHERE page_id=?', ['p1'])
    expect(Number(fts[0]!.n)).toBe(1)
    expect(await getPageText(db, 'p1')).toBe('REPLACED CEILING')
    expect((await searchProjectText(db, 'baffle')).hits).toEqual([])
    expect((await searchProjectText(db, 'replaced')).hits.map((h) => h.pageId)).toEqual(['p1'])
  })

  it('keeps pages.native_text_available honest about what was found', async () => {
    const before = await db.all<{ v: number; at: string | null }>(
      'SELECT native_text_available AS v, text_indexed_at AS at FROM pages WHERE id=?',
      ['p1'],
    )
    expect(Number(before[0]!.v)).toBe(1)
    expect(before[0]!.at).toBeTruthy()

    // A scanned sheet: indexed, but with nothing in it.
    await indexPageText(db, { pageId: 'p4', documentId: 'doc-2', content: '   ' })
    const after = await db.all<{ v: number }>('SELECT native_text_available AS v FROM pages WHERE id=?', ['p4'])
    expect(Number(after[0]!.v)).toBe(0)
    expect((await textIndexCoverage(db)).emptyTextPageCount).toBe(1)
  })

  it('clearPageText removes the page from both tables', async () => {
    await clearPageText(db, 'p1')
    expect(await getPageText(db, 'p1')).toBeNull()
    expect((await textIndexCoverage(db)).ftsPageCount).toBe(2)
    expect((await searchProjectText(db, 'baffle')).hits).toEqual([])
  })

  it('honours the ON DELETE CASCADE from pages', async () => {
    await db.run('DELETE FROM pages WHERE id=?', ['p1'])
    expect(await getPageText(db, 'p1')).toBeNull()
  })
})

// ------------------------------------------- LIKE fallback, sql.js (no FTS5) --

describe('search — LIKE fallback on sql.js', () => {
  let db: SqlJsDriver

  beforeEach(async () => {
    db = await SqlJsDriver.open()
    const r = await migrate(db, loadMigrations())
    // This is the whole reason the fallback exists.
    expect(r.skipped.map((s) => s.statement).join(' ')).toContain('fts5')
    await seed(db)
  })

  it('detects that there is no FTS5 index', async () => {
    expect(await hasFts5(db)).toBe(false)
  })

  it('answers anyway, and says the answer is degraded and why', async () => {
    const r = await searchProjectText(db, 'ceiling')
    expect(r.mode).toBe('like')
    expect(r.degraded).not.toBeNull()
    expect(r.degraded!.reason).toContain('FTS5')
    expect(r.degraded!.consequences.join(' ')).toContain('substring')
    expect(r.hits.map((h) => h.pageId).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(r.ftsPageCount).toBe(0)
  })

  it('matches substrings — the concrete behavioural difference from FTS5', async () => {
    const r = await searchProjectText(db, 'lan')
    expect(r.mode).toBe('like')
    // FTS5 returns nothing for this; LIKE finds it inside PLAN / planning.
    expect(r.hits.map((h) => h.pageId)).toEqual(['p1', 'p2'])
  })

  it('still ANDs multiple terms, so multi-word queries agree with FTS5', async () => {
    expect((await searchProjectText(db, 'ceiling baffle')).hits.map((h) => h.pageId)).toEqual(['p1'])
  })

  it('cannot rank, and says so when ranking was asked for', async () => {
    const r = await searchProjectText(db, 'ceiling', { orderBy: 'relevance' })
    expect(r.degraded!.consequences.join(' ')).toContain('Relevance ordering')
    expect(r.hits.map((h) => `${h.documentId}#${h.pageNumber}`)).toEqual([
      'doc-1#1', 'doc-1#2', 'doc-2#1',
    ])
  })

  it('does not let LIKE wildcards through', async () => {
    // '%' would match every page if it reached the pattern unescaped.
    expect((await searchProjectText(db, 'ceil%ng')).hits).toEqual([])
    expect((await searchProjectText(db, '_')).hits).toEqual([])
  })

  it('survives the same hostile input as the FTS5 path', async () => {
    for (const q of ['"', "'; DROP TABLE page_text; --", '*', '%', 'a"b', 'NEAR(a b)']) {
      const r = await searchProjectText(db, q)
      expect(Array.isArray(r.hits)).toBe(true)
    }
    expect((await textIndexCoverage(db)).indexedPageCount).toBe(3)
  })

  it('carries boxes through the degraded path too', async () => {
    const content = PAGE_TEXT['p1']!
    const layout: PageLayout = {
      runs: [{ start: content.indexOf('BAFFLE'), length: 6, x0: 0.2, y0: 0.5, x1: 0.28, y1: 0.52 }],
    }
    const r = await searchProjectText(db, 'baffle', { layout: () => layout })
    expect(r.hits[0]!.boxes).toEqual([{ x0: 0.2, y0: 0.5, x1: 0.28, y1: 0.52 }])
  })
})

describe('search — forcing the degraded mode', () => {
  it('lets a caller preview LIKE behaviour on a database that has FTS5', async () => {
    const db = NodeSqliteDriver.open()
    await migrate(db, loadMigrations())
    await seed(db)
    const r = await searchProjectText(db, 'lan', { mode: 'like' })
    expect(r.mode).toBe('like')
    expect(r.degraded!.reason).toContain('explicitly')
    expect(r.hits.map((h) => h.pageId)).toEqual(['p1', 'p2'])
  })
})

describe('page number semantics', () => {
  // A doc comment once claimed this was 1-based. It is not — it is passed
  // through from pages.page_number, which is zero-based. A UI navigating from
  // a hit would land one sheet past it. Pinned so the claim cannot drift back.
  it('reports pageNumber zero-based, exactly as stored', async () => {
    const db = await SqlJsDriver.open()
    await migrate(db, loadMigrations())
    await ensureDocumentAndPage(db, DOC, {
      id: 'pz', documentId: 'doc-1', pageNumber: 0, width: 100, height: 100,
    })
    await indexPageText(db, {
      pageId: 'pz', documentId: 'doc-1', content: 'ELEVATOR LOBBY',
    })
    const r = await searchProjectText(db, 'lobby')
    const hit = r.hits.find((h) => h.pageId === 'pz')
    expect(hit).toBeDefined()
    expect(hit!.pageNumber).toBe(0)
  })
})
