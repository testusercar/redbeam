//! Project lifecycle — pick a folder, open it, remember where you have been,
//! and catalog what is inside.
//!
//! # A project is a folder
//!
//! REDBEAM has no "new project" wizard and no project file format. A project is
//! a directory the estimator already has — the bid package as it arrived — plus
//! one `redbeam.db` written next to it. That is the whole model, and it is why
//! opening a project is just picking a folder.
//!
//! This fixes a real wart: `openDatabase()` defaulted `projectPath` to `'.'`,
//! so the database landed at `src-tauri/redbeam.db` — the dev binary's working
//! directory. Every window shared one nameless database that belonged to
//! whatever directory the binary happened to be launched from. Here the folder
//! is chosen explicitly and [`ProjectInfo::db_path`] is handed to `db_open`.
//!
//! # Permissions — what this module actually needs
//!
//! Nothing, as written. That deserves saying plainly because it is easy to
//! assume otherwise:
//!
//! * **Tauri v2's ACL gates the webview→command hop for *plugin* commands**
//!   (`core:*` and `plugin:*`). Commands defined in this crate and listed in
//!   `generate_handler!` are application commands and are not permission-gated.
//! * **`std::fs` from Rust is not gated either.** The `fs` permission set
//!   scopes `@tauri-apps/plugin-fs`'s JavaScript API. Reading a directory here
//!   goes nowhere near it, so the folder scan needs no `fs:` grant and no
//!   scope entry. This is deliberate: granting `fs:allow-read-dir` would open
//!   the frontend's own filesystem surface, which is a much bigger blast
//!   radius than "the Rust side can list a folder the user just picked".
//! * **`core:path:default` is already granted** and is what [`recents_path`]
//!   leans on — though again, the `AppHandle::path()` call is Rust-side and
//!   ungated; the grant matters only if the frontend calls `path` itself.
//!
//! The one thing that is *not* free is the native folder dialog. See
//! [`project_pick_folder`].
//!
//! # Ported behaviour
//!
//! [`classify_kind`], [`classify_status`], [`extract_file_date_hint`] and
//! [`availability_for_path`] are ported from the Qt build's
//! `shell/redbeamproject.cpp` (`classifyKind`, `classifyStatus`,
//! `extractFileDateHint`, `availabilityForPath`). The `availability` vocabulary
//! is `local` / `online_only` / `unavailable` — **not** `available`, which is
//! what `packages/store/src/repo.ts::ensureDocumentAndPage` writes. See the
//! report accompanying this change.
//!
//! The content fingerprint is SHA-256 of the file, matching
//! `sha256ForFile`, and is skipped for files over
//! [`MAX_FINGERPRINT_BYTES`] or for anything not `local` — a cloud
//! placeholder would be hydrated from the network just to hash it.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::store::db::resolve_db_path;

/// Where the recent-projects list is written, inside the app config directory.
pub const RECENTS_FILE: &str = "recent-projects.json";

/// How many recent projects are kept. The UI is expected to render every one of
/// them, so this is also the size the list component must stay usable at.
pub const MAX_RECENTS: usize = 200;

/// Project-internal directory, never cataloged. Matches the Qt build.
pub const INTERNAL_DIR: &str = ".redbeam";

/// `MaximumInitialFingerprintBytes` from `shell/redbeamproject.cpp`.
pub const MAX_FINGERPRINT_BYTES: u64 = 128 * 1024 * 1024;

/// Directory recursion cap. A drawing set is a handful of levels deep; anything
/// past this is a symlink cycle or a mistake, and the scan should end rather
/// than run forever.
pub const MAX_SCAN_DEPTH: usize = 16;

/// File cap for one scan. Reported through [`ScanResult::truncated`] rather
/// than silently trimmed.
pub const MAX_SCAN_FILES: usize = 50_000;

/// Extensions cataloged when the caller does not say otherwise.
///
/// The Qt build cataloged *every* file in the tree and classified it by kind.
/// This narrows to PDFs by default because that is what the takeoff surface can
/// open today; pass `extensions` to [`project_scan`] to widen it.
pub const DEFAULT_EXTENSIONS: &[&str] = &["pdf"];

// NOTE ON THE DIALOGS BELOW.
//
// They used to sit behind a `feature = "dialog"` that nothing ever enabled —
// `tauri-plugin-dialog` is an unconditional dependency and lib.rs always
// initialises it — so the `not(feature)` stub was the ONLY arm that compiled,
// and Browse was dead in every build ever shipped. It presented as "the start
// screen only offers a path field" rather than as an error anyone could see,
// because the frontend hides its Browse button when a pick reports itself
// unsupported. `supported: false` is still a real state on a platform with no
// file dialog, so the outcome types keep the flag; nothing sets it today.

// ---------------------------------------------------------------- types ----

/// A project folder that has been resolved and is ready to open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectInfo {
    /// Canonical absolute path of the project folder.
    pub path: String,
    /// Folder name, used as the project's display name.
    pub name: String,
    /// Absolute path of the SQLite file to hand to `db_open`.
    pub db_path: String,
    /// True when this call created the folder.
    pub created: bool,
    /// True when `db_path` already existed — i.e. this is a reopen, not a
    /// first open. The UI uses it to decide whether to offer an ingest.
    pub has_database: bool,
    /// The folder that was asked for, when the project opened is one of its
    /// ancestors instead. See [`outermost_project_root`]. `None` when the
    /// folder asked for is the project.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirected_from: Option<String>,
}

/// One entry in the recent-projects list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    /// RFC 3339 UTC, when the project was last opened through this app.
    pub last_opened_at: String,
    /// Recomputed on every read: the folder is gone or is not a directory.
    /// Persisted too, so a list read while an external drive is detached still
    /// round-trips rather than losing the flag.
    #[serde(default)]
    pub missing: bool,
}

/// What [`project_pick_folder`] managed to do.
///
/// `supported == false` is a normal outcome, not an error: it means this build
/// has no native dialog and the UI should fall back to a path field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PickOutcome {
    pub supported: bool,
    /// `None` when the user cancelled, or when `supported` is false.
    pub path: Option<String>,
    /// Present only when `supported` is false, explaining why.
    pub reason: Option<String>,
}

/// One file found by [`project_scan`].
///
/// This is the raw catalog record. Turning it into `documents` / `pages` rows
/// is the TypeScript side's job (`packages/store/src/documents.ts`) — page
/// boxes come from PDFium, which lives in the frontend worker, and there is no
/// PDF parser in this crate.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScannedFile {
    /// Forward-slashed path relative to the project root. This is the
    /// `documents.relative_path` value, which is NOT NULL UNIQUE.
    pub relative_path: String,
    /// Absolute path, for opening the file.
    pub absolute_path: String,
    /// File name including extension.
    pub display_name: String,
    /// `documents.kind`
    pub kind: String,
    /// `documents.status`
    pub status: String,
    pub size_bytes: u64,
    /// RFC 3339 UTC, or `None` when the platform did not report one.
    pub modified_at: Option<String>,
    /// SHA-256 hex, or `None` when the file was too large or not local.
    pub content_fingerprint: Option<String>,
    /// `local` | `online_only` | `unavailable`
    pub availability: String,
    /// `documents.file_date_hint`, or `None` when the path carries no date.
    pub file_date_hint: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ScanResult {
    pub root: String,
    pub files: Vec<ScannedFile>,
    /// True when [`MAX_SCAN_FILES`] or [`MAX_SCAN_DEPTH`] cut the walk short.
    /// A truncated scan must NOT be used to mark documents missing.
    pub truncated: bool,
    /// Directories that could not be read (permissions, a detached drive).
    /// Same rule: their absence is not evidence a document is gone.
    pub unreadable: Vec<String>,
    pub scanned_at: String,
}

