use std::time::Instant;

use serde_json::{Map, Value};

use super::global;

#[tauri::command]
pub fn diag_log(event: String, fields: Option<Map<String, Value>>) -> Result<(), String> {
    match global() {
        Some(diagnostics) => diagnostics.log_from_ui(&event, fields.unwrap_or_default()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn diag_heartbeat(batch_active: bool, visible: bool) {
    if let Some(diagnostics) = global() {
        diagnostics.heartbeat(Instant::now(), batch_active, visible);
    }
}

#[tauri::command]
pub fn diag_read(limit: Option<usize>) -> Vec<String> {
    global().map_or_else(Vec::new, |diagnostics| {
        diagnostics.tail(limit.unwrap_or(200).min(1000))
    })
}

#[tauri::command]
pub fn diag_clear() {
    if let Some(diagnostics) = global() {
        diagnostics.clear();
    }
}
