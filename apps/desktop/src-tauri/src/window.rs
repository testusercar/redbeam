//! Additional-window creation.
//!
//! REDBEAM is a multi-window app: a project window per open project, plus an
//! optional "context" window that rides alongside one. Every window loads the
//! same frontend bundle and works out what it is from the query string, so
//! there is exactly one entry point to build and ship.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Describes a window that was opened (or focused, if it already existed).
#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenedWindow {
    pub label: String,
    pub url: String,
    /// False when an existing window with the same label was focused instead.
    pub created: bool,
}

/// Percent-encode a value for use inside a query string.
///
/// Written out rather than pulled in as a dependency: the alphabet is tiny and
/// this keeps the crate's dependency list to Tauri plus serde.
fn encode_query_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// Tauri only accepts `[a-zA-Z0-9-/:_]` in window labels, so anything else in a
/// caller-supplied label becomes `_`.
fn sanitize_label(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '/' | ':' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "window".to_string()
    } else {
        cleaned
    }
}

fn app_url(project_id: &str, role: &str) -> String {
    format!(
        "index.html?projectId={}&role={}",
        encode_query_value(project_id),
        encode_query_value(role)
    )
}

/// Build a window, or focus the one that already owns this label.
///
/// Must not be called from the main thread — on Windows the builder blocks
/// waiting on the event loop it would be sitting on. The commands below are
/// `async`, which is what keeps this off the main thread.
fn open_or_focus(
    app: &AppHandle,
    label: &str,
    url: &str,
    title: &str,
) -> Result<OpenedWindow, tauri::Error> {
    if let Some(existing) = app.get_webview_window(label) {
        // Re-point it. A context window is a VIEW, and popping out a second tab
        // asks for that view to show the second document — focusing a window
        // still displaying the first one looks like the command did nothing.
        // Resolved against the window's CURRENT url so this stays correct under
        // both `tauri dev` (an http origin) and a bundled build (a custom
        // scheme). If either step fails we simply focus what is there — better
        // than failing the command outright.
        if let Ok(target) = existing.url().ok().ok_or(()).and_then(|b| b.join(url).map_err(|_| ())) {
            let _ = existing.navigate(target);
        }
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(OpenedWindow {
            label: label.to_string(),
            url: url.to_string(),
            created: false,
        });
    }

    let window: WebviewWindow =
        WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(1280.0, 820.0)
            // The same floor tauri.conf.json gives the first window, and for
            // the same reason: the shell's grid is 44 + 232 + 360 + 320 = 956
            // of irreducible columns, so a window narrower than that pushes
            // the workspace pane off its own right edge. A second project
            // window used to be built at 800 and did exactly that.
            .min_inner_size(960.0, 640.0)
            .resizable(true)
            // The app draws its own title bar; `shadow` is what keeps the
            // resize border and Windows snap on an undecorated window.
            .decorations(false)
            .shadow(true)
            // Tauri's own default arguments, restated because setting this
            // replaces them rather than adding to them. Deliberately NOT
            // `--disable-pinch`: suppressing the gesture upstream can only take
            // it away from the page that wants to handle it.
            .additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
            )
            /*
             * THIS IS WHAT MAKES A TRACKPAD PINCH REACH THE PAGE.
             *
             * The name says hotkeys. On Windows, wry passes this straight to
             * `ICoreWebView2Settings5::SetIsPinchZoomEnabled` — and its default
             * is FALSE, so a Tauri window that says nothing about zoom is a
             * window where WebView2 does not recognise the pinch gesture at
             * all. Not "recognises it and scales the page": does not generate
             * it. The ctrl+wheel that Chromium synthesizes for a precision
             * touchpad pinch is never produced, and the page receives plain
             * scroll wheels indistinguishable from a two-finger swipe.
             *
             * Measured, rather than reasoned: the same page in a browser tab on
             * the same machine and trackpad produced 633 wheel events with
             * ctrl=1; in this webview, 146 events and not one of them.
             *
             * Turning it on does NOT hand zoom to the webview. The page claims
             * every ctrl+wheel in the document and every zoom key, so WebView2
             * generates the gesture and we are the ones who act on it. See the
             * zoom-hotkey effect in Workspace.tsx.
             */
            .zoom_hotkeys_enabled(true)
            .center()
            .build()?;

    // Focus is the whole point of opening a window — except under the
    // minimized switch, where taking focus is exactly what we are avoiding.
    if minimize_if_requested(&window) {
        // minimized instead
    } else {
        let _ = window.set_focus();
    }

    Ok(OpenedWindow {
        label: label.to_string(),
        url: url.to_string(),
        created: true,
    })
}

/// Open (or focus) a window showing a project.
/// Honour REDBEAM_START_MINIMIZED for windows created after startup too.
///
/// The setup hook only sees windows that exist when the app boots; a context
/// window opened later would still raise itself over whatever the user is
/// doing, which is exactly what the switch exists to prevent.
fn minimize_if_requested(window: &tauri::WebviewWindow) -> bool {
    let on = std::env::var("REDBEAM_START_MINIMIZED")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            !(v.is_empty() || v == "0" || v == "false" || v == "no")
        })
        .unwrap_or(false);
    if on {
        let _ = window.minimize();
    }
    on
}

#[tauri::command]
pub async fn open_project_window(
    app: AppHandle,
    project_id: String,
    label: String,
) -> Result<OpenedWindow, String> {
    let label = sanitize_label(&label);
    let url = app_url(&project_id, "main");
    let title = format!("REDBEAM — {}", project_id);
    open_or_focus(&app, &label, &url, &title).map_err(|e| e.to_string())
}

/// Open (or focus) the context window for a project.
///
/// `document` is the drawing to show, carried on the URL. Popping a tab out and
/// landing on a different sheet than the one you popped is worse than not
/// having the feature, so the target travels with the request rather than the
/// new window guessing.
///
/// One context window per project, by label — a second pop-out re-points the
/// existing one instead of stacking windows.
#[tauri::command]
pub async fn open_context_window(
    app: AppHandle,
    project_id: String,
    document: Option<String>,
) -> Result<OpenedWindow, String> {
    let label = sanitize_label(&format!("context-{}", project_id));
    let mut url = app_url(&project_id, "context");
    if let Some(doc) = document.as_deref().filter(|d| !d.is_empty()) {
        url.push_str(&format!("&document={}", encode_query_value(doc)));
    }
    let title = format!("REDBEAM Context — {}", project_id);
    open_or_focus(&app, &label, &url, &title).map_err(|e| e.to_string())
}

/// Close a window by label. Returns false if there was nothing to close.
#[tauri::command]
pub async fn close_window(app: AppHandle, label: String) -> Result<bool, String> {
    match app.get_webview_window(&sanitize_label(&label)) {
        Some(window) => {
            window.close().map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query_values() {
        assert_eq!(encode_query_value("abc-123_x.y~z"), "abc-123_x.y~z");
        assert_eq!(encode_query_value("a b&c=d"), "a%20b%26c%3Dd");
    }

    #[test]
    fn sanitizes_labels() {
        assert_eq!(sanitize_label("project-42"), "project-42");
        assert_eq!(sanitize_label("bad label!"), "bad_label_");
        assert_eq!(sanitize_label(""), "window");
    }

    #[test]
    fn builds_app_urls() {
        assert_eq!(
            app_url("p 1", "context"),
            "index.html?projectId=p%201&role=context"
        );
    }
}