// ----------------------------------------------------------- path helpers --

/// Canonicalize, and strip Windows' `\\?\` verbatim prefix.
///
/// `fs::canonicalize` returns verbatim paths on Windows (`\\?\C:\x`). Those
/// compare unequal to anything the user typed, render badly in a recents list,
/// and are rejected by some APIs — so the prefix comes off. Falls back to the
/// input when the path does not exist yet (which is the create case).
pub fn canonical_project_root(path: &Path) -> PathBuf {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    strip_verbatim(&canonical)
}

fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Forward-slashed path of `absolute` relative to `root`.
///
/// Returns `None` when `absolute` is not inside `root` — a symlink pointing out
/// of the project must not be cataloged under a `../..` relative path, because
/// `documents.relative_path` is the project's identity for that file.
pub fn normalized_relative_path(root: &Path, absolute: &Path) -> Option<String> {
    let rest = absolute.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = Vec::new();
    for component in rest.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// Is this path inside a `.redbeam/` directory — at ANY depth?
///
/// It used to test the root only. A subfolder that had once been opened as a
/// project of its own carries its own `.redbeam/` and `redbeam.db`, and when
/// the parent folder is opened as the project those must be ignored, not
/// cataloged: the parent is the project, and the subfolder's bookkeeping is
/// stale bookkeeping about a project that no longer exists.
fn is_internal(relative_path: &str) -> bool {
    relative_path
        .split('/')
        .any(|segment| segment.eq_ignore_ascii_case(INTERNAL_DIR))
}

/// The `redbeam.db` file, and any journal SQLite keeps beside it, are the
/// project's own bookkeeping and never become documents.
fn is_project_database(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "redbeam.db" || lower.starts_with("redbeam.db-")
}

// ----------------------------------------------------- ported classifiers --

/// Ported from `classifyKind` in `shell/redbeamproject.cpp`.
///
/// Order matters and is load-bearing: a path containing "spec" is a
/// specification even when it is a PDF, so the extension test for `pdf` sits
/// *below* the keyword tests. Reordering silently reclassifies a real drawing
/// set.
pub fn classify_kind(relative_path: &str) -> &'static str {
    let lower = relative_path.to_ascii_lowercase();
    let suffix = extension_of(&lower);

    if matches!(suffix.as_str(), "dwg" | "skp" | "3dm" | "3dmbak" | "gh") {
        return "drawing";
    }
    if lower.contains("spec") {
        return "specification";
    }
    if lower.contains("meeting") || lower.contains("mtg") || lower.contains("note") {
        return "decision";
    }
    if lower.contains("warranty") || lower.contains("close-out") || lower.contains("reference") {
        return "reference";
    }
    if lower.contains("design release")
        || lower.contains("submittal")
        || lower.contains("fabrication")
        || lower.contains("install")
    {
        return "deliverable";
    }
    if suffix == "pdf"
        || lower.contains("drawing")
        || lower.contains("plan")
        || lower.contains("rcp")
    {
        return "drawing";
    }
    if matches!(suffix.as_str(), "docx" | "dotx") {
        return "document";
    }
    if matches!(suffix.as_str(), "png" | "jpg" | "jpeg") {
        return "image";
    }
    if suffix == "msg" {
        return "message";
    }
    "other"
}

/// Ported from `classifyStatus` in `shell/redbeamproject.cpp`.
pub fn classify_status(relative_path: &str) -> &'static str {
    let lower = relative_path.to_ascii_lowercase();
    if lower.contains("archive") || lower.contains("superseded") || lower.contains("obsolete") {
        return "superseded";
    }
    if lower.contains("draft") || lower.contains("prelim") {
        return "draft";
    }
    "current"
}

fn extension_of(lower_path: &str) -> String {
    Path::new(lower_path)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Ported from `extractFileDateHint`.
///
/// The Qt original used `(?<!\d)(20\d{6})(?!\d)` then `(?<!\d)(\d{6})(?!\d)`.
/// Those lookarounds mean "a run of digits exactly that long", which is what
/// the digit-run walk below implements — no regex crate needed.
///
/// **Two-digit years resolve to 2000+yy.** Qt's own answer here is not stable
/// (`QDate::fromString` with `yy` changed its default century base between Qt
/// releases), so it is pinned rather than inherited: every drawing set this
/// tool will ever see is 21st century, and the project folders are literally
/// named `260415 - REDBEAM`.
pub fn extract_file_date_hint(relative_path: &str) -> Option<String> {
    let runs = digit_runs(relative_path);

    for run in &runs {
        if run.len() == 8 && run.starts_with("20") {
            let year: i32 = run[0..4].parse().ok()?;
            if let Some(date) = iso_date(year, &run[4..6], &run[6..8]) {
                return Some(date);
            }
        }
    }
    for run in &runs {
        if run.len() == 6 {
            let yy: i32 = run[0..2].parse().ok()?;
            if let Some(date) = iso_date(2000 + yy, &run[2..4], &run[4..6]) {
                return Some(date);
            }
        }
    }
    None
}

fn digit_runs(text: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            runs.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        runs.push(current);
    }
    runs
}

fn iso_date(year: i32, month: &str, day: &str) -> Option<String> {
    let month: u32 = month.parse().ok()?;
    let day: u32 = day.parse().ok()?;
    if month == 0 || month > 12 || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Ported from `availabilityForPath`.
///
/// On Windows a OneDrive / Files-On-Demand placeholder is a real directory
/// entry with real metadata but no local bytes; opening it triggers a download
/// that can take minutes. Those are reported `online_only` so ingest does not
/// hash them (and so the UI can say why a document will be slow to open).
/// `std::os::windows::fs::MetadataExt` exposes the attribute word, so this
/// needs no `windows` crate.
pub fn availability_for_path(path: &Path) -> &'static str {
    let Ok(metadata) = fs::metadata(path) else {
        return "unavailable";
    };

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
        const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
        const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

        let attributes = metadata.file_attributes();
        if attributes
            & (FILE_ATTRIBUTE_OFFLINE
                | FILE_ATTRIBUTE_RECALL_ON_OPEN
                | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
            != 0
        {
            return "online_only";
        }
    }
    #[cfg(not(windows))]
    let _ = &metadata;

    "local"
}

// ---------------------------------------------------------------- sha-256 --

/// SHA-256, so `content_fingerprint` matches the Qt build's `sha256ForFile`
/// byte for byte.
///
/// Hand-rolled rather than pulled in as a dependency: `Cargo.toml` is owned
/// elsewhere, the algorithm is fixed by FIPS 180-4 and cannot drift, and it is
/// pinned here against the standard test vectors. If a hashing crate is ever
/// added, delete this and keep the tests.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut hasher = Sha256 {
        state: &mut state,
        buffer: [0u8; 64],
        buffered: 0,
        length: 0,
    };
    hasher.update(bytes);
    hasher.finish()
}

struct Sha256<'a> {
    state: &'a mut [u32; 8],
    buffer: [u8; 64],
    buffered: usize,
    length: u64,
}

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

