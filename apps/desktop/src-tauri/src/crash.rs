//! Crash reports (plan TH.8).
//!
//! # Why this is files on disk and not telemetry
//!
//! REDBEAM has two users. What is needed is not an aggregation service and a
//! dashboard nobody opens: it is that when the app dies on an estimator's
//! machine, something remains that they can send and that says what happened.
//! A report is written locally and goes nowhere unless a person chooses to
//! send it — which also means no consent question, no network at a moment the
//! app is already failing, and nothing to explain to a client about where
//! their drawing set's name ended up.
//!
//! # The three deaths, and why the frontend cannot catch them all
//!
//! 1. A Rust **panic** kills the process. The React error boundary never runs,
//!    the window vanishes, and without the hook installed here there is no
//!    trace at all beyond an exit code nobody saw.
//! 2. A **render error** is caught by the boundary, which shows the stack and
//!    offers to copy it. That is enough only while the window is still open —
//!    reload or close it and the evidence is gone. So it is written too.
//! 3. An **unhandled promise rejection** reaches neither. This app writes to
//!    SQLite, ingests folders and builds PDFs asynchronously; a rejected
//!    promise in any of those is invisible to `componentDidCatch` and produces
//!    a UI that has quietly stopped working rather than one that has crashed.
//!
//! # What a report contains, and why it says so
//!
//! Version, time, kind, message, and a backtrace — plus the open project's
//! PATH, because "which project was open" is the first question and a report
//! that cannot answer it usually cannot be acted on. That path names a client
//! folder, so every file states its own contents in a header: somebody about
//! to email one is entitled to know what they are sending without reading a
//! stack trace to find out.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Where reports are written. Resolved once at startup because the panic hook
/// has no `AppHandle` — it runs on whatever thread died.
static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The open project, for the "which project was open" line. A `Mutex` rather
/// than a channel: it is read only when something has already gone wrong.
static OPEN_PROJECT: Mutex<Option<String>> = Mutex::new(None);

/// Keep this many reports. A crash loop must not fill an estimator's disk, and
/// the twentieth copy of one stack teaches nothing the first did not.
const KEEP: usize = 20;

#[derive(Debug, Serialize)]
pub struct CrashReport {
    pub file: String,
    pub written_at: String,
    pub kind: String,
    pub message: String,
}

/// Resolve the directory and install the panic hook.
pub fn init(app: &AppHandle) {
    let dir = match app.path().app_log_dir() {
        Ok(d) => d,
        // No log directory means no reports. That is worth nothing but it is
        // not worth refusing to start over.
        Err(_) => return,
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = CRASH_DIR.set(dir);

    // Chained, not replaced: the default hook is what prints a panic to stderr,
    // which is the only thing a `tauri dev` terminal shows.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic with a non-string payload".to_string());
        let where_ = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        write_report(
            "rust-panic",
            &payload,
            &format!("at {where_}\n\n{}", std::backtrace::Backtrace::force_capture()),
        );
        previous(info);
    }));
}

/// Remember which project is open, so a report can name it.
pub fn set_open_project(path: Option<String>) {
    if let Ok(mut guard) = OPEN_PROJECT.lock() {
        *guard = path;
    }
}

/// Write one report. Never panics — a panicking panic hook aborts the process
/// and loses the very thing it was called to record.
pub fn write_report(kind: &str, message: &str, detail: &str) -> Option<PathBuf> {
    let dir = CRASH_DIR.get()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let path = dir.join(format!("crash-{now}-{kind}.txt"));

    let project = OPEN_PROJECT
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| "none".to_string());

    let body = format!(
        "REDBEAM crash report\n\
         \n\
         This file contains: the app version, the time, what failed, a stack\n\
         trace, and the PATH of the project that was open. That path names a\n\
         client folder. Nothing else about the project — no drawings, no\n\
         markups, no quantities — is included, and this file is sent nowhere\n\
         unless you send it.\n\
         \n\
         version:  {}\n\
         when:     {} (unix seconds)\n\
         kind:     {kind}\n\
         project:  {project}\n\
         message:  {message}\n\
         \n\
         {detail}\n",
        env!("CARGO_PKG_VERSION"),
        now,
    );

    let written = fs::File::create(&path)
        .and_then(|mut f| f.write_all(body.as_bytes()))
        .is_ok();
    prune(dir);
    written.then_some(path)
}

