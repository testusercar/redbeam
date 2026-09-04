#!/usr/bin/env node
/**
 * MCP server for the REDBEAM automation bridge (plan 11.1).
 *
 * Exposes the bridge's methods as MCP tools so an agent gets them as
 * first-class tools rather than shelling out to a script.
 *
 * Dependency-free on purpose, matching the Qt build's server: newline-
 * delimited JSON-RPC on stdio, and a plain TCP socket to the app. Adding an
 * SDK here would put a dependency between an agent and the app it is meant to
 * be debugging, which is exactly the layer you want to stay boring.
 *
 * The app must be running with REDBEAM_BRIDGE=1. Every tool reports a clear
 * "start the app" error rather than hanging when it is not.
 */
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVER_INFO = { name: 'redbeam', version: '0.1.0' }
const DISCOVERY_FILE = path.join(os.tmpdir(), 'redbeam-bridge.json')
const CALL_TIMEOUT_MS = Number(process.env['REDBEAM_BRIDGE_TIMEOUT_MS'] ?? 30000)

// --------------------------------------------------------------- transport --

function readDiscovery() {
  if (!fs.existsSync(DISCOVERY_FILE)) {
    throw new Error(
      `REDBEAM bridge is not running. Start the app with REDBEAM_BRIDGE=1 ` +
      `(discovery file expected at ${DISCOVERY_FILE}).`,
    )
  }
  const d = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'))
  if (!d.port || !d.token) throw new Error(`Malformed bridge discovery file: ${DISCOVERY_FILE}`)
  return d
}

/**
 * One call, one connection — matching the bridge.
 *
 * The discovery file is re-read per call rather than cached: the app restarts
 * often during development and gets a new port and token each time. A cached
 * handle would fail with a confusing connection error long after the real
 * cause (a restart) had scrolled away.
 */
