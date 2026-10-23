mod claude;
mod codex;
pub mod locate;
pub mod runner;

#[cfg(test)]
mod codex_tests;
#[cfg(test)]
mod smoke;
#[cfg(test)]
mod tests;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use super::ErrorClass;
use runner::{Limits, Run, RunError, RunOutput};

pub const CHAT_LIMITS: Limits = Limits {
    timeout: Duration::from_secs(300),
    max_stdout: 4 * 1024 * 1024,
    max_stderr: 64 * 1024,
};

const VERSION_LIMITS: Limits = Limits {
    timeout: Duration::from_secs(15),
    max_stdout: 4 * 1024,
    max_stderr: 4 * 1024,
};

const MAX_MODEL_NAME: usize = 100;

const PASSED_ENV: [&str; 30] = [
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "TEMP",
    "TMP",
    "PATHEXT",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Part {
    Text(String),
    Image { media_type: String, data: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speaker {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    pub speaker: Speaker,
    pub parts: Vec<Part>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prompt {
    pub model: String,
    pub instructions: Option<String>,
    pub turns: Vec<Turn>,
    pub schema: Option<Value>,
}

pub struct Invocation {
    pub args: Vec<OsString>,
    pub stdin: Vec<u8>,
    pub files: Vec<(String, Vec<u8>)>,
    pub env: Vec<(OsString, OsString)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub text: String,
    pub truncated: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

pub trait Adapter: Sync {
    fn binary_names(&self) -> &'static [&'static str];
    fn search_dirs(&self, home: &Path) -> Vec<PathBuf>;
    fn version(&self, stdout: &str) -> Option<String>;
    fn outdated(&self, _version: &str) -> bool {
        false
    }
    fn invocation(&self, prompt: &Prompt) -> Result<Invocation, ErrorClass>;
    fn answer(&self, output: &RunOutput) -> Result<Answer, ErrorClass>;
}

pub fn adapter(id: &str) -> Option<&'static dyn Adapter> {
    match id {
        "claude" => Some(&claude::Claude),
        "codex" => Some(&codex::Codex),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub path: String,
    pub version: String,
}

pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= MAX_MODEL_NAME
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
}

fn image_part(url: &str) -> Result<Part, ErrorClass> {
    let (media_type, data) = url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or(ErrorClass::InvalidRequest)?;
    Ok(Part::Image {
        media_type: media_type.to_owned(),
        data: data.to_owned(),
    })
}

fn parts(content: &Value) -> Result<Vec<Part>, ErrorClass> {
    match content {
        Value::String(text) => Ok(vec![Part::Text(text.clone())]),
        Value::Array(items) => items
            .iter()
            .map(|item| match item.get("type").and_then(Value::as_str) {
                Some("text") => item
                    .get("text")
                    .and_then(Value::as_str)
                    .map(|text| Part::Text(text.to_owned()))
                    .ok_or(ErrorClass::InvalidRequest),
                Some("image_url") => image_part(
                    item.pointer("/image_url/url")
                        .and_then(Value::as_str)
                        .ok_or(ErrorClass::InvalidRequest)?,
                ),
                _ => Err(ErrorClass::InvalidRequest),
            })
            .collect(),
        _ => Err(ErrorClass::InvalidRequest),
    }
}

impl Prompt {
    pub fn from_body(body: &Value, model: &str) -> Result<Self, ErrorClass> {
        let mut instructions = Vec::new();
        let mut turns = Vec::new();
        for message in body
            .get("messages")
            .and_then(Value::as_array)
            .ok_or(ErrorClass::InvalidRequest)?
        {
            let content = parts(message.get("content").ok_or(ErrorClass::InvalidRequest)?)?;
            match message.get("role").and_then(Value::as_str) {
                Some("system") => instructions.extend(content.into_iter().map(|part| match part {
                    Part::Text(text) => Ok(text),
                    Part::Image { .. } => Err(ErrorClass::InvalidRequest),
                })),
                Some("user") => turns.push(Turn {
                    speaker: Speaker::User,
                    parts: content,
                }),
                Some("assistant") => turns.push(Turn {
                    speaker: Speaker::Assistant,
                    parts: content,
                }),
                _ => return Err(ErrorClass::InvalidRequest),
            }
        }
        let instructions = instructions.into_iter().collect::<Result<Vec<_>, _>>()?;
        if turns.last().map(|turn| turn.speaker) != Some(Speaker::User) {
            return Err(ErrorClass::InvalidRequest);
        }
        Ok(Self {
            model: model.to_owned(),
            instructions: (!instructions.is_empty()).then(|| instructions.join("\n\n")),
            turns,
            schema: body.pointer("/response_format/json_schema/schema").cloned(),
        })
    }

    pub fn images(&self) -> impl Iterator<Item = (&str, &str)> {
        self.turns
            .iter()
            .flat_map(|turn| &turn.parts)
            .filter_map(|part| match part {
                Part::Image { media_type, data } => Some((media_type.as_str(), data.as_str())),
                Part::Text(_) => None,
            })
    }

    pub fn text(&self) -> String {
        let mut sections = Vec::new();
        if let Some(instructions) = &self.instructions {
            sections.push(format!("<anweisungen>\n{instructions}\n</anweisungen>"));
        }
        for turn in &self.turns {
            let text = turn
                .parts
                .iter()
                .filter_map(|part| match part {
                    Part::Text(text) => Some(text.as_str()),
                    Part::Image { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            match turn.speaker {
                Speaker::User => sections.push(text),
                Speaker::Assistant => {
                    sections.push(format!("<bisherige_antwort>\n{text}\n</bisherige_antwort>"))
                }
            }
        }
        sections.retain(|section| !section.is_empty());
        sections.join("\n\n")
    }
}

pub fn completion(answer: Answer) -> Value {
    json!({
        "choices": [{
            "index": 0,
            "finish_reason": if answer.truncated { "length" } else { "stop" },
            "message": { "role": "assistant", "content": answer.text },
        }],
        "usage": {
            "prompt_tokens": answer.input_tokens,
            "completion_tokens": answer.output_tokens,
            "total_tokens": answer.input_tokens + answer.output_tokens,
        },
    })
}

pub fn environment(
    program: &Path,
    search_path: Option<&OsString>,
    parent: ParentEnv,
) -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> = PASSED_ENV
        .iter()
        .filter_map(|name| parent(name).map(|value| (OsString::from(name), value)))
        .collect();
    let mut dirs: Vec<PathBuf> = program
        .parent()
        .map(Path::to_path_buf)
        .into_iter()
        .collect();
    if let Some(path) = search_path.cloned().or_else(|| parent("PATH")) {
        dirs.extend(std::env::split_paths(&path));
    }
    if let Ok(path) = std::env::join_paths(dirs) {
        env.push(("PATH".into(), path));
    }
    env
}

pub type ParentEnv = fn(&str) -> Option<OsString>;

#[derive(Clone, Copy)]
pub struct Runtime {
    pub limits: Limits,
    pub parent: ParentEnv,
    pub login_path: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            limits: CHAT_LIMITS,
            parent: |name| std::env::var_os(name),
            login_path: true,
        }
    }
}

impl Runtime {
    async fn env(&self, program: &Path) -> Vec<(OsString, OsString)> {
        let search_path = if self.login_path {
            locate::login_path().await
        } else {
            None
        };
        environment(program, search_path.as_ref(), self.parent)
    }
}

pub fn executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        path.extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    }
}

fn named_like(adapter: &dyn Adapter, path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| adapter.binary_names().contains(&name))
}