impl Sha256<'_> {
    fn update(&mut self, mut bytes: &[u8]) {
        self.length = self.length.wrapping_add(bytes.len() as u64);
        while !bytes.is_empty() {
            let take = (64 - self.buffered).min(bytes.len());
            self.buffer[self.buffered..self.buffered + take].copy_from_slice(&bytes[..take]);
            self.buffered += take;
            bytes = &bytes[take..];
            if self.buffered == 64 {
                let block = self.buffer;
                compress(self.state, &block);
                self.buffered = 0;
            }
        }
    }

    fn finish(mut self) -> String {
        let bit_length = self.length.wrapping_mul(8);
        self.update(&[0x80]);
        // `update` counted the padding byte; undo that so the length field is
        // the message length, not the padded length.
        self.length = self.length.wrapping_sub(1);
        while self.buffered != 56 {
            self.update(&[0x00]);
            self.length = self.length.wrapping_sub(1);
        }
        let block_tail = bit_length.to_be_bytes();
        self.update(&block_tail);

        let mut out = String::with_capacity(64);
        for word in self.state.iter() {
            out.push_str(&format!("{word:08x}"));
        }
        out
    }
}

fn compress(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut w = [0u32; 64];
    for i in 0..16 {
        w[i] = u32::from_be_bytes([
            block[i * 4],
            block[i * 4 + 1],
            block[i * 4 + 2],
            block[i * 4 + 3],
        ]);
    }
    for i in 16..64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16]
            .wrapping_add(s0)
            .wrapping_add(w[i - 7])
            .wrapping_add(s1);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for i in 0..64 {
        let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let ch = (e & f) ^ ((!e) & g);
        let temp1 = h
            .wrapping_add(s1)
            .wrapping_add(ch)
            .wrapping_add(K[i])
            .wrapping_add(w[i]);
        let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = s0.wrapping_add(maj);

        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(temp1);
        d = c;
        c = b;
        b = a;
        a = temp1.wrapping_add(temp2);
    }

    for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
        *slot = slot.wrapping_add(value);
    }
}

/// SHA-256 of a file, streamed in 1 MiB chunks so a 128 MB drawing set does not
/// arrive in memory all at once.
pub fn fingerprint_file(path: &Path) -> Option<String> {
    use std::io::Read;

    let mut file = fs::File::open(path).ok()?;
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut hasher = Sha256 {
        state: &mut state,
        buffer: [0u8; 64],
        buffered: 0,
        length: 0,
    };
    let mut chunk = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&chunk[..read]);
    }
    Some(hasher.finish())
}

// ------------------------------------------------------------ timestamps --

/// RFC 3339 UTC with milliseconds, matching `Qt::ISODateWithMs` — the format
/// every other timestamp in this schema is written in.
pub fn iso_utc(time: SystemTime) -> Option<String> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    Some(format_epoch_millis(
        duration.as_secs() as i64,
        duration.subsec_millis(),
    ))
}

pub fn now_iso() -> String {
    iso_utc(SystemTime::now()).unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}

fn format_epoch_millis(seconds: i64, millis: u32) -> String {
    let days = seconds.div_euclid(86_400);
    let rem = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
    )
}

/// Howard Hinnant's `civil_from_days`. Exact for the whole proleptic Gregorian
/// range; no dependency, no drift.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ------------------------------------------------------------------ scan --

/// Walk a project folder and describe every file worth cataloging.
///
/// Depth-first, symlinks not followed, `.redbeam/` and the project's own
/// database skipped. Results are sorted by `relative_path` so two scans of an
/// unchanged folder are byte-identical — which is what makes the idempotency
/// test on the TypeScript side meaningful rather than incidental.
pub fn scan_project(root: &Path, extensions: &[String]) -> Result<ScanResult, String> {
    let root = canonical_project_root(root);
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }

    let wanted: Vec<String> = extensions.iter().map(|e| e.to_ascii_lowercase()).collect();
    let mut result = ScanResult {
        root: root.display().to_string(),
        scanned_at: now_iso(),
        ..Default::default()
    };

    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_SCAN_DEPTH {
            result.truncated = true;
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => {
                result.unreadable.push(dir.display().to_string());
                continue;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            // `file_type` from the DirEntry does not follow symlinks, which is
            // exactly what we want: a link into a sibling job folder would
            // otherwise be cataloged under this project's relative paths.
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }

            let Some(relative_path) = normalized_relative_path(&root, &path) else {
                continue;
            };
            if is_internal(&relative_path) {
                continue;
            }

            if file_type.is_dir() {
                stack.push((path, depth + 1));
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if is_project_database(&name) {
                continue;
            }
            if !wanted.is_empty() {
                let suffix = extension_of(&relative_path.to_ascii_lowercase());
                if !wanted.iter().any(|w| *w == suffix) {
                    continue;
                }
            }

            if result.files.len() >= MAX_SCAN_FILES {
                result.truncated = true;
                break;
            }

            result.files.push(describe_file(&path, relative_path, name));
        }

        if result.truncated && result.files.len() >= MAX_SCAN_FILES {
            break;
        }
    }

    result
        .files
        .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(result)
}

fn describe_file(path: &Path, relative_path: String, display_name: String) -> ScannedFile {
    let metadata = fs::metadata(path).ok();
    let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_at = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(iso_utc);
    let availability = availability_for_path(path);

    // Matches the Qt build: only hash what is actually on this disk and small
    // enough to be worth reading. A cloud placeholder would be downloaded in
    // full just to produce a hash nobody has asked for yet.
    let content_fingerprint = if availability == "local" && size_bytes <= MAX_FINGERPRINT_BYTES {
        fingerprint_file(path)
    } else {
        None
    };

    ScannedFile {
        kind: classify_kind(&relative_path).to_string(),
        status: classify_status(&relative_path).to_string(),
        file_date_hint: extract_file_date_hint(&relative_path),
        relative_path,
        absolute_path: path.display().to_string(),
        display_name,
        size_bytes,
        modified_at,
        content_fingerprint,
        availability: availability.to_string(),
    }
}

// --------------------------------------------------------------- recents --

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RecentsFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    projects: Vec<RecentProject>,
}

/// Read the recents list, recomputing `missing` against the filesystem.
///
/// A malformed or unreadable file yields an empty list rather than an error:
/// losing the recents list is a nuisance, but refusing to start the app over it
/// would be worse. Corrupt content is replaced on the next successful write.
pub fn read_recents(file: &Path) -> Vec<RecentProject> {
    let Ok(text) = fs::read_to_string(file) else {
        return Vec::new();
    };
    let parsed: RecentsFile = serde_json::from_str(&text).unwrap_or_default();
    let mut seen: HashMap<String, ()> = HashMap::new();
    parsed
        .projects
        .into_iter()
        .filter(|p| seen.insert(p.path.to_ascii_lowercase(), ()).is_none())
        .map(|mut p| {
            p.missing = !Path::new(&p.path).is_dir();
            p
        })
        .take(MAX_RECENTS)
        .collect()
}

/// Write the recents list atomically.
///
/// Written to a sibling temp file and renamed, so a crash mid-write leaves the
/// previous list intact instead of a truncated JSON file that reads as empty.
pub fn write_recents(file: &Path, projects: &[RecentProject]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let payload = RecentsFile {
        version: 1,
        projects: projects.iter().take(MAX_RECENTS).cloned().collect(),
    };
    let text = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    // `rename` over an existing file is atomic on POSIX and on NTFS via
    // MoveFileEx; std's rename replaces the destination on both.
    fs::rename(&temp, file).map_err(|e| e.to_string())
}

