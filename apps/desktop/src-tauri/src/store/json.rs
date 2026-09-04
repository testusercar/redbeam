//! `serde_json::Value` <-> SQLite value conversion.
//!
//! The TypeScript client sends parameters as JSON and reads rows back as JSON,
//! so this is the only place where types are allowed to change shape. The rule
//! it exists to enforce: **numbers stay numbers**. `calibrations.feet_per_pdf_point`
//! is a `REAL` and every square foot in the project is derived from it; if it
//! came back as a string the app would quietly produce garbage rather than
//! fail. Same for `quantity_results.quantity`.

use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{Map, Number, Value as Json};

/// Bind one JSON parameter to a SQLite value.
///
/// * `null` -> `NULL`
/// * `true` / `false` -> `1` / `0` (SQLite has no boolean type; this is what
///   the schema's `INTEGER NOT NULL DEFAULT 0` flag columns expect)
/// * integer -> `INTEGER`, fractional -> `REAL`
/// * string -> `TEXT`
///
/// Arrays and objects are rejected rather than silently stringified. Every
/// JSON-valued column in the ported schema is a `*_json TEXT` column that the
/// caller is expected to `JSON.stringify` itself — accepting a bare object here
/// would let two different serializations of the same value into the database.
pub fn json_to_sql(value: &Json) -> Result<SqlValue, String> {
    Ok(match value {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if n.is_f64() {
                // unwrap: is_f64() just said so
                SqlValue::Real(n.as_f64().expect("is_f64"))
            } else {
                // u64 above i64::MAX. SQLite INTEGER is signed 64-bit, so this
                // cannot be stored without loss. Fail loudly.
                return Err(format!(
                    "integer {n} is out of range for a SQLite INTEGER (signed 64-bit)"
                ));
            }
        }
        Json::String(s) => SqlValue::Text(s.clone()),
        Json::Array(_) => {
            return Err(
                "cannot bind a JSON array as a SQLite parameter — stringify it first".into(),
            )
        }
        Json::Object(_) => {
            return Err(
                "cannot bind a JSON object as a SQLite parameter — stringify it first".into(),
            )
        }
    })
}

/// Bind a whole parameter list, reporting which position failed.
pub fn json_params_to_sql(params: &[Json]) -> Result<Vec<SqlValue>, String> {
    params
        .iter()
        .enumerate()
        .map(|(i, p)| json_to_sql(p).map_err(|e| format!("parameter {}: {e}", i + 1)))
        .collect()
}

/// Convert one column value back to JSON.
///
/// `REAL` goes through [`Number::from_f64`], which stores the `f64` bit pattern
/// as-is; `serde_json` then emits the shortest decimal string that reparses to
/// the same `f64`, so the value survives the trip to JavaScript exactly.
///
/// Non-finite reals (`NaN`, `±Infinity`) have no JSON spelling and become
/// `null`. Nothing in the ported schema can produce one — the only `REAL`
/// columns are a scale guarded by `CHECK(feet_per_pdf_point > 0)`, page
/// dimensions, quantities, and job progress.
///
/// `BLOB` becomes an array of byte values, which is what a `Uint8Array`
/// deserializes to. The ported schema has no `BLOB` columns; this is here so
/// an ad-hoc query cannot fail on one.
pub fn sql_to_json(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|byte| Json::from(*byte)).collect()),
    }
}

/// Convert one row to a JSON object keyed by column name.
///
/// Duplicate column names (`SELECT a.id, b.id ...`) collapse to the last one,
/// matching what `sql.js`'s `getAsObject` did — alias them if you need both.
pub fn row_to_json(row: &rusqlite::Row<'_>, columns: &[String]) -> rusqlite::Result<Map<String, Json>> {
    let mut object = Map::with_capacity(columns.len());
    for (index, name) in columns.iter().enumerate() {
        object.insert(name.clone(), sql_to_json(row.get_ref(index)?));
    }
    Ok(object)
}
