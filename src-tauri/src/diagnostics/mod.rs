pub mod commands;
mod event;
mod liveness;
mod store;

use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager, Runtime};

use crate::llm::LlmRuntime;
use liveness::{Liveness, Thresholds, Verdict};
use store::{MAX_FILE_BYTES, Store};

const MONITOR_INTERVAL: Duration = Duration::from_secs(5);
const STDERR_LINES: usize = 15;
const STDERR_LINE_CHARS: usize = 240;

pub struct Diagnostics {
    store: Store,
    liveness: Mutex<Liveness>,
}

static GLOBAL: OnceLock<Diagnostics> = OnceLock::new();

impl Diagnostics {
    pub fn new(store: Store, thresholds: Thresholds) -> Self {
        Self {
            store,
            liveness: Mutex::new(Liveness::new(thresholds)),
        }
    }

    fn liveness(&self) -> MutexGuard<'_, Liveness> {
        self.liveness.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn write(&self, source: &str, name: &str, fields: Map<String, Value>) {
        self.store.append(&event::line(source, name, fields));
    }

    pub fn log_from_ui(&self, name: &str, fields: Map<String, Value>) -> Result<(), String> {
        let clean = event::sanitize_ui(name, fields)?;
        self.write("ui", name, clean);
        Ok(())
    }

    pub fn heartbeat(&self, now: Instant, batch_active: bool, visible: bool) {
        let resumed = self.liveness().heartbeat(now, batch_active, visible);
        if let Some(resumed) = resumed {
            self.write(
                "rust",
                "heartbeat_resumed",
                fields(json!({
                    "gapMs": resumed.gap.as_millis() as u64,
                    "visible": resumed.visible,
                })),
            );
        }
    }

    pub fn check(&self, now: Instant) -> Vec<Verdict> {
        let verdicts = self.liveness().check(now);
        for verdict in &verdicts {
            match verdict {
                Verdict::GapDetected {
                    gap,
                    batch_active,
                    in_flight,
                    visible,
                } => self.write(
                    "rust",
                    "heartbeat_gap",
                    fields(json!({
                        "gapMs": gap.as_millis() as u64,
                        "batchActive": batch_active,
                        "inFlight": in_flight,
                        "visible": visible,
                    })),
                ),
                Verdict::CancelInFlight { gap, ids } => self.write(
                    "rust",
                    "liveness_cancel",
                    fields(json!({
                        "gapMs": gap.as_millis() as u64,
                        "requests": ids.len(),
                    })),
                ),
            }
        }
        verdicts
    }

    pub fn tail(&self, limit: usize) -> Vec<String> {
        self.store.tail(limit)
    }

    pub fn clear(&self) {
        self.store.clear();
    }
}

fn fields(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

pub fn global() -> Option<&'static Diagnostics> {
    GLOBAL.get()
}

pub fn record(name: &str, details: Value) {
    if let Some(diagnostics) = global() {
        diagnostics.write("rust", name, fields(details));
    }
}

pub fn stderr_tail(log: &str, redact: &[String]) -> Vec<String> {
    let lines: Vec<&str> = log.lines().collect();
    lines[lines.len().saturating_sub(STDERR_LINES)..]
        .iter()
        .map(|line| {
            let mut line = (*line).to_owned();
            for secret in redact.iter().filter(|secret| !secret.is_empty()) {
                line = line.replace(secret.as_str(), "<path>");
            }
            event::truncate(&line, STDERR_LINE_CHARS)
        })
        .collect()
}

pub struct ChatGuard {
    id: Option<String>,
    started: Instant,
    finished: bool,
}

impl ChatGuard {
    pub fn begin(id: Option<&str>) -> Self {
        if let (Some(diagnostics), Some(id)) = (global(), id) {
            diagnostics.liveness().chat_began(Instant::now(), id);
        }
        Self {
            id: id.map(str::to_owned),
            started: Instant::now(),
            finished: false,
        }
    }

    pub fn finish(mut self, outcome: &str) {
        self.end(outcome);
    }

    fn end(&mut self, outcome: &str) {
        if self.finished {
            return;
        }
        self.finished = true;
        if let (Some(diagnostics), Some(id)) = (global(), &self.id) {
            diagnostics.liveness().chat_ended(id);
        }
        record(
            "chat_end",
            json!({
                "outcome": outcome,
                "durationMs": self.started.elapsed().as_millis() as u64,
            }),
        );
    }
}

