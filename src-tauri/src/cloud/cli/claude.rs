use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::runner::RunOutput;
use super::{Adapter, Answer, Invocation, Prompt};
use crate::cloud::ErrorClass;

pub struct Claude;

pub const SYSTEM_PROMPT: &str = "Du bist ein Sprachmodell in der Korrektur-App Rotstift und hast keine Werkzeuge. Beginnt die Nachricht mit einem Block zwischen <anweisungen> und </anweisungen>, gilt er wie ein Systemprompt. Befolge die Anweisungen genau und antworte nur mit dem verlangten Ergebnis.";

const ENV: [(&str, &str); 2] = [
    ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ("DISABLE_TELEMETRY", "1"),
];

const LOGIN_HINTS: [&str; 5] = [
    "not logged in",
    "/login",
    "invalid api key",
    "oauth token",
    "authentication",
];

const QUOTA_HINTS: [&str; 5] = [
    "usage limit",
    "limit reached",
    "hit your limit",
    "out of extra usage",
    "credit balance",
];

const MODEL_HINTS: [&str; 3] = ["selected model", "model not found", "not_found_error"];

#[cfg(windows)]
const BINARIES: [&str; 1] = ["claude.exe"];
#[cfg(not(windows))]
const BINARIES: [&str; 1] = ["claude"];

pub fn arguments(prompt: &Prompt) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        prompt.model.as_str(),
        "--system-prompt",
        SYSTEM_PROMPT,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--safe-mode",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--max-turns",
        if prompt.schema.is_some() { "2" } else { "1" },
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    if let Some(schema) = &prompt.schema {
        args.push("--json-schema".into());
        args.push(schema.to_string().into());
    }
    args
}

pub fn message(prompt: &Prompt) -> Value {
    let mut content: Vec<Value> = prompt
        .images()
        .map(|(media_type, data)| {
            json!({
                "type": "image",
                "source": { "type": "base64", "media_type": media_type, "data": data },
            })
        })
        .collect();
    content.push(json!({ "type": "text", "text": prompt.text() }));
    json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
    })
}

fn result_line(stdout: &[u8]) -> Option<Value> {
    String::from_utf8_lossy(stdout)
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .find(|value| value.get("type").and_then(Value::as_str) == Some("result"))
}

fn mentions(text: &str, hints: &[&str]) -> bool {
    hints.iter().any(|hint| text.contains(hint))
}

fn failure(result: &Value) -> ErrorClass {
    let text = result
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let status = result.get("api_error_status").and_then(Value::as_u64);
    if mentions(&text, &QUOTA_HINTS) {
        return ErrorClass::QuotaExhausted;
    }
    if matches!(status, Some(401 | 403)) || mentions(&text, &LOGIN_HINTS) {
        return ErrorClass::NotLoggedIn;
    }
    if status == Some(404) || mentions(&text, &MODEL_HINTS) {
        return ErrorClass::NotFound;
    }
    match status {
        Some(429) => ErrorClass::RateLimited,
        Some(413) => ErrorClass::TooLarge,
        Some(408) => ErrorClass::Timeout,
        Some(400..=499) => ErrorClass::BadRequest,
        Some(500..=599) => ErrorClass::Server,
        _ if text.contains("rate limit") => ErrorClass::RateLimited,
        _ => ErrorClass::CliFailed,
    }
}

impl Adapter for Claude {
    fn binary_names(&self) -> &'static [&'static str] {
        &BINARIES
    }

    fn search_dirs(&self, home: &Path) -> Vec<PathBuf> {
        vec![home.join(".claude").join("local")]
    }

    fn version(&self, stdout: &str) -> Option<String> {
        let line = stdout.lines().next()?.trim();
        let (version, rest) = line.split_once(' ')?;
        let numeric = version.split('.').count() == 3
            && version
                .split('.')
                .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
        (numeric && rest.trim() == "(Claude Code)").then(|| version.to_owned())
    }

    fn invocation(&self, prompt: &Prompt) -> Result<Invocation, ErrorClass> {
        let mut stdin = message(prompt).to_string().into_bytes();
        stdin.push(b'\n');
        Ok(Invocation {
            args: arguments(prompt),
            stdin,
            files: Vec::new(),
            env: ENV
                .iter()
                .map(|(key, value)| (OsString::from(key), OsString::from(value)))
                .collect(),
        })
    }

    fn answer(&self, output: &RunOutput) -> Result<Answer, ErrorClass> {
        let Some(result) = result_line(&output.stdout) else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            return Err(if stderr.contains("unknown option") {
                ErrorClass::CliOutdated
            } else if output.code == Some(0) {
                ErrorClass::InvalidResponse
            } else {
                ErrorClass::CliFailed
            });
        };
        if result.get("is_error").and_then(Value::as_bool) != Some(false)
            || result.get("subtype").and_then(Value::as_str) != Some("success")
        {
            return Err(failure(&result));
        }
        let text = match result.get("structured_output") {
            Some(Value::Null) | None => result
                .get("result")
                .and_then(Value::as_str)
                .ok_or(ErrorClass::InvalidResponse)?
                .to_owned(),
            Some(structured) => structured.to_string(),
        };
        let tokens = |field: &str| {
            result
                .pointer(&format!("/usage/{field}"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        Ok(Answer {
            text,
            truncated: result.get("stop_reason").and_then(Value::as_str) == Some("max_tokens"),
            input_tokens: tokens("input_tokens"),
            output_tokens: tokens("output_tokens"),
        })
    }
}
