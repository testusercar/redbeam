// The domain package must not depend on the DOM, SQL, rendering, or React.
// That property is what made the Qt build's logic liftable at all; guard it.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'packages', 'domain', 'src')
const BANNED = [/\bdocument\./, /\bwindow\./, /\bcanvas/i, /from ['"]react/, /from ['"]@redbeam\/(viewer|store)/, /sqlite/i]

let bad = 0
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8')
  src.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return
    for (const re of BANNED) {
      if (re.test(line)) { console.error(`${f}:${i + 1}  ${re} -> ${line.trim()}`); bad++ }
    }
  })
}
if (bad) { console.error(`\ndomain purity: ${bad} violation(s)`); process.exit(1) }
console.log('domain purity: clean')