impl Drop for ChatGuard {
    fn drop(&mut self) {
        self.end("dropped");
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let diagnostics = Diagnostics::new(Store::new(&dir, MAX_FILE_BYTES), Thresholds::default());
    diagnostics.write(
        "rust",
        "app_start",
        fields(json!({
            "appVersion": env!("CARGO_PKG_VERSION"),
            "runtimeVersion": env!("ROTSTIFT_RUNTIME_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        })),
    );
    if GLOBAL.set(diagnostics).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(MONITOR_INTERVAL);
        loop {
            ticker.tick().await;
            let Some(diagnostics) = global() else {
                continue;
            };
            for verdict in diagnostics.check(Instant::now()) {
                if let Verdict::CancelInFlight { ids, .. } = verdict {
                    let runtime = app.state::<LlmRuntime>();
                    for id in ids {
                        runtime.cancel(&id);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rotstift-diag-mod-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn diagnostics(name: &str) -> (Diagnostics, PathBuf) {
        let dir = temp_dir(name);
        (
            Diagnostics::new(Store::new(&dir, MAX_FILE_BYTES), Thresholds::default()),
            dir,
        )
    }

    #[test]
    fn a_silent_webview_during_a_batch_leaves_a_diagnostic_entry() {
        let (diagnostics, dir) = diagnostics("gap");
        let base = Instant::now();
        diagnostics.heartbeat(base, true, true);
        assert!(diagnostics.check(base + Duration::from_secs(10)).is_empty());
        let verdicts = diagnostics.check(base + Duration::from_secs(35));
        assert_eq!(verdicts.len(), 1);
        diagnostics.heartbeat(base + Duration::from_secs(80), true, true);
        let lines = diagnostics.tail(10);
        assert_eq!(lines.len(), 2);
        let gap: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(gap["event"], "heartbeat_gap");
        assert_eq!(gap["batchActive"], true);
        let resumed: Value = serde_json::from_str(&lines[1]).unwrap();
        assert_eq!(resumed["event"], "heartbeat_resumed");
        assert_eq!(resumed["gapMs"], 80_000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn transcript_text_sent_from_the_ui_never_reaches_the_log() {
        let (diagnostics, dir) = diagnostics("privacy");
        let transcript = "Gestern ging ich mit meinem Hund im Park spazieren.";
        let attempts = [
            (
                "page_done",
                json!({"pageId": transcript, "text": transcript}),
            ),
            (
                "page_done",
                json!({"phase": transcript, "reason": transcript}),
            ),
            (
                "page_failed",
                json!({"message": transcript, "lines": [transcript]}),
            ),
            (
                "transcript",
                json!({"pageId": "3f2b8c1e-9a4d-4c7e-8b1a-0d2e5f6a7b8c"}),
            ),
            (transcript, json!({})),
        ];
        for (name, payload) in attempts {
            let _ = diagnostics.log_from_ui(name, fields(payload));
        }
        diagnostics
            .log_from_ui(
                "page_done",
                fields(json!({"pageId": "3f2b8c1e-9a4d-4c7e-8b1a-0d2e5f6a7b8c", "totalMs": 1200})),
            )
            .unwrap();
        let log = std::fs::read_to_string(dir.join("diagnostics.jsonl")).unwrap();
        for word in ["Gestern", "Hund", "Park", "spazieren", "transcript"] {
            assert!(!log.contains(word), "log leaked {word}: {log}");
        }
        assert!(log.contains("3f2b8c1e-9a4d-4c7e-8b1a-0d2e5f6a7b8c"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stderr_tail_keeps_the_last_lines_shortened_and_without_paths() {
        let log = (0..30)
            .map(|index| format!("line {index} /Users/anna/models/m.gguf {}", "x".repeat(400)))
            .collect::<Vec<_>>()
            .join("\n");
        let tail = stderr_tail(&log, &["/Users/anna".to_owned()]);
        assert_eq!(tail.len(), STDERR_LINES);
        assert!(tail[0].starts_with("line 15 <path>/models"));
        assert!(
            tail.iter()
                .all(|line| line.chars().count() <= STDERR_LINE_CHARS + 1)
        );
        assert!(!tail.join("").contains("anna"));
    }
}
