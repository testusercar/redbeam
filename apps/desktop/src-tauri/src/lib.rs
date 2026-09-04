mod accent;
mod backdrop;
mod bridge;
mod crash;
mod project;
mod store;
mod undo;
mod window;

pub use store::StoreState;
pub use undo::UndoState;
pub use window::{close_window, open_context_window, open_project_window};

/// Start every window minimized.
///
/// Set `REDBEAM_START_MINIMIZED=1` for automated runs. An agent driving the app
/// for verification should not steal focus or cover what someone is working on,
/// and a window that keeps raising itself makes the machine unusable while a
/// long test runs. Off by default, so a real launch behaves normally.
fn start_minimized() -> bool {
    std::env::var("REDBEAM_START_MINIMIZED")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            !(v.is_empty() || v == "0" || v == "false" || v == "no")
        })
        .unwrap_or(false)
}

/// Is the automation bridge switched on?
///
/// Off by default. The bridge exposes the open project over a local socket, so
/// it is something you turn on to drive the app, not something every launch
/// carries.
fn bridge_enabled() -> bool {
    std::env::var("REDBEAM_BRIDGE")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            !(v.is_empty() || v == "0" || v == "false" || v == "no")
        })
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // One SQLite connection for the whole process. Windows are views over
        // it — a per-window connection would reintroduce exactly the divergence
        // this design exists to prevent.
        .plugin(tauri_plugin_dialog::init())
        // Updates (plan TH.7). An installed copy has no other way to change:
        // the alternative is emailing a 95MB installer and asking an estimator
        // to run it, which is a thing that happens once and then stops
        // happening while the fixes pile up.
        //
        // `process` is here because it is what an update is FOR — the updater
        // stages the new binary and the app has to restart into it. Without a
        // relaunch the user is told an update installed and keeps running the
        // old one until they notice.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(store::StoreState::new())
        // The undo stack belongs to the project, not to a window (D1). It lives
        // here for the same reason the connection does: several windows share it.
        .manage(undo::UndoState::new())
        .invoke_handler(tauri::generate_handler![
            // `#[tauri::command]` emits a helper macro beside each function, so
            // these must be pathed to the defining module, not a re-export.
            store::commands::db_open,
            store::commands::db_exec,
            store::commands::db_all,
            store::commands::db_run,
            undo::commands::undo_record,
            undo::commands::undo_apply,
            undo::commands::undo_redo,
            undo::commands::undo_state,
            undo::commands::undo_clear,
            project::project_pick_folder,
            project::project_pick_drawing,
            project::project_open,
            project::project_recents,
            project::project_forget_recent,
            project::project_clear_recents,
            project::project_scan,
            project::project_read_document,
            project::project_save_file,
            window::open_project_window,
            window::open_context_window,
            window::close_window,
            bridge::ui::bridge_reply,
            crash::crash_report,
            crash::crash_reports,
            crash::crash_dir,
            backdrop::backdrop_active,
            accent::system_accent,
        ])
        .setup(|app| {
            /*
             * FIRST, before anything else here can fail.
             *
             * There is exactly one `setup` on this builder on purpose: Tauri
             * keeps the last closure passed and silently discards any earlier
             * one, so a second `.setup(...)` added for a new concern would
             * disable this one without a compile error.
             */
            crash::init(&app.handle().clone());

            // Before the window is shown, so it never paints once opaque
            // and then again with the backdrop behind it.
            backdrop::apply(&app.handle().clone());

            if start_minimized() {
                use tauri::Manager;
                for (_, window) in app.webview_windows() {
                    // Minimize rather than hide: a hidden window is invisible in
                    // the taskbar too, which makes an automated run look like a
                    // crashed one.
                    let _ = window.minimize();
                }
            }
            // The automation bridge is opt-in. It is a local socket that can
            // read the open project, so it should exist when an agent is
            // driving the app and not otherwise. REDBEAM_BRIDGE=1 turns it on;
            // a driven run sets it alongside REDBEAM_START_MINIMIZED.
            if bridge_enabled() {
                match bridge::start(app.handle().clone()) {
                    Ok(info) => eprintln!(
                        "redbeam bridge on 127.0.0.1:{} (discovery: {})",
                        info.port,
                        bridge::discovery_path().display()
                    ),
                    // Never fatal: an estimator with a takeoff open does not
                    // care that a debug socket could not bind.
                    Err(e) => eprintln!("redbeam bridge did not start: {e}"),
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running REDBEAM");
}
