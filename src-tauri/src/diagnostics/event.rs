use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

const MAX_FIELDS: usize = 24;
const MAX_KEY_LEN: usize = 32;
const MAX_STRING_LEN: usize = 300;
const RESERVED: [&str; 3] = ["t", "src", "event"];

const UI_EVENTS: &[&str] = &[
    "batch_start",
    "batch_end",
    "page_start",
    "page_phase",
    "page_done",
    "page_stalled",
    "page_retry",
    "page_failed",
    "unexpected_cancel",
    "sidecar_recover",
];

const UI_WORDS: &[&str] = &[
    "rendering",
    "queued",
    "sidecar_start",
    "encoding",
    "request",
    "parsing",
    "stalled",
    "unexpected_cancel",
    "failed",
    "crashed",
    "cancelled",
    "ok",
    "error",
];

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

pub fn iso_utc(ms: u64) -> String {
    let seconds = ms / 1000;
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        ms % 1000
    )
}

pub fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

pub fn line(source: &str, event: &str, fields: Map<String, Value>) -> String {
    let mut entry = Map::new();
    entry.insert("t".into(), Value::String(iso_utc(now_ms())));
    entry.insert("src".into(), Value::String(source.into()));
    entry.insert("event".into(), Value::String(event.into()));
    for (key, value) in fields.into_iter().take(MAX_FIELDS) {
        if !RESERVED.contains(&key.as_str()) {
            entry.insert(key, limit(value));
        }
    }
    Value::Object(entry).to_string()
}

fn limit(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(truncate(&text, MAX_STRING_LEN)),
        Value::Array(items) => Value::Array(items.into_iter().take(40).map(limit).collect()),
        other => other,
    }
}

fn is_key(key: &str) -> bool {
    let mut chars = key.chars();
    key.len() <= MAX_KEY_LEN
        && chars
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_identifier(text: &str) -> bool {
    (8..=40).contains(&text.len()) && text.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn sanitize_ui(event: &str, fields: Map<String, Value>) -> Result<Map<String, Value>, String> {
    if !UI_EVENTS.contains(&event) {
        return Err("unknown diagnostic event".into());
    }
    let mut clean = Map::new();
    for (key, value) in fields.into_iter().take(MAX_FIELDS) {
        if !is_key(&key) || RESERVED.contains(&key.as_str()) {
            continue;
        }
        let value = match value {
            Value::Bool(flag) => Value::Bool(flag),
            Value::Number(number) => Value::Number(number),
            Value::String(text) if key.ends_with("Id") && is_identifier(&text) => {
                Value::String(text)
            }
            Value::String(text) if UI_WORDS.contains(&text.as_str()) => Value::String(text),
            Value::String(_) => Value::String("redacted".into()),
            _ => continue,
        };
        clean.insert(key, value);
    }
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(1_709_164_800_123), "2024-02-29T00:00:00.123Z");
        assert_eq!(iso_utc(1_792_500_000_000), "2026-10-20T12:40:00.000Z");
    }

    #[test]
    fn keeps_numbers_flags_ids_and_known_words() {
        let clean = sanitize_ui(
            "page_phase",
            fields(json!({
                "pageId": "3f2b8c1e-9a4d-4c7e-8b1a-0d2e5f6a7b8c",
                "attempt": 2,
                "elapsedMs": 1234.5,
                "ok": true,
                "phase": "request",
            })),
        )
        .unwrap();
        assert_eq!(clean["pageId"], "3f2b8c1e-9a4d-4c7e-8b1a-0d2e5f6a7b8c");
        assert_eq!(clean["attempt"], 2);
        assert_eq!(clean["elapsedMs"], 1234.5);
        assert_eq!(clean["ok"], true);
        assert_eq!(clean["phase"], "request");
    }

    #[test]
    fn free_text_never_survives() {
        let clean = sanitize_ui(
            "page_done",
            fields(json!({
                "phase": "Der Hund bellt laut.",
                "reason": "Hund",
                "pageId": "Max Mustermann Aufsatz.png",
                "text": ["Zeile eins", "Zeile zwei"],
                "nested": {"a": "b"},
                "note": null,
            })),
        )
        .unwrap();
        assert_eq!(clean["phase"], "redacted");
        assert_eq!(clean["reason"], "redacted");
        assert_eq!(clean["pageId"], "redacted");
        assert!(!clean.contains_key("text"));
        assert!(!clean.contains_key("nested"));
        assert!(!clean.contains_key("note"));
        let serialized = Value::Object(clean).to_string();
        for forbidden in ["Hund", "Mustermann", "Zeile", "bellt"] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn rejects_unknown_events_and_reserved_keys() {
        assert!(sanitize_ui("transcript", Map::new()).is_err());
        let clean = sanitize_ui(
            "batch_start",
            fields(json!({"t": 1, "src": "x", "pages": 3})),
        )
        .unwrap();
        assert_eq!(clean.len(), 1);
        let rendered = line(
            "ui",
            "batch_start",
            fields(json!({"event": "evil", "pages": 3})),
        );
        let parsed: Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(parsed["event"], "batch_start");
        assert_eq!(parsed["src"], "ui");
    }
}