/// Move a project to the front of the list, deduplicating by path.
///
/// Path comparison is case-insensitive. That is correct on Windows and on
/// macOS's default filesystem, and the failure it prevents — the same folder
/// listed twice under two spellings — is worse than the one it can cause on a
/// case-sensitive volume, where two genuinely distinct folders differing only
/// in case would collapse. Nobody names two bid packages that way.
pub fn promote_recent(
    existing: &[RecentProject],
    project: &ProjectInfo,
    when: String,
) -> Vec<RecentProject> {
    let key = project.path.to_ascii_lowercase();
    let mut out = vec![RecentProject {
        path: project.path.clone(),
        name: project.name.clone(),
        last_opened_at: when,
        missing: false,
    }];
    out.extend(
        existing
            .iter()
            .filter(|p| p.path.to_ascii_lowercase() != key)
            .cloned(),
    );
    out.truncate(MAX_RECENTS);
    out
}

/// Absolute path of the recents file for this app installation.
pub fn recents_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve the app config directory: {e}"))?;
    Ok(dir.join(RECENTS_FILE))
}

// --------------------------------------------------------------- opening --

/// Resolve a project folder, optionally creating it.
///
/// Deliberately does NOT open the database. `db_open` already owns that, and
/// having two commands able to swap the process-wide connection would make it
/// ambiguous which one last won. The caller takes [`ProjectInfo::db_path`] and
/// passes it to `db_open`.
pub fn resolve_project(path: &str, create: bool) -> Result<ProjectInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("no project folder was given".to_string());
    }
    let requested = PathBuf::from(trimmed);
    if !requested.is_absolute() {
        return Err(format!(
            "{trimmed} is not an absolute path — a project folder must be addressed absolutely, \
             not relative to whatever directory the app was launched from"
        ));
    }

    let mut created = false;
    if !requested.exists() {
        if !create {
            return Err(format!("{trimmed} does not exist"));
        }
        fs::create_dir_all(&requested)
            .map_err(|e| format!("could not create {trimmed}: {e}"))?;
        created = true;
    }

    let asked = canonical_project_root(&requested);
    if !asked.is_dir() {
        return Err(format!("{} is a file, not a project folder", asked.display()));
    }
    let root = outermost_project_root(&asked);
    let redirected_from = if root == asked {
        None
    } else {
        Some(asked.display().to_string())
    };

    let db_path = resolve_db_path(&root.display().to_string());
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string());

    Ok(ProjectInfo {
        path: root.display().to_string(),
        name,
        db_path: db_path.display().to_string(),
        created,
        has_database: db_path.is_file(),
        redirected_from,
    })
}

/// The project a folder actually belongs to: the OUTERMOST ancestor that
/// already carries a `redbeam.db`, or the folder itself when none does.
///
/// Opening a drawing makes its folder the project, and the drawing is usually
/// three levels down in the bid package — so the next thing that happens is
/// the bid package's own folder being opened as a project too. That gave two
/// projects nested one inside the other, each with its own database and its
/// own idea of which documents exist, and the one opened second showed the
/// first's `.redbeam/` cache and none of its takeoff. Aaron: "It should
/// prioritize the parent file over the subfolder and ignore the subfolder
/// redbeam config file."
///
/// So a folder inside an existing project IS that project. Outermost rather
/// than nearest so that three nested databases resolve to one answer rather
/// than to whichever was asked for.
pub fn outermost_project_root(folder: &Path) -> PathBuf {
    let mut root = folder.to_path_buf();
    for ancestor in folder.ancestors().skip(1) {
        if ancestor.join(crate::store::db::DB_FILE_NAME).is_file() {
            root = ancestor.to_path_buf();
        }
    }
    root
}

// -------------------------------------------------------------- commands --

/// Pick a project folder with the OS folder dialog.
///
/// # What this needs, exactly
///
/// The dialog is behind a Cargo feature because `Cargo.toml` and `lib.rs` are
/// owned elsewhere. To turn it on, three lines:
///
/// ```toml
/// # Cargo.toml
/// [dependencies]
/// tauri-plugin-dialog = { version = "2", optional = true }
///
/// [features]
/// dialog = ["dep:tauri-plugin-dialog"]
/// default = ["dialog"]
/// ```
///
/// ```ignore
/// // lib.rs
/// tauri::Builder::default().plugin(tauri_plugin_dialog::init())
/// ```
///
/// **No capability permission is required for this**, and that is worth being
/// precise about rather than adding `dialog:default` reflexively. The Tauri v2
/// ACL gates commands invoked *from the webview*. This dialog is opened from
/// Rust, inside an application command, so it never crosses that boundary.
/// Granting `dialog:allow-open` would only be needed if the frontend called
/// `@tauri-apps/plugin-dialog`'s `open()` directly — and `dialog:default` is
/// wider still, since it also carries `allow-ask`, `allow-confirm`,
/// `allow-message` and `allow-save`.
///
/// Called from a worker thread (the command is `async`) because the native
/// dialog blocks, and blocking the main thread would deadlock the event loop
/// the dialog needs — the same constraint `window.rs` documents.
#[tauri::command]
pub async fn project_pick_folder(app: AppHandle) -> Result<PickOutcome, String> {
    match pick_folder_native(&app) {
        Ok(Some(path)) => Ok(PickOutcome {
            supported: true,
            path: Some(canonical_project_root(&path).display().to_string()),
            reason: None,
        }),
        Ok(None) => Ok(PickOutcome {
            supported: true,
            path: None,
            reason: None,
        }),
        Err(reason) => Ok(PickOutcome {
            supported: false,
            path: None,
            reason: Some(reason),
        }),
    }
}

fn pick_folder_native(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a REDBEAM project folder")
        .blocking_pick_folder();
    Ok(picked.and_then(|p| p.into_path().ok()))
}

fn pick_drawing_native(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Open a drawing set")
        .add_filter("PDF drawings", &["pdf"])
        .blocking_pick_file();
    Ok(picked.and_then(|p| p.into_path().ok()))
}

/// Where an export goes: a native Save As, then the bytes written there.
///
/// Every export used to hand a blob to the webview's downloader, which put
/// it in the Downloads folder under a name nobody chose. Aaron: "it should
/// prompt you where to save it by default". The dialog runs from Rust for the
/// same reason the pickers do — no ACL grant to the webview — and it blocks,
/// so the command is `async` and Tauri runs it off the main thread.
///
/// `None` means the person cancelled; that is not an error.
#[tauri::command]
pub async fn project_save_file(
    app: AppHandle,
    default_name: String,
    bytes: Vec<u8>,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_file_name(&default_name).set_title("Save");
    if let (Some(name), Some(exts)) = (filter_name.as_deref(), extensions.as_deref()) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(name, &refs);
    }
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("the chosen location is not a file path: {e}"))?;
    fs::write(&path, &bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

/// Open a PDF, and let the project be wherever that PDF lives.
///
/// The start screen used to demand a project FOLDER before it would show
/// anything, which is backwards: nobody is handed a project folder, they are
/// handed a drawing set. The folder is our bookkeeping — one `redbeam.db`
/// beside the drawings — and it can be derived instead of asked for.
///
/// Returns the resolved project plus the document that was chosen, so the
/// caller can open the project AND jump straight to that sheet rather than
/// landing on a file list with one entry.
#[tauri::command]
pub async fn project_pick_drawing(app: AppHandle) -> Result<DrawingPickOutcome, String> {
    let picked = match pick_drawing_native(&app) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return Ok(DrawingPickOutcome {
                supported: true,
                project: None,
                relative_path: None,
                reason: None,
            })
        }
        Err(reason) => {
            return Ok(DrawingPickOutcome {
                supported: false,
                project: None,
                relative_path: None,
                reason: Some(reason),
            })
        }
    };

    let folder = match picked.parent() {
        Some(dir) => dir.to_path_buf(),
        // A PDF at a filesystem root has no parent. Vanishingly rare, but the
        // alternative to saying so is unwrap() on someone's real file.
        None => return Err("that file has no containing folder".to_string()),
    };
    let info = resolve_project(&folder.display().to_string(), false)?;
    if let Ok(file) = recents_path(&app) {
        let promoted = promote_recent(&read_recents(&file), &info, now_iso());
        if let Err(err) = write_recents(&file, &promoted) {
            eprintln!("[project] could not write the recents list: {err}");
        }
    }

    let name = picked
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(DrawingPickOutcome {
        supported: true,
        project: Some(info),
        relative_path: Some(name),
        reason: None,
    })
}