fn stable_path(path: &Path) -> PathBuf {
    path.parent()
        .and_then(|dir| dir.canonicalize().ok())
        .zip(path.file_name())
        .map(|(dir, name)| dir.join(name))
        .filter(|candidate| executable(candidate))
        .unwrap_or_else(|| path.to_path_buf())
}

pub async fn inspect(
    runtime: &Runtime,
    adapter: &dyn Adapter,
    path: &Path,
) -> Result<CliInfo, ErrorClass> {
    if !path.is_absolute() || !named_like(adapter, path) || !executable(path) {
        return Err(ErrorClass::CliMissing);
    }
    let stable = stable_path(path);
    let path = stable.as_path();
    let env = runtime.env(path).await;
    let output = runner::run(Run {
        program: path,
        args: &[OsString::from("--version")],
        env: &env,
        stdin: &[],
        files: &[],
        limits: VERSION_LIMITS,
    })
    .await
    .map_err(|_| ErrorClass::CliMissing)?;
    let version = adapter
        .version(&String::from_utf8_lossy(&output.stdout))
        .ok_or(ErrorClass::CliMissing)?;
    if adapter.outdated(&version) {
        return Err(ErrorClass::CliOutdated);
    }
    Ok(CliInfo {
        path: path.to_string_lossy().into_owned(),
        version,
    })
}

pub async fn chat(
    runtime: &Runtime,
    adapter: &dyn Adapter,
    path: &Path,
    prompt: &Prompt,
) -> (Result<Value, ErrorClass>, usize) {
    if !path.is_absolute() || !named_like(adapter, path) || !executable(path) {
        return (Err(ErrorClass::CliMissing), 0);
    }
    let invocation = match adapter.invocation(prompt) {
        Ok(invocation) => invocation,
        Err(class) => return (Err(class), 0),
    };
    let mut env = runtime.env(path).await;
    env.extend(invocation.env);
    let bytes = invocation.stdin.len();
    let result = runner::run(Run {
        program: path,
        args: &invocation.args,
        env: &env,
        stdin: &invocation.stdin,
        files: &invocation.files,
        limits: runtime.limits,
    })
    .await
    .map_err(|error| match error {
        RunError::Spawn => ErrorClass::CliMissing,
        RunError::Timeout => ErrorClass::Timeout,
        RunError::TooLarge => ErrorClass::InvalidResponse,
        RunError::Io => ErrorClass::CliFailed,
    })
    .and_then(|output| adapter.answer(&output))
    .map(completion);
    (result, bytes)
}
