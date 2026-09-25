/**
 * The sidebar block is absent unless an update is available, and the
 * what's-new modal opens once for the version that was just installed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadyToUpdateBlock } from './ReadyToUpdate.js'
import { NotesDialog } from './NotesDialog.js'
import {
  markWhatsNewSeen, manifestNotes, notesBody, rememberInstalledNotes,
  shouldShowInstalledWhatsNew, sidebarUpdateCopy, sidebarUpdateVisible,
  type NotesStore,
} from './releaseNotes.js'
import type { UpdateState } from './updates.js'

function memoryStore(): NotesStore {
  const data = new Map<string, string>()
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value) },
  }
}

const quiet: UpdateState[] = [
  { kind: 'idle' },
  { kind: 'checking' },
  { kind: 'current' },
  { kind: 'failed', message: 'network unreachable' },
  { kind: 'unconfigured' },
]

describe('the sidebar block', () => {
  it('is absent when no update is available', () => {
    for (const state of quiet) {
      expect(sidebarUpdateVisible(state), state.kind).toBe(false)
      expect(sidebarUpdateCopy(state), state.kind).toBeNull()
      const html = renderToStaticMarkup(
        <ReadyToUpdateBlock
          state={state}
          onInstall={() => {}}
          onRestart={() => {}}
          onReview={() => {}}
        />,
      )
      expect(html, state.kind).toBe('')
    }
  })

  it('offers the install, and keeps the notes off the block', () => {
    const state: UpdateState = { kind: 'available', version: '0.9.0', notes: 'Fixed the scale badge.' }
    expect(sidebarUpdateVisible(state)).toBe(true)
    const copy = sidebarUpdateCopy(state)
    expect(copy?.title).toBe('Ready to update')
    expect(copy?.note).toMatch(/available to install/)
    expect(copy?.action).toBe('install')
    const html = renderToStaticMarkup(
      <ReadyToUpdateBlock state={state} onInstall={() => {}} onRestart={() => {}} onReview={() => {}} />,
    )
    const text = html.replace(/&#x27;/g, "'")
    expect(text).toContain('Ready to update')
    expect(text).toContain('available to install')
    expect(text).toContain("Review what's new")
    expect(text).not.toContain('Fixed the scale badge.')
  })

  it('sits directly above Settings', () => {
    const src = readFileSync(fileURLToPath(new URL('../shell/Shell.tsx', import.meta.url)), 'utf8')
    const update = src.indexOf('<ReadyToUpdate')
    const settings = src.indexOf('className="sidesettings"')
    expect(update).toBeGreaterThan(-1)
    expect(settings).toBeGreaterThan(update)
  })
})

describe("what's new, once per installed version", () => {
  it('stays closed until this version was installed, then once', () => {
    const store = memoryStore()
    expect(shouldShowInstalledWhatsNew('0.3.3', store)).toBe(false)

    rememberInstalledNotes('0.3.3', 'Fixed snap.', store)
    expect(shouldShowInstalledWhatsNew('0.3.2', store)).toBe(false)
    expect(shouldShowInstalledWhatsNew('0.3.3', store)).toBe(true)

    markWhatsNewSeen('0.3.3', store)
    expect(shouldShowInstalledWhatsNew('0.3.3', store)).toBe(false)

    rememberInstalledNotes('0.3.4', 'Again.', store)
    expect(shouldShowInstalledWhatsNew('0.3.3', store)).toBe(false)
    expect(shouldShowInstalledWhatsNew('0.3.4', store)).toBe(true)
  })

  it('titles the post-update modal and uses the manifest notes', () => {
    expect(manifestNotes('  ')).toBeNull()
    expect(notesBody(null)).toBe('This release did not include notes.')
    expect(notesBody('Fixed the scale badge.')).toBe('Fixed the scale badge.')
    const html = renderToStaticMarkup(
      <NotesDialog
        title="What's new in this version."
        version="0.3.3"
        notes="Fixed the scale badge."
        confirmLabel={null}
        onClose={() => {}}
      />,
    )
    const text = html.replace(/&#x27;/g, "'")
    expect(text).toContain("What's new in this version.")
    expect(text).toContain('Fixed the scale badge.')
    expect(text).not.toContain('Download and install')
  })

  it('records the manifest notes when an install finishes', () => {
    const src = readFileSync(fileURLToPath(new URL('./session.ts', import.meta.url)), 'utf8')
    const install = src.slice(src.indexOf("if (action === 'install')"))
    expect(install).toContain('rememberInstalledNotes')
    expect(install).toContain('update.body')
  })
})

describe('help', () => {
  it('is opened from settings and does not pretend feedback was sent', () => {
    const settings = readFileSync(fileURLToPath(new URL('../settings/SettingsPanel.tsx', import.meta.url)), 'utf8')
    const help = readFileSync(fileURLToPath(new URL('../settings/HelpPage.tsx', import.meta.url)), 'utf8')
    expect(settings).toContain('Help')
    expect(settings).toContain('<HelpBody />')
    expect(help).toContain('Take off')
    expect(help).toContain('Calibrate from the drawing')
    expect(help).toContain('Worker-side Notion token')
    expect(help).not.toMatch(/github\.com/i)
    expect(help).not.toMatch(/Feedback sent|Thanks for/)
    expect(help).toContain('Not sent.')
  })
})