/// What [`project_pick_drawing`] managed to do.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingPickOutcome {
    /// False only when this build has no native dialog at all.
    pub supported: bool,
    /// The project the chosen drawing lives in. None when cancelled.
    pub project: Option<ProjectInfo>,
    /// The chosen drawing's file name, relative to the project folder.
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

/// Resolve a project folder and record it as the most recent.
///
/// `create` defaults to false: opening a path that is not there is an error,
/// not an invitation to make an empty folder somewhere unexpected.
#[tauri::command]
pub async fn project_open(
    app: AppHandle,
    path: String,
    create: Option<bool>,
) -> Result<ProjectInfo, String> {
    let info = resolve_project(&path, create.unwrap_or(false))?;
    // So a crash report can say which project was open (TH.8). It is the first
    // question asked of one, and a report that cannot answer it usually cannot
    // be acted on.
    crate::crash::set_open_project(Some(info.path.clone()));
    // A failure to record the recent must not fail the open — the project is
    // already usable and losing a list entry is not worth refusing to work.
    if let Ok(file) = recents_path(&app) {
        let promoted = promote_recent(&read_recents(&file), &info, now_iso());
        if let Err(err) = write_recents(&file, &promoted) {
            eprintln!("[project] could not write the recents list: {err}");
        }
    }
    Ok(info)
}

/// Recent projects, newest first, each flagged if its folder is gone.
#[tauri::command]
pub async fn project_recents(app: AppHandle) -> Result<Vec<RecentProject>, String> {
    Ok(read_recents(&recents_path(&app)?))
}

/// Drop one project from the recents list. Returns the list that remains.
#[tauri::command]
pub async fn project_forget_recent(
    app: AppHandle,
    path: String,
) -> Result<Vec<RecentProject>, String> {
    let file = recents_path(&app)?;
    let key = path.to_ascii_lowercase();
    let remaining: Vec<RecentProject> = read_recents(&file)
        .into_iter()
        .filter(|p| p.path.to_ascii_lowercase() != key)
        .collect();
    write_recents(&file, &remaining)?;
    Ok(remaining)
}

/// Empty the recents list.
#[tauri::command]
pub async fn project_clear_recents(app: AppHandle) -> Result<(), String> {
    write_recents(&recents_path(&app)?, &[])
}

/// Read one document out of a project folder, as raw bytes.
///
/// # Why this exists
///
/// Page boxes come from PDFium, which runs in the frontend's worker, and the
/// worker reaches a document by URL. Getting a URL for a file on disk normally
/// means Tauri's asset protocol — which costs `core:asset:default` plus an
/// `app.security.assetProtocol` scope in `tauri.conf.json`, a real widening of
/// the grant. This is the cheaper alternative: the bytes come across the IPC
/// hop once and the frontend makes a blob URL out of them, with no new
/// permission at all.
///
/// It is not free. The file is fully resident in memory on both sides for the
/// duration, which is why [`MAX_DOCUMENT_READ_BYTES`] exists and why the asset
/// protocol is still the better answer for a build that is willing to widen the
/// grant. `tauri::ipc::Response` carries the bytes raw rather than as
/// base64-in-JSON, so the cost is the copy and not much more.
///
/// `relative_path` is resolved **under** the project root and rejected if it
/// escapes: a `..` in the path is either a bug or an attempt to read the rest
/// of the disk through a command that is supposed to see one folder.
#[tauri::command]
pub async fn project_read_document(
    path: String,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let root = canonical_project_root(Path::new(&path));
    let target = resolve_inside(&root, &relative_path)?;

    let metadata = fs::metadata(&target).map_err(|e| format!("{relative_path}: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("{relative_path} is not a file"));
    }
    if metadata.len() > MAX_DOCUMENT_READ_BYTES {
        return Err(format!(
            "{relative_path} is {} bytes, over the {MAX_DOCUMENT_READ_BYTES}-byte limit for \
             reading a document through the IPC hop",
            metadata.len()
        ));
    }

    let bytes = fs::read(&target).map_err(|e| format!("{relative_path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Cap on [`project_read_document`]. A drawing set's individual sheets are
/// single-digit megabytes; anything past this wants the asset protocol.
pub const MAX_DOCUMENT_READ_BYTES: u64 = 256 * 1024 * 1024;

/// Join a project-relative path onto its root, refusing anything that escapes.
///
/// Checked before touching the filesystem AND again after canonicalizing, so a
/// symlink inside the project cannot be used to step outside it.
fn resolve_inside(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative_path);
    if candidate.is_absolute() {
        return Err(format!("{relative_path} is not a project-relative path"));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("{relative_path} escapes the project folder")),
        }
    }

    let joined = root.join(candidate);
    let resolved = canonical_project_root(&joined);
    if !resolved.starts_with(root) {
        return Err(format!("{relative_path} escapes the project folder"));
    }
    Ok(resolved)
}

/// Catalog the files in a project folder.
///
/// `extensions` defaults to [`DEFAULT_EXTENSIONS`]; pass an empty array to
/// catalog everything, which is what the Qt build did.
#[tauri::command]
pub async fn project_scan(
    path: String,
    extensions: Option<Vec<String>>,
) -> Result<ScanResult, String> {
    let extensions = extensions.unwrap_or_else(|| {
        DEFAULT_EXTENSIONS
            .iter()
            .map(|e| (*e).to_string())
            .collect()
    });
    scan_project_shared(Path::new(&path), &extensions)
}

/// Scan, but never twice at once for the same folder.
///
/// # Why this is not a micro-optimisation
///
/// A scan hashes every file: on the archived Barclays package that is 693 PDFs
/// and 3.71 GB, which is ~15s in release and ~3 minutes in a debug build. It is
/// also not cancellable — a `cancelled` flag in a React effect stops the state
/// update, not the work already running in here.
///
/// React's `StrictMode` double-invokes effects in development, so opening a
/// project fired TWO of these concurrently, each hashing the whole tree. That
/// was measured: ~1.8 cores across 22 threads, with the project showing empty
/// the entire time and the database untouched. A remount or an impatient
/// double-click does the same thing in production.
///
/// The second caller now waits for the first and gets its result, rather than
/// starting a second scan of the same bytes. The entry is dropped afterwards so
/// a LATER scan still re-reads the folder — this deduplicates concurrent work,
/// it does not cache.
fn scan_project_shared(root: &Path, extensions: &[String]) -> Result<ScanResult, String> {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};

    type Slot = Arc<OnceLock<Result<ScanResult, String>>>;
    static INFLIGHT: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    let inflight = INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()));

    // Key on the canonical path AND the extension set: a scan for a different
    // filter is different work and must not be served the first one's answer.
    let key = format!("{}|{}", canonical_project_root(root).display(), extensions.join(","));

    let slot: Slot = {
        let mut map = inflight.lock().unwrap_or_else(|e| e.into_inner());
        Arc::clone(map.entry(key.clone()).or_default())
    };

    // `get_or_init` blocks every other caller until the first finishes, which
    // is exactly the join we want.
    let result = slot.get_or_init(|| scan_project(root, extensions)).clone();

    // Drop the slot so the next open re-reads the folder. Only the entry we
    // created is removed, and only if it is still the same one.
    {
        let mut map = inflight.lock().unwrap_or_else(|e| e.into_inner());
        if map.get(&key).is_some_and(|s| Arc::ptr_eq(s, &slot)) {
            map.remove(&key);
        }
    }
    result
}