/// Drop the oldest reports past [`KEEP`].
fn prune(dir: &PathBuf) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("crash-"))
        })
        .collect();
    if files.len() <= KEEP {
        return;
    }
    files.sort();
    for old in &files[..files.len() - KEEP] {
        let _ = fs::remove_file(old);
    }
}

// ------------------------------------------------------------- commands ----

/// Record a failure the frontend caught: a render error or a rejected promise.
#[tauri::command]
pub fn crash_report(kind: String, message: String, detail: String) -> Option<String> {
    // The frontend chooses the kind, so it is constrained here rather than
    // trusted into a filename.
    let kind = match kind.as_str() {
        "render" => "render",
        "rejection" => "rejection",
        _ => "frontend",
    };
    write_report(kind, &message, &detail).map(|p| p.display().to_string())
}

/// Reports on disk, newest first, for the diagnostics view.
#[tauri::command]
pub fn crash_reports() -> Vec<CrashReport> {
    let Some(dir) = CRASH_DIR.get() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<CrashReport> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("crash-"))
        })
        .filter_map(|p| {
            let text = fs::read_to_string(&p).ok()?;
            Some(CrashReport {
                file: p.display().to_string(),
                written_at: field(&text, "when:"),
                kind: field(&text, "kind:"),
                message: field(&text, "message:"),
            })
        })
        .collect();
    out.sort_by(|a, b| b.file.cmp(&a.file));
    out
}

fn field(text: &str, key: &str) -> String {
    text.lines()
        .find_map(|l| l.trim().strip_prefix(key))
        .unwrap_or("")
        .trim()
        .to_string()
}

/// The folder itself, so somebody can be told where to look.
#[tauri::command]
pub fn crash_dir() -> Option<String> {
    CRASH_DIR.get().map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of fake reports, newest last by name.
    fn seed(dir: &PathBuf, count: usize) {
        fs::create_dir_all(dir).unwrap();
        for i in 0..count {
            // Zero-padded so lexical order matches chronological order, which
            // is what `prune` sorts on.
            fs::write(dir.join(format!("crash-{i:04}-render.txt")), "x").unwrap();
        }
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("redbeam-crash-test-{name}"));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn keeps_everything_below_the_cap() {
        let dir = temp("under");
        seed(&dir, KEEP);
        prune(&dir);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), KEEP);
    }

    #[test]
    fn drops_the_oldest_past_the_cap() {
        // A crash loop must not fill an estimator's disk.
        let dir = temp("over");
        seed(&dir, KEEP + 5);
        prune(&dir);
        let mut left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left.len(), KEEP);
        // The five oldest went, not five arbitrary ones.
        assert_eq!(left[0], "crash-0005-render.txt");
    }

    #[test]
    fn leaves_files_that_are_not_reports_alone() {
        // The log directory is not ours alone, and a prune that swept it would
        // delete somebody else's diagnostics.
        let dir = temp("mixed");
        seed(&dir, KEEP + 3);
        fs::write(dir.join("redbeam.log"), "keep me").unwrap();
        prune(&dir);
        assert!(dir.join("redbeam.log").exists());
    }

    #[test]
    fn reads_a_field_back_out_of_a_report() {
        // What `crash_reports` shows in the list comes from re-parsing the file
        // it just wrote, so the two have to agree.
        let text = "version:  0.1.0\nkind:     render\nmessage:  boom happened\n";
        assert_eq!(field(text, "kind:"), "render");
        assert_eq!(field(text, "message:"), "boom happened");
    }

    #[test]
    fn reports_a_missing_field_as_empty_rather_than_guessing() {
        assert_eq!(field("version: 0.1.0\n", "kind:"), "");
    }
}
