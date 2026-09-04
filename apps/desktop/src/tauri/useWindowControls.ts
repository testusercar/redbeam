/**
 * State for the app-drawn window controls.
 *
 * Only the maximized flag needs tracking, and only because the middle button
 * has to say whether it will maximize or restore. It is read once on mount and
 * then on every resize — resize is the only event that can change it, including
 * the ones the app did not initiate (a snap gesture, a double-click on the
 * drag region, the OS restoring a window on unminimize).
 */
import { useEffect, useState } from 'react'
import {
  closeThisWindow, isTauri, isWindowMaximized, minimizeWindow, onWindowResize,
  toggleMaximizeWindow,
} from './window.js'

export interface WindowControlState {
  /** True when this window draws its own frame — i.e. running under Tauri. */
  frameless: boolean
  maximized: boolean
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
}

export function useWindowControls(): WindowControlState {
  const frameless = isTauri()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!frameless) return
    let stop: (() => void) | undefined
    let cancelled = false
    void (async () => {
      setMaximized(await isWindowMaximized())
      const un = await onWindowResize(() => {
        void isWindowMaximized().then((m) => { if (!cancelled) setMaximized(m) })
      })
      if (cancelled) un()
      else stop = un
    })()
    return () => { cancelled = true; stop?.() }
  }, [frameless])

  return {
    frameless,
    maximized,
    minimize: () => void minimizeWindow(),
    toggleMaximize: () => void toggleMaximizeWindow().then(setMaximized),
    close: () => void closeThisWindow(),
  }
}
