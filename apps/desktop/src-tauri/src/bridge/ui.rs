//! Round trips to the UI (plan 11.3 / 11.5).
//!
//! Most bridge methods answer from the store and never touch a window. Some
//! genuinely cannot: a screenshot needs a canvas, and a tool selection is
//! window state. Those go out as a request event and come back through the
//! `bridge_reply` command.
//!
//! # Why a round trip rather than reaching into the store
//!
//! The same rule as `open_project`: the UI owns UI state, and anything that
//! writes it from underneath produces a window and a database that disagree.
//! Routing through the frontend means a bridge-driven action takes exactly the
//! path a click takes, so it cannot drift from what a person would get.
//!
//! # Every wait is bounded
//!
//! A frontend that is wedged, mid-reload, or simply has no window open will
//! never reply. Each request carries a deadline and fails with a message
//! saying so, because a bridge call that hangs forever is worse than one that
//! fails: the caller cannot tell it apart from slow work.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// How long a UI request waits before giving up.
///
/// Generous enough for a full-page render on a slow machine, short enough that
/// a driving agent notices a wedged frontend rather than blocking a run.
const UI_TIMEOUT: Duration = Duration::from_secs(20);

type Pending = Mutex<HashMap<u64, Sender<Value>>>;

fn pending() -> &'static Pending {
    static P: OnceLock<Pending> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    N.fetch_add(1, Ordering::Relaxed)
}

/// Ask the frontend to do something and wait for its answer.
pub fn request(app: &AppHandle, action: &str, params: &Value) -> Result<Value, String> {
    let id = next_id();
    let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();

    // Registered BEFORE the emit: a frontend fast enough to reply before we
    // finish registering would otherwise find no channel and drop the answer.
    pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, tx);

    let emitted = app.emit(
        "redbeam://bridge/request",
        json!({ "id": id, "action": action, "params": params }),
    );
    if let Err(e) = emitted {
        forget(id);
        return Err(format!("could not reach a window: {e}"));
    }

    let answer = rx.recv_timeout(UI_TIMEOUT);
    forget(id);

    match answer {
        Ok(v) => {
            // The frontend reports its own failures in-band; a transport that
            // worked does not mean the action did.
            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                return Err(err.to_string());
            }
            Ok(v)
        }
        Err(_) => Err(format!(
            "no window answered `{action}` within {}s — is a project open?",
            UI_TIMEOUT.as_secs()
        )),
    }
}

fn forget(id: u64) {
    pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
}

/// The frontend's answer to a `redbeam://bridge/request`.
///
/// A reply for an id nobody is waiting on is dropped rather than treated as an
/// error: the waiter may have timed out, and a late answer is not a fault
/// worth reporting to whoever happens to call next.
#[tauri::command]
pub async fn bridge_reply(id: u64, result: Value) -> Result<(), String> {
    let tx = pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(result);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_do_not_repeat() {
        // A repeated id would deliver one window's answer to another's waiter.
        let a = next_id();
        let b = next_id();
        assert_ne!(a, b);
    }

    #[test]
    fn a_reply_for_an_unknown_id_is_dropped_rather_than_panicking() {
        // The waiter may already have timed out. A late answer is not a fault.
        let map = pending();
        assert!(map
            .lock()
            .unwrap()
            .remove(&999_999)
            .is_none());
    }

    #[test]
    fn a_waiter_receives_its_own_answer() {
        let id = next_id();
        let (tx, rx) = channel();
        pending().lock().unwrap().insert(id, tx);
        let sender = pending().lock().unwrap().remove(&id).unwrap();
        sender.send(json!({ "ok": true })).unwrap();
        assert_eq!(rx.recv().unwrap()["ok"], json!(true));
    }
}
