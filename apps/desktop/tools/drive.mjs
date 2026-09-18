#!/usr/bin/env node
/**
 * Drive the running desktop app over the Chrome DevTools Protocol.
 *
 * Launch the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
 * (the `desktop-debug` launch config does this). Input goes straight to the
 * webview as synthetic events: the system cursor never moves and focus never
 * changes, so the window can sit behind whatever else is open.
 *
 *   node tools/drive.mjs shot out.png            screenshot (renderer, not the screen)
 *   node tools/drive.mjs click 120 340 [ctrl|shift|alt|right|double]
 *   node tools/drive.mjs move 120 340
 *   node tools/drive.mjs drag x0 y0 x1 y1
 *   node tools/drive.mjs key Enter [ctrl|shift|alt]   any DOM key name: k, Escape, ArrowDown, F2
 *   node tools/drive.mjs type "some text"
 *   node tools/drive.mjs wheel x y deltaY [ctrl]
 *   node tools/drive.mjs eval "document.title"       JSON result of an expression (await allowed)
 *   node tools/drive.mjs size                         viewport size in CSS px
 *
 * Coordinates are CSS pixels of the webview, the same frame the screenshot
 * is in. Several commands can be chained with `--` between them.
 */
import { writeFileSync } from 'node:fs'

const PORT = process.env.RB_CDP_PORT ?? '9222'

/**
 * The REDBEAM window, and NOTHING ELSE.
 *
 * This used to fall back to `pages[0]` when it could not find a REDBEAM URL,
 * and that fallback did real harm: WebView2's debugging port is shared by
 * every WebView2 in the session, so when the desktop app's own browser pane
 * was pointed at a third-party site, the driver attached to THAT and began
 * reading a page belonging to the person using the machine.
 *
 * There is no safe guess here. If the app is not on the port, the right
 * answer is to say so and stop, not to drive whatever else is listening.
 */
async function pickTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const pages = list.filter((t) => t.type === 'page' && !/devtools/i.test(t.url))
  const page = pages.find((t) => /^https?:[/][/]localhost:5180[/]/.test(t.url) || /^tauri:/.test(t.url))
  if (!page) {
    const seen = pages.map((t) => t.url).join(', ') || 'nothing'
    throw new Error(
      `no REDBEAM page on port ${PORT} - saw: ${seen}. `
      + 'Start the app with the desktop-debug config. This tool will not drive '
      + 'another page on a shared debugging port.',
    )
  }
  return page
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waits = new Map() }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const c = new Cdp(ws)
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      const w = c.waits.get(msg.id)
      if (w) { c.waits.delete(msg.id); msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result) }
    }
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.waits.set(id, { res, rej }))
  }
  close() { this.ws.close() }
}

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
const mods = (flags) => flags.reduce((n, f) => n | (MOD[f] ?? 0), 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(c, cmd, args) {
  switch (cmd) {
    case 'shot': {
      const { data } = await c.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(args[0] ?? 'shot.png', Buffer.from(data, 'base64'))
      return `wrote ${args[0] ?? 'shot.png'}`
    }
    case 'size': {
      const { result } = await c.send('Runtime.evaluate', { expression: 'JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})' })
      return result.value
    }
    case 'move': {
      const [x, y] = args.map(Number)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      return 'moved'
    }
    case 'click': {
      const [x, y] = args.slice(0, 2).map(Number)
      const flags = args.slice(2)
      const button = flags.includes('right') ? 'right' : 'left'
      const clickCount = flags.includes('double') ? 2 : 1
      const m = mods(flags)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: m })
      for (let i = 1; i <= clickCount; i++) {
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i, modifiers: m })
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i, modifiers: m })
      }
      return `clicked ${x},${y}`
    }
    case 'drag': {
      const [x0, y0, x1, y1] = args.map(Number)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 })
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 })
      const steps = 8
      for (let i = 1; i <= steps; i++) {
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, button: 'left', buttons: 1 })
        await sleep(16)
      }
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 })
      return `dragged to ${x1},${y1}`
    }
    case 'key': {
      const key = args[0]
      const m = mods(args.slice(1))
      const single = key.length === 1
      const code = single ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /[0-9]/.test(key) ? `Digit${key}` : undefined) : key
      const base = { key, code, modifiers: m, windowsVirtualKeyCode: single ? key.toUpperCase().charCodeAt(0) : VK[key] }
      await c.send('Input.dispatchKeyEvent', { type: single && !m ? 'keyDown' : 'rawKeyDown', ...base, ...(single && !m ? { text: key } : {}) })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      return `key ${key}`
    }
    case 'type': {
      await c.send('Input.insertText', { text: args.join(' ') })
      return 'typed'
    }
    case 'wheel': {
      const [x, y, deltaY] = args.slice(0, 3).map(Number)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: mods(args.slice(3)) })
      return 'wheeled'
    }
    case 'eval': {
      const { result, exceptionDetails } = await c.send('Runtime.evaluate', {
        expression: args.join(' '), awaitPromise: true, returnByValue: true,
      })
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'eval failed')
      return JSON.stringify(result.value)
    }
    case 'wait': { await sleep(Number(args[0] ?? 300)); return 'waited' }
    default: throw new Error(`unknown command ${cmd}`)
  }
}

const VK = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32, F2: 113 }

const groups = []
let cur = []
for (const a of process.argv.slice(2)) { if (a === '--') { groups.push(cur); cur = [] } else cur.push(a) }
groups.push(cur)

const target = await pickTarget()
const c = await Cdp.connect(target.webSocketDebuggerUrl)
try {
  for (const [cmd, ...args] of groups) {
    if (!cmd) continue
    console.log(await run(c, cmd, args))
  }
} finally { c.close() }