// ------------------------------------------------------------------ tests --

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "redbeam-project-{tag}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(root: &Path, relative: &str, contents: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents).unwrap();
    }

    // ------------------------------------------------------------ sha-256 --

    #[test]
    fn sha256_matches_the_standard_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn sha256_spans_multiple_blocks() {
        // 1,000,000 'a' — the FIPS long message vector.
        let million = vec![b'a'; 1_000_000];
        assert_eq!(
            sha256_hex(&million),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn fingerprint_file_agrees_with_the_in_memory_hash() {
        let dir = temp_dir("fingerprint");
        write_file(&dir, "a.pdf", b"%PDF-1.7 not really");
        assert_eq!(
            fingerprint_file(&dir.join("a.pdf")),
            Some(sha256_hex(b"%PDF-1.7 not really"))
        );
        fs::remove_dir_all(&dir).ok();
    }

    // -------------------------------------------------------- classifiers --

    #[test]
    fn classifies_kind_like_the_qt_build() {
        assert_eq!(classify_kind("PKG A/ARCH/A-101 Plan.pdf"), "drawing");
        assert_eq!(classify_kind("model.dwg"), "drawing");
        // "spec" wins over the .pdf extension — this ordering is load bearing.
        assert_eq!(classify_kind("Specifications/09 51 00.pdf"), "specification");
        assert_eq!(classify_kind("Meeting notes 2026-01-04.pdf"), "decision");
        assert_eq!(classify_kind("Close-out/warranty.pdf"), "reference");
        assert_eq!(classify_kind("Submittal/baffles.pdf"), "deliverable");
        assert_eq!(classify_kind("letter.docx"), "document");
        assert_eq!(classify_kind("site.jpg"), "image");
        assert_eq!(classify_kind("thread.msg"), "message");
        assert_eq!(classify_kind("archive.zip"), "other");
    }

    #[test]
    fn classifies_status_like_the_qt_build() {
        assert_eq!(classify_status("PKG A/A-101.pdf"), "current");
        assert_eq!(classify_status("Archive/PKG A/A-101.pdf"), "superseded");
        assert_eq!(classify_status("Superseded/A-101.pdf"), "superseded");
        assert_eq!(classify_status("Draft/A-101.pdf"), "draft");
        // superseded is tested before draft, so a path with both is superseded.
        assert_eq!(classify_status("Archive/Draft/A-101.pdf"), "superseded");
    }

    #[test]
    fn extracts_eight_digit_date_hints() {
        assert_eq!(
            extract_file_date_hint("PKG A 20260415/A-101.pdf").as_deref(),
            Some("2026-04-15")
        );
        // A nine-digit run is not an eight-digit match — the lookarounds in the
        // Qt regex mean the run has to be exactly that long.
        assert_eq!(extract_file_date_hint("202604150/A-101.pdf").as_deref(), None);
    }

    #[test]
    fn extracts_six_digit_date_hints() {
        assert_eq!(
            extract_file_date_hint("260415 - REDBEAM/A-101.pdf").as_deref(),
            Some("2026-04-15")
        );
    }

    #[test]
    fn rejects_impossible_dates() {
        assert_eq!(extract_file_date_hint("20261340.pdf").as_deref(), None);
        assert_eq!(extract_file_date_hint("260230.pdf").as_deref(), None);
        // 2024 is a leap year, 2026 is not.
        assert_eq!(extract_file_date_hint("240229.pdf").as_deref(), Some("2024-02-29"));
        assert_eq!(extract_file_date_hint("260229.pdf").as_deref(), None);
    }

    #[test]
    fn a_sheet_number_is_not_a_date() {
        assert_eq!(extract_file_date_hint("A-101.pdf"), None);
        assert_eq!(extract_file_date_hint("PKG A/ARCH/A-4.03.pdf"), None);
    }

    // -------------------------------------------------------------- paths --

    #[test]
    fn normalizes_relative_paths_with_forward_slashes() {
        let root = Path::new("C:/jobs/260415");
        assert_eq!(
            normalized_relative_path(root, Path::new("C:/jobs/260415/PKG A/A-101.pdf")).as_deref(),
            Some("PKG A/A-101.pdf")
        );
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let root = Path::new("C:/jobs/260415");
        assert_eq!(
            normalized_relative_path(root, Path::new("C:/jobs/other/A-101.pdf")),
            None
        );
        // The root itself is not a document.
        assert_eq!(normalized_relative_path(root, root), None);
    }

    #[test]
    fn a_nested_folder_opens_its_outermost_project() {
        let dir = temp_dir("nested");
        let outer = dir.join("Bid Package");
        let inner = outer.join("1 Data").join("Drawings");
        fs::create_dir_all(&inner).unwrap();
        fs::write(outer.join("redbeam.db"), b"").unwrap();
        // The drawings folder was once opened as a project of its own.
        fs::write(inner.join("redbeam.db"), b"").unwrap();

        let info = resolve_project(&inner.display().to_string(), false).unwrap();
        assert_eq!(info.path, canonical_project_root(&outer).display().to_string());
        assert_eq!(info.name, "Bid Package");
        assert_eq!(
            info.redirected_from.as_deref(),
            Some(canonical_project_root(&inner).display().to_string().as_str())
        );
        assert!(info.has_database);

        // Asking for the outer folder itself is not a redirect.
        let direct = resolve_project(&outer.display().to_string(), false).unwrap();
        assert_eq!(direct.redirected_from, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_with_no_project_above_it_is_its_own_root() {
        let dir = temp_dir("own-root");
        let inner = dir.join("a").join("b");
        fs::create_dir_all(&inner).unwrap();
        let info = resolve_project(&inner.display().to_string(), false).unwrap();
        assert_eq!(info.path, canonical_project_root(&inner).display().to_string());
        assert_eq!(info.redirected_from, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_a_nested_internal_directory_and_database() {
        let dir = temp_dir("nested-internal");
        write_file(&dir, "drawings/A-101.pdf", b"one");
        // A subfolder that was once its own project.
        write_file(&dir, "drawings/.redbeam/cache/thumb.pdf", b"two");
        write_file(&dir, "drawings/redbeam.db", b"three");
        write_file(&dir, "drawings/redbeam.db-wal", b"four");
        let scan = scan_project(&dir, &["pdf".to_string()]).unwrap();
        let paths: Vec<&str> = scan.files.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["drawings/A-101.pdf"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_the_internal_directory() {
        assert!(is_internal(".redbeam"));
        assert!(is_internal(".redbeam/cache/x.bin"));
        assert!(is_internal(".REDBEAM/cache/x.bin"));
        assert!(is_internal("drawings/.redbeam/cache/x.bin"));
        assert!(!is_internal("drawings/redbeam-notes/x.pdf"));
        assert!(!is_internal("redbeam/x.pdf"));
    }

    #[test]
    fn skips_the_project_database() {
        assert!(is_project_database("redbeam.db"));
        assert!(is_project_database("redbeam.db-wal"));
        assert!(is_project_database("REDBEAM.DB-SHM"));
        assert!(!is_project_database("redbeam.pdf"));
    }

    // --------------------------------------------------------------- scan --

    #[test]
    fn scans_pdfs_and_skips_everything_else() {
        let dir = temp_dir("scan");
        write_file(&dir, "PKG A/A-101.pdf", b"one");
        write_file(&dir, "PKG A/A-102.pdf", b"two");
        write_file(&dir, "notes.txt", b"three");
        write_file(&dir, ".redbeam/cache.bin", b"four");
        write_file(&dir, "redbeam.db", b"five");

        let scan = scan_project(&dir, &["pdf".to_string()]).unwrap();
        let paths: Vec<&str> = scan.files.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["PKG A/A-101.pdf", "PKG A/A-102.pdf"]);
        assert!(!scan.truncated);
        assert_eq!(scan.files[0].kind, "drawing");
        assert_eq!(scan.files[0].status, "current");
        assert_eq!(scan.files[0].availability, "local");
        assert_eq!(scan.files[0].size_bytes, 3);
        assert_eq!(
            scan.files[0].content_fingerprint.as_deref(),
            Some(sha256_hex(b"one").as_str())
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Windows path separator as a char, spelled out so the literal survives
    /// every layer of quoting between here and the compiler.
    const MAIN_SEPARATOR_BACKSLASH: char = 0x5C as char;

    /// Scan a REAL client drawing tree, not a synthesized one (plan 02.1).
    ///
    /// Skips with a printed reason when the archive is not on this machine, so
    /// it never fails a checkout that does not have the client data. Point it
    /// somewhere else with REDBEAM_REAL_PROJECT_DIR.
    ///
    /// A synthesized temp dir cannot produce what this catches: deep nesting,
    /// spaces and dashes in every path segment, mixed-case extensions, hundreds
    /// of siblings in one folder, and non-PDF clutter interleaved throughout.
    #[test]
    fn scans_a_real_client_drawing_tree() {
        const DEFAULT_REAL: &str = concat!(
            r"C:\Users\aaron\Dev Projects\260415 - REDBEAM Archive\",
            r"Testing Case Studies\Barclays - Midrise Floors Phase 1"
        );
        let root = std::env::var("REDBEAM_REAL_PROJECT_DIR")
            .unwrap_or_else(|_| DEFAULT_REAL.to_string());
        let root = PathBuf::from(root);
        if !root.is_dir() {
            eprintln!("skipping: no real project tree at {}", root.display());
            return;
        }

        let started = std::time::Instant::now();
        let scan = scan_project(&root, &["pdf".to_string()]).unwrap();
        let elapsed = started.elapsed();

        // The tree really does hold hundreds of drawings. A handful would mean
        // the walk stopped early somewhere it should not have.
        assert!(
            scan.files.len() > 500,
            "expected hundreds of PDFs, found {}",
            scan.files.len()
        );
        // Neither cap should trip on a real job folder. If one does, the cap is
        // wrong for real work, not the folder.
        assert!(
            !scan.truncated,
            "a real client folder tripped MAX_SCAN_FILES or MAX_SCAN_DEPTH"
        );
        assert!(
            scan.unreadable.is_empty(),
            "unreadable directories: {:?}",
            scan.unreadable
        );

        for f in &scan.files {
            // Relative, forward-slashed and inside the project — never absolute
            // and never escaping upward, or ingest writes rows that point out
            // of the project.
            assert!(!f.relative_path.contains(MAIN_SEPARATOR_BACKSLASH), "backslash in {}", f.relative_path);
            assert!(!f.relative_path.starts_with('/'), "absolute {}", f.relative_path);
            assert!(!f.relative_path.contains(".."), "escapes upward: {}", f.relative_path);
            assert!(f.relative_path.to_ascii_lowercase().ends_with(".pdf"));
            assert!(f.size_bytes > 0, "empty file {}", f.relative_path);
            assert_eq!(f.availability, "local");
        }

        // relative_path is the ingest key, so a duplicate would silently
        // collapse two drawings into one row.
        let mut seen = std::collections::HashSet::new();
        for f in &scan.files {
            assert!(seen.insert(f.relative_path.clone()), "duplicate {}", f.relative_path);
        }

        // The nesting is what makes this worth testing at all.
        let deepest = scan
            .files
            .iter()
            .map(|f| f.relative_path.matches('/').count())
            .max()
            .unwrap_or(0);
        assert!(deepest >= 3, "expected a deep tree, deepest was {deepest}");

        eprintln!(
            "real scan: {} PDFs, deepest {} levels, {:?}",
            scan.files.len(),
            deepest,
            elapsed
        );
    }

    /// Two concurrent scans of one folder must do the work ONCE.
    ///
    /// React StrictMode double-invokes effects, so this fired twice on every
    /// project open. On the real Barclays package that was two full passes over
    /// 3.71 GB — minutes of CPU, with the project showing empty throughout.
    #[test]
    fn concurrent_scans_of_one_folder_do_the_work_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let dir = temp_dir("scan-concurrent");
        for i in 0..40 {
            write_file(&dir, &format!("PKG/A-{i}.pdf"), format!("body {i}").as_bytes());
        }

        // Count how many callers actually reached the filesystem walk by
        // timing: the shared path returns an identical value to both, and a
        // second independent walk would produce an equal-but-separate result.
        // Equality is not enough to prove sharing, so this asserts the
        // observable contract instead — both callers succeed with the same
        // records, and neither blocks forever.
        let started = Arc::new(AtomicUsize::new(0));
        let exts = vec!["pdf".to_string()];

        let handles: Vec<_> = (0..4)
            .map(|_| {
                let dir = dir.clone();
                let exts = exts.clone();
                let started = Arc::clone(&started);
                std::thread::spawn(move || {
                    started.fetch_add(1, Ordering::Relaxed);
                    scan_project_shared(&dir, &exts)
                })
            })
            .collect();

        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(started.load(Ordering::Relaxed), 4);
        for r in &results {
            let scan = r.as_ref().expect("every caller gets a result");
            assert_eq!(scan.files.len(), 40);
        }
        // All four agree exactly — one caller's answer served them all.
        for r in &results[1..] {
            assert_eq!(r.as_ref().unwrap().files, results[0].as_ref().unwrap().files);
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_later_scan_still_re_reads_the_folder() {
        // The in-flight map deduplicates CONCURRENT work; it must not cache, or
        // a file added after an open would never appear.
        let dir = temp_dir("scan-not-cached");
        write_file(&dir, "a.pdf", b"a");
        let exts = vec!["pdf".to_string()];
        assert_eq!(scan_project_shared(&dir, &exts).unwrap().files.len(), 1);
        write_file(&dir, "b.pdf", b"b");
        assert_eq!(scan_project_shared(&dir, &exts).unwrap().files.len(), 2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scanning_twice_produces_the_same_records() {
        let dir = temp_dir("scan-twice");
        write_file(&dir, "b.pdf", b"b");
        write_file(&dir, "a.pdf", b"a");

        let first = scan_project(&dir, &["pdf".to_string()]).unwrap();
        let second = scan_project(&dir, &["pdf".to_string()]).unwrap();
        assert_eq!(first.files, second.files);
        // Sorted, so the order does not depend on the filesystem's whim.
        assert_eq!(first.files[0].relative_path, "a.pdf");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_extension_list_catalogs_everything() {
        let dir = temp_dir("scan-all");
        write_file(&dir, "a.pdf", b"a");
        write_file(&dir, "b.txt", b"b");
        let scan = scan_project(&dir, &[]).unwrap();
        assert_eq!(scan.files.len(), 2);
        fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------ path escaping --

    #[test]
    fn resolves_a_document_inside_the_project() {
        let dir = temp_dir("inside");
        write_file(&dir, "PKG A/A-101.pdf", b"a");
        let root = canonical_project_root(&dir);
        let resolved = resolve_inside(&root, "PKG A/A-101.pdf").unwrap();
        assert!(resolved.ends_with("A-101.pdf"));
        assert!(resolved.starts_with(&root));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_path_that_escapes_the_project() {
        let root = canonical_project_root(&temp_dir("escape"));
        assert!(resolve_inside(&root, "../secrets.pdf").is_err());
        assert!(resolve_inside(&root, "PKG A/../../secrets.pdf").is_err());
        assert!(resolve_inside(&root, "C:/Windows/system.ini").is_err());
        assert!(resolve_inside(&root, "/etc/passwd").is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scanning_a_file_is_an_error_not_an_empty_result() {
        let dir = temp_dir("scan-file");
        write_file(&dir, "a.pdf", b"a");
        assert!(scan_project(&dir.join("a.pdf"), &[]).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------------ recents --

    #[test]
    fn recents_round_trip() {
        let dir = temp_dir("recents");
        let file = dir.join(RECENTS_FILE);
        let project = ProjectInfo {
            path: dir.display().to_string(),
            name: "260415".into(),
            db_path: dir.join("redbeam.db").display().to_string(),
            created: false,
            has_database: false,
        redirected_from: None,
        };
        let promoted = promote_recent(&[], &project, "2026-08-28T00:00:00.000Z".into());
        write_recents(&file, &promoted).unwrap();

        let read = read_recents(&file);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].name, "260415");
        assert!(!read[0].missing);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reopening_promotes_rather_than_duplicates() {
        let a = ProjectInfo {
            path: "C:/jobs/a".into(),
            name: "a".into(),
            db_path: "C:/jobs/a/redbeam.db".into(),
            created: false,
            has_database: true,
        redirected_from: None,
        };
        let b = ProjectInfo {
            path: "C:/jobs/b".into(),
            name: "b".into(),
            db_path: "C:/jobs/b/redbeam.db".into(),
            created: false,
            has_database: true,
        redirected_from: None,
        };
        let list = promote_recent(&[], &a, "t1".into());
        let list = promote_recent(&list, &b, "t2".into());
        let list = promote_recent(&list, &a, "t3".into());

        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "C:/jobs/a");
        assert_eq!(list[0].last_opened_at, "t3");
        assert_eq!(list[1].path, "C:/jobs/b");
    }

    #[test]
    fn recents_deduplicate_case_insensitively() {
        let existing = vec![RecentProject {
            path: "C:/Jobs/A".into(),
            name: "A".into(),
            last_opened_at: "t1".into(),
            missing: false,
        }];
        let same = ProjectInfo {
            path: "c:/jobs/a".into(),
            name: "a".into(),
            db_path: "c:/jobs/a/redbeam.db".into(),
            created: false,
            has_database: true,
        redirected_from: None,
        };
        assert_eq!(promote_recent(&existing, &same, "t2".into()).len(), 1);
    }

    #[test]
    fn recents_are_capped() {
        let mut list: Vec<RecentProject> = Vec::new();
        for i in 0..(MAX_RECENTS + 25) {
            let info = ProjectInfo {
                path: format!("C:/jobs/{i}"),
                name: format!("{i}"),
                db_path: format!("C:/jobs/{i}/redbeam.db"),
                created: false,
                has_database: false,
            redirected_from: None,
            };
            list = promote_recent(&list, &info, format!("t{i}"));
        }
        assert_eq!(list.len(), MAX_RECENTS);
        // Newest survives, oldest is dropped.
        assert_eq!(list[0].path, format!("C:/jobs/{}", MAX_RECENTS + 24));
    }

    #[test]
    fn a_missing_folder_is_flagged_not_dropped() {
        let dir = temp_dir("recents-missing");
        let file = dir.join(RECENTS_FILE);
        write_recents(
            &file,
            &[RecentProject {
                path: dir.join("gone").display().to_string(),
                name: "gone".into(),
                last_opened_at: "t1".into(),
                missing: false,
            }],
        )
        .unwrap();

        let read = read_recents(&file);
        assert_eq!(read.len(), 1, "a missing project stays in the list");
        assert!(read[0].missing);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_corrupt_recents_file_reads_as_empty() {
        let dir = temp_dir("recents-corrupt");
        let file = dir.join(RECENTS_FILE);
        fs::write(&file, "{ not json").unwrap();
        assert!(read_recents(&file).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writing_recents_leaves_no_temp_file_behind() {
        let dir = temp_dir("recents-atomic");
        let file = dir.join(RECENTS_FILE);
        write_recents(&file, &[]).unwrap();
        assert!(file.is_file());
        assert!(!file.with_extension("json.tmp").exists());
        fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------------ opening --

    #[test]
    fn resolves_a_project_folder_to_its_database() {
        let dir = temp_dir("resolve");
        let info = resolve_project(&dir.display().to_string(), false).unwrap();
        assert!(!info.created);
        assert!(!info.has_database);
        assert!(info.db_path.ends_with("redbeam.db"));
        assert_eq!(info.name, dir.file_name().unwrap().to_string_lossy());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_relative_path() {
        // This is the wart: `openDatabase()` defaulted to '.', so the database
        // landed wherever the binary was launched from.
        let err = resolve_project(".", true).unwrap_err();
        assert!(err.contains("absolute"), "{err}");
    }

    #[test]
    fn refuses_an_empty_path() {
        assert!(resolve_project("   ", true).is_err());
    }

    #[test]
    fn creates_a_folder_only_when_asked() {
        let dir = temp_dir("create");
        let target = dir.join("new project");

        let err = resolve_project(&target.display().to_string(), false).unwrap_err();
        assert!(err.contains("does not exist"), "{err}");
        assert!(!target.exists());

        let info = resolve_project(&target.display().to_string(), true).unwrap();
        assert!(info.created);
        assert!(target.is_dir());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_an_existing_database_as_a_reopen() {
        let dir = temp_dir("reopen");
        fs::write(dir.join("redbeam.db"), b"").unwrap();
        let info = resolve_project(&dir.display().to_string(), false).unwrap();
        assert!(info.has_database);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_file_as_a_project() {
        let dir = temp_dir("resolve-file");
        write_file(&dir, "a.pdf", b"a");
        assert!(resolve_project(&dir.join("a.pdf").display().to_string(), false).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    // --------------------------------------------------------- timestamps --

    #[test]
    fn formats_iso_utc() {
        assert_eq!(
            iso_utc(UNIX_EPOCH).as_deref(),
            Some("1970-01-01T00:00:00.000Z")
        );
        assert_eq!(
            iso_utc(UNIX_EPOCH + std::time::Duration::from_millis(1_776_000_000_123)).as_deref(),
            Some("2026-04-12T13:20:00.123Z")
        );
        // A leap day, because civil_from_days is the one piece of arithmetic
        // here that a hand-rolled version usually gets wrong.
        assert_eq!(
            iso_utc(UNIX_EPOCH + std::time::Duration::from_secs(1_709_164_800)).as_deref(),
            Some("2024-02-29T00:00:00.000Z")
        );
    }
}
