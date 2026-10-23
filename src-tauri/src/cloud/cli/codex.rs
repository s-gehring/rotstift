use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::claude::SYSTEM_PROMPT;
use super::runner::RunOutput;
use super::{Adapter, Answer, Invocation, ParentEnv, Prompt};
use crate::cloud::ErrorClass;

pub struct Codex;

pub const MIN_VERSION: (u64, u64, u64) = (0, 140, 0);

pub const SCHEMA_FILE: &str = "schema.json";

const OVERRIDES: [&str; 12] = [
    "features.shell_tool=false",
    "web_search=\"disabled\"",
    "features.apps=false",
    "features.plugins=false",
    "features.hooks=false",
    "features.memories=false",
    "features.multi_agent=false",
    "features.view_image=false",
    "features.sleep_tool=false",
    "features.image_generation=false",
    "mcp_servers={}",
    "history.persistence=\"none\"",
];

const PLAIN_ITEMS: [&str; 4] = ["agent_message", "reasoning", "error", "todo_list"];

const GLOBAL_INSTRUCTIONS: [&str; 2] = ["AGENTS.override.md", "AGENTS.md"];

pub const GLOBAL_INSTRUCTIONS_NOTE: &str = "globalInstructions";

const QUOTA_HINTS: [&str; 4] = ["usage limit", "quota", "upgrade to", "credits"];

const LOGIN_HINTS: [&str; 6] = [
    "not logged in",
    "sign in",
    "unauthorized",
    "refresh token",
    "invalid api key",
    "missing bearer",
];

const MODEL_HINTS: [&str; 4] = [
    "model_not_found",
    "model not found",
    "does not exist",
    "model is not supported",
];

const RATE_HINTS: [&str; 4] = [
    "rate limit",
    "high demand",
    "at capacity",
    "too many requests",
];

const LARGE_HINTS: [&str; 2] = ["context window", "payload too large"];

const NETWORK_HINTS: [&str; 4] = ["stream disconnected", "timed out", "connection", "network"];

const OUTDATED_HINTS: [&str; 2] = ["unknown configuration field", "unexpected argument"];

#[cfg(windows)]
const BINARIES: [&str; 1] = ["codex.exe"];
#[cfg(not(windows))]
const BINARIES: [&str; 1] = ["codex"];

fn triple(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.');
    let mut next = || -> Option<u64> {
        let part = parts.next()?;
        (!part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    };
    let parsed = (next()?, next()?, next()?);
    parts.next().is_none().then_some(parsed)
}

fn image_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0;
    let mut padding = 0;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                padding += 1;
                continue;
            }
            b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        };
        if padding > 0 {
            return None;
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    (padding <= 2).then_some(out)
}

pub fn images(prompt: &Prompt) -> Result<Vec<(String, Vec<u8>)>, ErrorClass> {
    prompt
        .images()
        .enumerate()
        .map(|(index, (media_type, data))| {
            let extension = image_extension(media_type).ok_or(ErrorClass::InvalidRequest)?;
            let bytes = decode_base64(data).ok_or(ErrorClass::InvalidRequest)?;
            Ok((format!("page-{}.{extension}", index + 1), bytes))
        })
        .collect()
}

pub fn strict_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                if matches!(
                    key.as_str(),
                    "maxLength" | "minLength" | "maxItems" | "minItems"
                ) {
                    continue;
                }
                let value = match key.as_str() {
                    "properties" => match value {
                        Value::Object(props) => Value::Object(
                            props
                                .iter()
                                .map(|(name, prop)| (name.clone(), strict_schema(prop)))
                                .collect(),
                        ),
                        other => other.clone(),
                    },
                    "enum" | "required" | "const" => value.clone(),
                    _ => strict_schema(value),
                };
                out.insert(key.clone(), value);
            }
            if let Some(Value::Object(props)) = out.get("properties") {
                let names: Vec<Value> = props.keys().cloned().map(Value::String).collect();
                out.insert("type".into(), Value::String("object".into()));
                out.insert("additionalProperties".into(), Value::Bool(false));
                out.insert("required".into(), Value::Array(names));
            }
            if !out.contains_key("type")
                && let Some(Value::Array(values)) = out.get("enum")
                && values.iter().all(Value::is_string)
            {
                out.insert("type".into(), Value::String("string".into()));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(strict_schema).collect()),
        other => other.clone(),
    }
}

pub fn arguments(prompt: &Prompt, images: &[(String, Vec<u8>)]) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "--sandbox",
        "read-only",
        "--json",
        "--model",
        prompt.model.as_str(),
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    for setting in OVERRIDES {
        args.push("-c".into());
        args.push(setting.into());
    }
    args.push("-c".into());
    args.push("project_doc_max_bytes=0".into());
    if prompt.schema.is_some() {
        args.push("--output-schema".into());
        args.push(SCHEMA_FILE.into());
    }
    if !images.is_empty() {
        let names: Vec<&str> = images.iter().map(|(name, _)| name.as_str()).collect();
        args.push(format!("--image={}", names.join(",")).into());
    }
    args.push("-".into());
    args
}

fn mentions(text: &str, hints: &[&str]) -> bool {
    hints.iter().any(|hint| text.contains(hint))
}

