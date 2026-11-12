import { describe, expect, it } from 'vitest'
import { projectDrawingFile, sha256Hex } from './drawingSync.js'

describe('project drawing file', () => {
  it('hashes like the Rust side', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('passes the hash it read as the expected version, and reports a refused write as false', async () => {
    const calls: string[] = []
    const file = projectDrawingFile({
      readDocument: async () => new TextEncoder().encode('abc'),
      writeDocument: async (_p, rel, _b, expected) => {
        calls.push(`${rel}:${expected.slice(0, 6)}`)
        return calls.length === 1 ? { outcome: 'written', fingerprint: 'x' } : { outcome: 'changed' }
      },
    }, '/job', 'A-101.pdf')
    const { bytes, version } = await file.read()
    expect(await file.write(bytes, version)).toBe(true)
    expect(await file.write(bytes, version)).toBe(false)
    expect(calls).toEqual(['A-101.pdf:ba7816', 'A-101.pdf:ba7816'])
  })
})