function bridgeCall(method, params = {}) {
  const d = readDiscovery()
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(d.port, '127.0.0.1')
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out after ${CALL_TIMEOUT_MS}ms waiting for bridge method ${method}`))
    }, CALL_TIMEOUT_MS)

    socket.on('connect', () =>
      socket.write(JSON.stringify({ id: 1, method, token: d.token, params }) + '\n'))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const nl = buffer.indexOf('\n')
      if (nl === -1) return
      clearTimeout(timer)
      socket.end()
      try {
        const res = JSON.parse(buffer.slice(0, nl).trim())
        if (res.ok) resolve(res.result)
        else reject(new Error(res.error ?? `bridge method ${method} failed`))
      } catch (e) {
        reject(e)
      }
    })
    socket.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(
        `Could not reach the REDBEAM bridge on 127.0.0.1:${d.port} (${e.message}). ` +
        `The app may have been restarted — its port and token change each launch.`,
      ))
    })
  })
}

// ------------------------------------------------------------------- tools --

/**
 * Tool definitions.
 *
 * Descriptions say what a result MEANS, not just what the call does, because
 * that is what stops an agent misreading one — `open_project` returning
 * `accepted` is the obvious trap.
 */
const tools = [
  {
    name: 'redbeam_get_state',
    description:
      'Whether a project is open, its database path and schema version. Cheap; ' +
      'answers from the store even when the window is minimized or busy.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'redbeam_project_summary',
    description:
      'Counts of documents, pages, scopes, markups and calibrated pages. The ' +
      'fastest way to see whether an ingest has finished.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'redbeam_open_project',
    description:
      'Ask the app to open a project folder. Returns {accepted:true} — NOT ' +
      '"opened". The open happens on the UI thread afterwards; poll ' +
      'redbeam_get_state until projectOpen is true.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to the project folder.' } },
      required: ['path'],
    },
  },
  {
    name: 'redbeam_list_documents',
    description: 'Documents in the open project. Capped; `truncated` says when there are more.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max rows (1-5000, default 500).' } },
    },
  },
  {
    name: 'redbeam_list_pages',
    description: 'Pages, optionally for one document. page_number is ZERO-based.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'redbeam_list_scopes',
    description: 'Scopes in the open project. Archived scopes are hidden unless asked for.',
    inputSchema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean' } },
    },
  },
  {
    name: 'redbeam_list_markups',
    description:
      'Markups, filterable by page, scope or document. Soft-deleted markups are ' +
      'excluded unless includeDeleted is set — they are kept for audit and are not live takeoff.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        scopeId: { type: 'string' },
        documentId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'redbeam_get_calibration',
    description: 'Calibration per page, as feet per PDF point. Without one, no quantity is in feet.',
    inputSchema: { type: 'object', properties: { pageId: { type: 'string' } } },
  },
  {
    name: 'redbeam_execute_query',
    description:
      'Run one read-only SELECT against the project database. Writes are refused: ' +
      'a write here would change a takeoff with no undo entry and no activity row.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'One SELECT or WITH statement. No semicolons.' },
        params: { type: 'array', description: 'Positional parameters for ?1, ?2, …' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'redbeam_get_ui_state',
    description:
      'What the window is showing: active document and page, tool, active scope, ' +
      'zoom, selection, open panels, and the computed quantities and piece counts. ' +
      'Needs a window — fails if none is open.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'redbeam_screenshot',
    description:
      'PNG of the current canvas, raster and markup overlay composited. Needs a ' +
      'window with a project open.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'boolean', description: 'Include the markup overlay (default true).' },
      },
    },
  },
  {
    name: 'redbeam_get_bom',
    description:
      'The bill of materials — what to ORDER, per scope: the deliverable a ' +
      'takeoff exists to produce, computed from the same roll-up the panel ' +
      'renders. Read `confidence` per line before quoting any number: a ' +
      '`blocked` line carries quantity null (the scope is missing something, ' +
      'and 0 would be a claim), and an `unverified` line is a count this build ' +
      'has never checked against the Qt original. `totals` deliberately sums ' +
      'VERIFIED lines only, so it does not agree with adding the rows up — a ' +
      'total that mixes a checked number with an unchecked one hides which is ' +
      'which. Needs a window. Empty until pages are calibrated.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'redbeam_export',
    description:
      'Produce the takeoff package. `tsv` is the pricing sheet and `report` is ' +
      'the branded self-contained HTML; both come back as TEXT in the reply ' +
      'rather than as a saved file, because the buttons hand a blob to the ' +
      "browser's downloader and put it somewhere an agent can neither read nor " +
      'choose — write the string yourself if you want a file. `marked-pdf` is ' +
      'the exception: it writes the OPEN drawing with its markups on it and ' +
      'lands in the user\'s downloads, so it reports only whether it was ' +
      'written, and it covers one document, not the project. Needs a window. ' +
      'The ESTIMATE exports — `csv`, `estimate-tsv` and `pdf` — cover one ' +
      'round: every scope with its measured quantity and its components. csv ' +
      'and estimate-tsv return content; pdf renders the branded document with ' +
      'a picture of every sheet that carries takeoff and saves it to downloads.',
    inputSchema: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['tsv', 'report', 'marked-pdf', 'csv', 'estimate-tsv', 'pdf'],
          description:
            'tsv, report, csv and estimate-tsv return content; marked-pdf and ' +
            "pdf save a file to the user's downloads and return {saved:true}.",
        },
        estimateId: {
          type: 'string',
          description:
            'For csv, estimate-tsv and pdf: which round. Defaults to the open one.',
        },
      },
      required: ['what'],
    },
  },
  {
    name: 'redbeam_invoke_ui_action',
    description:
      'Drive the app the way a person would. Navigation and reads: set_tool, ' +
      'set_active_scope, go_to_page, set_layout_preview, open_panel, ' +
      'get_scale_presets, get_bom, export. Takeoff writes: create_markup, ' +
      'delete_markup, set_calibration, reassign_markup, set_scope_direction. ' +
      'Setting a takeoff up: create_scope, update_scope, duplicate_scope, ' +
      'archive_scope, set_page_scale, begin_scale_region, set_region_scale, ' +
      'cancel_scale_region, delete_scale_region. Freezing an answer: ' +
      'commit_scope. Everything goes through ' +
      'the same handlers a click uses, so writes land on the undo stack with an ' +
      'origin of `agent` and are broadcast to other windows — a takeoff change ' +
      'is never invisible to the person who owns it. THE EXCEPTIONS, by name: ' +
      'commit_scope is a RECORD rather than an edit and is superseded rather ' +
      'than undone; set_page_scale, begin_scale_region/set_region_scale and ' +
      'delete_scale_region are project setup that the undo stack has never ' +
      'covered, for the buttons either — so a scale written over a range ' +
      'CANNOT be taken back, and overwriting one nobody asked you to change ' +
      'silently re-measures every markup on those sheets. Read the existing ' +
      'scale first.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'set_tool', 'set_active_scope', 'go_to_page', 'set_layout_preview',
            'open_panel', 'get_scale_presets', 'get_bom', 'export',
            'create_markup', 'delete_markup', 'set_calibration', 'reassign_markup',
            'set_scope_direction',
            'create_scope', 'update_scope', 'duplicate_scope', 'archive_scope',
            'set_page_scale',
            'begin_scale_region', 'set_region_scale', 'cancel_scale_region',
            'delete_scale_region',
            'commit_scope',
          ],
        },
        tool: { type: 'string', description: 'For set_tool.' },
        scopeId: {
          type: 'string',
          description:
            'For set_active_scope, create_markup, reassign_markup, ' +
            'set_scope_direction, update_scope, duplicate_scope, archive_scope ' +
            'and commit_scope. Defaults to the active scope where one makes sense.',
        },
        page: { type: 'integer', description: 'For go_to_page. ZERO-based.' },
        on: { type: 'boolean', description: 'For set_layout_preview.' },
        panel: {
          type: 'string',
          enum: ['bom', 'browser', 'scope', 'settings', 'none'],
          description:
            'For open_panel. The panels exclude each other, so this closes ' +
            'whichever was open; `none` closes them all. It does NOT dismiss a ' +
            'calibration form — that holds a measurement and has its own Cancel.',
        },
        what: {
          type: 'string',
          description: 'For export: tsv, report, marked-pdf, csv, estimate-tsv or pdf. See redbeam_export.',
        },
        estimateId: {
          type: 'string',
          description: 'For export csv, estimate-tsv and pdf: which round. Defaults to the open one.',
        },
        label: {
          type: 'string',
          description:
            'For create_scope and update_scope, the name on the shelf — must be ' +
            'unique, because two scopes with one label are indistinguishable ' +
            'everywhere it matters and rescoping into the wrong one is silent. ' +
            'For set_region_scale, what the region IS ("Detail 3 / head").',
        },
        scopeType: {
          type: 'string',
          enum: ['area', 'linear', 'count'],
          description:
            'For create_scope and update_scope. A scope counts only the markup ' +
            'kind it is typed for, so changing it on a scope that already has ' +
            'takeoff does not convert that takeoff — it stops it reaching any ' +
            'quantity.',
        },
        color: { type: 'string', description: 'For create_scope and update_scope. CSS hex.' },
        specifications: {
          type: 'object',
          description:
            'For create_scope and update_scope: the product spec. On update it ' +
            'is MERGED, never replaced — this same object also carries the ' +
            'pattern directions the direction tool writes, and replacing it ' +
            'would silently re-orient every piece count on the scope. Set a key ' +
            'to null to remove it.',
        },
        archived: {
          type: 'boolean',
          description:
            'For archive_scope; default true. Archiving hides a scope, it does ' +
            'not destroy it — its markups stay and un-archiving restores the ' +
            'quantities exactly.',
        },
        presetId: {
          type: 'string',
          description:
            'For set_page_scale and set_region_scale: a named title-block scale, ' +
            'e.g. `arch-1-8`. Call get_scale_presets — the ids are not guessable ' +
            'and a stated scale needs no measuring, so this covers a whole ' +
            'sheet series where the reference-line tool covers one page.',
        },
        feetPerPoint: {
          type: 'number',
          description:
            'For set_page_scale and set_region_scale, instead of presetId: drawing ' +
            'feet per PDF point. Prefer presetId when the title block states a ' +
            'scale, so the stored source records that it was stated, not measured.',
        },
        pages: {
          type: 'array',
          description:
            'For set_page_scale: explicit ZERO-based page numbers in the OPEN ' +
            'document. Defaults to the open sheet. Written in ONE transaction: ' +
            'half a range carrying a new scale and half the old one is a set ' +
            'where some sheets measure and some do not, with nothing saying which.',
        },
        fromPage: {
          type: 'integer',
          description: 'For set_page_scale: start of an inclusive ZERO-based range.',
        },
        toPage: {
          type: 'integer',
          description: 'For set_page_scale: end of an inclusive ZERO-based range.',
        },
        rect: {
          type: 'object',
          description:
            'For begin_scale_region: {x0,y0,x1,y1} in NORMALIZED [0,1] page ' +
            'coordinates, y DOWN from the top, NOT PDF points. A region carries ' +
            'its own scale for the details sheet where four details sit at four ' +
            'scales. Drawing it is only half the gesture — it governs nothing ' +
            'until set_region_scale answers the picker it opens.',
        },
        kind: {
          type: 'string',
          description: 'For create_markup: area, cutout, polyline, count or shape.',
        },
        rings: {
          type: 'array',
          description:
            'For create_markup: [[{x,y}, …]] in NORMALIZED [0,1] page coordinates, ' +
            'NOT PDF points. Page points are rejected rather than placed off the sheet.',
        },
        id: {
          type: 'string',
          description:
            'For delete_markup, reassign_markup and delete_scale_region. Region ' +
            'ids are reported as `scaleRegions` by redbeam_get_ui_state and ' +
            'nowhere else.',
        },
        value: { type: 'string', description: 'For set_calibration, e.g. "10" or "7 1/2".' },
        unit: { type: 'string', description: 'For set_calibration: in, ft, mm, cm, m.' },
        lengthPdfPoints: {
          type: 'number',
          description: 'For set_calibration: measured length of the reference, in PDF points.',
        },
        x1: { type: 'number', description: 'For set_scope_direction. Normalized [0,1].' },
        y1: { type: 'number', description: 'For set_scope_direction. Normalized [0,1].' },
        x2: { type: 'number', description: 'For set_scope_direction. Normalized [0,1].' },
        y2: { type: 'number', description: 'For set_scope_direction. Normalized [0,1].' },
      },
      required: ['action'],
    },
  },
]

/** MCP tool name -> bridge method. */
const METHOD_OF = {
  redbeam_get_state: 'get_state',
  redbeam_project_summary: 'project_summary',
  redbeam_open_project: 'open_project',
  redbeam_list_documents: 'list_documents',
  redbeam_list_pages: 'list_pages',
  redbeam_list_scopes: 'list_scopes',
  redbeam_list_markups: 'list_markups',
  redbeam_get_calibration: 'get_calibration',
  redbeam_execute_query: 'execute_query',
  redbeam_get_ui_state: 'get_ui_state',
  redbeam_screenshot: 'screenshot',
  redbeam_invoke_ui_action: 'invoke_ui_action',
  redbeam_get_bom: 'invoke_ui_action',
  redbeam_export: 'invoke_ui_action',
}

/**
 * Tools that are one ui-action under a name that says what it is FOR.
 *
 * Reading and producing the deliverable are not "driving the app", and burying
 * them in an action enum is how they stay unfound: the export button went
 * unverified from an agent's seat for exactly as long as the only way to reach
 * it was to already know it was in there.
 *
 * The actions stay in the enum as well, so the omnibus tool remains the one
 * canonical list of what the app can be asked to do — and so the coverage
 * guard has one list to compare against the app.
 */
const ACTION_OF = {
  redbeam_get_bom: 'get_bom',
  redbeam_export: 'export',
}

async function callTool(name, args = {}) {
  const method = METHOD_OF[name]
  if (!method) throw new Error(`Unknown REDBEAM tool: ${name}`)
  const bound = ACTION_OF[name] ? { ...args, action: ACTION_OF[name] } : args
  const result = await bridgeCall(method, bound)

  // A screenshot is returned as an image block, not as a data URL in text: a
  // 2 MB base64 string pasted into a transcript is unreadable and expensive.
  if (name === 'redbeam_screenshot' && typeof result?.dataUrl === 'string') {
    const comma = result.dataUrl.indexOf(',')
    return {
      content: [{ type: 'image', data: result.dataUrl.slice(comma + 1), mimeType: 'image/png' }],
    }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result && typeof result === 'object' ? result : { value: result },
  }
}

// -------------------------------------------------------------- rpc plumbing --

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const sendError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handleRequest(req) {
  const { id, method, params } = req
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      })
      return
    }
    if (method === 'notifications/initialized') return
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } })
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments ?? {})
      return send({ jsonrpc: '2.0', id, result })
    }
    sendError(id, -32601, `Method not found: ${method}`)
  } catch (e) {
    // Reported as a tool result rather than an RPC error: the call reached the
    // server fine, and an agent should see WHY the app refused rather than a
    // protocol-level failure it cannot act on.
    if (method === 'tools/call') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true },
      })
    }
    sendError(id, -32603, e.message)
  }
}

function startServer() {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl < 0) break
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        void handleRequest(JSON.parse(line))
      } catch (e) {
        sendError(null, -32700, `Parse error: ${e.message}`)
      }
    }
  })
  process.stderr.write(`REDBEAM MCP server ready. Discovery: ${DISCOVERY_FILE}\n`)
}

export { bridgeCall, callTool, tools, METHOD_OF, ACTION_OF, startServer }

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) startServer()
