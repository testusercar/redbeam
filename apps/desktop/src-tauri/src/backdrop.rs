//! The Windows 11 system backdrop, and whether this machine can actually draw one.
//!
//! Mica is a property of the WINDOW, not of a surface: DWM samples the desktop
//! wallpaper, blurs and tints it, and paints it behind the window. It shows
//! only where the app's own content is transparent, which is why the window is
//! created with `"transparent": true` and the chrome opts into translucency in
//! CSS.
//!
//! ## Why this is applied here rather than declared in tauri.conf.json
//!
//! The config's `windowEffects` applies the effect and says nothing about
//! whether it took. On Windows 10 there is no Mica: the effect is a no-op and
//! the window stays TRANSPARENT — so an app whose chrome is translucent would
//! render as a hole onto the desktop. The failure mode has to be "no backdrop",
//! never "see-through app".
//!
//! Applying it from Rust gives a `Result`, which is the honest signal:
//! `window-vibrancy` returns `UnsupportedPlatformVersion` when the build is too
//! old. `backdrop_active` reports that to the UI, and the stylesheet keeps
//! every surface opaque unless it says yes. That is a real check on the machine
//! the app is running on, not a guess from a version string.
//!
//! `Tabbed` rather than `Mica`: Mica Alt is the material Windows itself uses
//! for apps whose title bar carries a tab strip, which is what REDBEAM's does.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Manager, Runtime};

/// Whether the backdrop applied to at least one window this run.
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Ask for the backdrop on every open window, and record whether it took.
pub fn apply<R: Runtime>(app: &AppHandle<R>) {
    let effects = EffectsBuilder::new().effect(Effect::Tabbed).build();
    for (label, window) in app.webview_windows() {
        match window.set_effects(effects.clone()) {
            Ok(()) => ACTIVE.store(true, Ordering::Relaxed),
            // Not fatal, and not even unusual: anything before Windows 11
            // lands here. The UI stays opaque and nothing else changes.
            Err(e) => eprintln!("redbeam: no system backdrop on {label}: {e}"),
        }
    }
}

/// Whether the chrome may be translucent. Read once by the UI at startup.
#[tauri::command]
pub fn backdrop_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}