fn status(text: &str) -> Option<u16> {
    let (_, rest) = text.split_once("unexpected status ")?;
    rest.split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

fn classify(text: &str) -> ErrorClass {
    let text = text.to_lowercase();
    if mentions(&text, &OUTDATED_HINTS) {
        return ErrorClass::CliOutdated;
    }
    if mentions(&text, &QUOTA_HINTS) {
        return ErrorClass::QuotaExhausted;
    }
    if mentions(&text, &LOGIN_HINTS) {
        return ErrorClass::NotLoggedIn;
    }
    if mentions(&text, &MODEL_HINTS) {
        return ErrorClass::NotFound;
    }
    if mentions(&text, &RATE_HINTS) {
        return ErrorClass::RateLimited;
    }
    if mentions(&text, &LARGE_HINTS) {
        return ErrorClass::TooLarge;
    }
    if mentions(&text, &NETWORK_HINTS) {
        return ErrorClass::Network;
    }
    match status(&text) {
        Some(401 | 403) => ErrorClass::NotLoggedIn,
        Some(404) => ErrorClass::NotFound,
        Some(408) => ErrorClass::Timeout,
        Some(413) => ErrorClass::TooLarge,
        Some(429) => ErrorClass::RateLimited,
        Some(400..=499) => ErrorClass::BadRequest,
        Some(500..=599) => ErrorClass::Server,
        _ => ErrorClass::CliFailed,
    }
}

#[derive(Default)]
struct Events {
    message: Option<String>,
    completed: bool,
    failed: bool,
    tools: bool,
    texts: Vec<String>,
    input_tokens: u64,
    output_tokens: u64,
    seen: bool,
}

fn events(stdout: &[u8]) -> Events {
    let mut events = Events::default();
    for line in String::from_utf8_lossy(stdout).lines() {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        events.seen = true;
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "item.started" | "item.updated" | "item.completed" => {
                let item_kind = event
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !PLAIN_ITEMS.contains(&item_kind) {
                    events.tools = true;
                } else if item_kind == "agent_message" && kind == "item.completed" {
                    events.message = event
                        .pointer("/item/text")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                }
            }
            "turn.completed" => {
                events.completed = true;
                let tokens = |field: &str| {
                    event
                        .pointer(&format!("/usage/{field}"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                };
                events.input_tokens = tokens("input_tokens");
                events.output_tokens = tokens("output_tokens");
            }
            "turn.failed" => {
                events.failed = true;
                events.texts.extend(
                    event
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                );
            }
            "error" => events.texts.extend(
                event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            ),
            _ => {}
        }
    }
    events
}

impl Adapter for Codex {
    fn binary_names(&self) -> &'static [&'static str] {
        &BINARIES
    }

    fn search_dirs(&self, _home: &Path) -> Vec<PathBuf> {
        Vec::new()
    }

    fn version(&self, stdout: &str) -> Option<String> {
        let line = stdout.lines().next()?.trim();
        let version = line.strip_prefix("codex-cli ")?.trim();
        triple(version).map(|_| version.to_owned())
    }

    fn outdated(&self, version: &str) -> bool {
        triple(version).is_some_and(|found| found < MIN_VERSION)
    }

    fn notes(&self, parent: ParentEnv) -> Vec<String> {
        let home = parent("CODEX_HOME").map(PathBuf::from).or_else(|| {
            parent("HOME")
                .or_else(|| parent("USERPROFILE"))
                .map(|home| PathBuf::from(home).join(".codex"))
        });
        let present = home.is_some_and(|home| {
            GLOBAL_INSTRUCTIONS.iter().any(|name| {
                std::fs::metadata(home.join(name))
                    .is_ok_and(|meta| meta.is_file() && meta.len() > 0)
            })
        });
        present
            .then(|| GLOBAL_INSTRUCTIONS_NOTE.to_owned())
            .into_iter()
            .collect()
    }

    fn invocation(&self, prompt: &Prompt) -> Result<Invocation, ErrorClass> {
        let images = images(prompt)?;
        let args = arguments(prompt, &images);
        let mut files = images;
        if let Some(schema) = &prompt.schema {
            files.push((
                SCHEMA_FILE.to_owned(),
                strict_schema(schema).to_string().into_bytes(),
            ));
        }
        Ok(Invocation {
            args,
            stdin: format!("{SYSTEM_PROMPT}\n\n{}\n", prompt.text()).into_bytes(),
            files,
            env: Vec::new(),
        })
    }

    fn answer(&self, output: &RunOutput) -> Result<Answer, ErrorClass> {
        let events = events(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
        if events.tools {
            return Err(ErrorClass::CliFailed);
        }
        if let Some(text) = events
            .message
            .filter(|_| events.completed && !events.failed && output.code == Some(0))
        {
            return Ok(Answer {
                text,
                truncated: false,
                input_tokens: events.input_tokens,
                output_tokens: events.output_tokens,
            });
        }
        if output.code == Some(0) && !events.failed {
            return Err(ErrorClass::InvalidResponse);
        }
        let mut text = events.texts.join("\n");
        text.push('\n');
        text.push_str(&stderr);
        Err(classify(&text))
    }
}
