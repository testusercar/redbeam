/**
 * The frontend half of the automation bridge (plan 11.3 / 11.5).
 *
 * Rust emits `redbeam://bridge/request`; this answers through the
 * `bridge_reply` command. Actions run through the SAME handlers a click uses,
 * so a bridge-driven action cannot drift from what a person would get — which
 * is the whole reason the bridge does not write UI state from Rust directly.
 *
 * Failures are reported IN BAND, as `{error}`, rather than thrown. A throw
 * here would leave the Rust waiter to time out after twenty seconds with a
 * message about a wedged window, which is a much worse description of "you
 * asked for a screenshot and no canvas is mounted".
 */
import { useEffect, useRef } from 'react'
import { isTauri } from '../tauri/window.js'

export interface BridgeActions {
  /** Whatever the driving agent should be able to see about this window. */
  uiState: () => Record<string, unknown>
  /** PNG data URL of the current canvas, or null when nothing is mounted. */
  screenshot: (params: Record<string, unknown>) => string | null
  /** Named UI action, e.g. selecting a tool or a scope. */
  /**
   * May be async. A write that reports before it has landed turns a failure
   * into a recorded success — committing five scopes in succession lost one
   * that way, silently, with the caller told it had worked.
   */
  invoke: (
    action: string,
    params: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>
}

interface RequestPayload {
  id: number
  action: string
  params?: Record<string, unknown>
}

export function useBridgeRequests(actions: BridgeActions): void {
  // Held in a ref so the listener is registered ONCE. Re-registering on every
  // render would drop in-flight requests and leak listeners.
  const ref = useRef(actions)
  useEffect(() => { ref.current = actions }, [actions])

  useEffect(() => {
    if (!isTauri()) return
    let stop: (() => void) | undefined
    let cancelled = false

    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ])

      const un = await listen<RequestPayload>('redbeam://bridge/request', (event) => { void (async () => {
        const { id, action, params = {} } = event.payload
        let result: Record<string, unknown>
        try {
          switch (action) {
            case 'get_ui_state':
              result = ref.current.uiState()
              break
            case 'screenshot': {
              const dataUrl = ref.current.screenshot(params)
              result = dataUrl === null
                ? { error: 'no canvas is mounted — is a project open?' }
                : { dataUrl, bytes: dataUrl.length }
              break
            }
            case 'invoke_ui_action': {
              const name = typeof params['action'] === 'string' ? params['action'] : ''
              if (name === '') { result = { error: 'invoke_ui_action needs `action`' }; break }
              result = await ref.current.invoke(name, params)
              break
            }
            default:
              result = { error: `unknown ui action: ${action}` }
          }
        } catch (e) {
          // In band, so the caller learns what actually went wrong instead of
          // waiting out the Rust timeout.
          result = { error: e instanceof Error ? e.message : String(e) }
        }
        void invoke('bridge_reply', { id, result })
      })() })

      if (cancelled) un()
      else stop = un
    })()

    return () => { cancelled = true; stop?.() }
  }, [])
}
