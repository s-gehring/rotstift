use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Read};
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
const DEFAULT_CONTEXT_SIZE: u32 = 8192;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(300);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);
const LOG_TAIL_LINES: usize = 40;

#[cfg(target_os = "macos")]
const LIBRARY_PATH_VAR: &str = "DYLD_LIBRARY_PATH";
#[cfg(target_os = "windows")]
const LIBRARY_PATH_VAR: &str = "PATH";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const LIBRARY_PATH_VAR: &str = "LD_LIBRARY_PATH";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub model: String,
    pub mmproj: Option<String>,
    pub context_size: Option<u32>,
    pub threads: Option<u32>,
    pub gpu_layers: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum RuntimeStatus {
    Stopped,
    Starting { model: String },
    Ready { model: String, port: u16 },
    Failed { error: LlmError },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum LlmError {
    InvalidModelName(String),
    ModelNotFound(String),
    SidecarMissing(String),
    Environment(String),
    SpawnFailed(String),
    ExitedDuringStartup(String),
    ExitedUnexpectedly(String),
    StartupTimeout,
    NotReady,
    Request(String),
    Server { status: u16, body: String },
}

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub sidecar: PathBuf,
    pub library_dir: PathBuf,
    pub models_dir: PathBuf,
}

type LogTail = Arc<Mutex<VecDeque<String>>>;

struct Server {
    child: Child,
    port: u16,
    api_key: String,
    log_tail: LogTail,
}

impl Server {
    fn log_tail(&self) -> String {
        let lines = self.log_tail.lock().unwrap_or_else(|e| e.into_inner());
        lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }

    fn has_exited(&mut self) -> bool {
        !matches!(self.child.try_wait(), Ok(None))
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct State {
    generation: u64,
    server: Option<Server>,
    status: RuntimeStatus,
}

pub struct LlmRuntime {
    state: Mutex<State>,
    http: reqwest::Client,
}

impl Default for LlmRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl LlmRuntime {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .build()
            .expect("HTTP client without TLS or proxy must build");
        Self {
            state: Mutex::new(State {
                generation: 0,
                server: None,
                status: RuntimeStatus::Stopped,
            }),
            http,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> RuntimeStatus {
        let mut state = self.lock();
        if let RuntimeStatus::Ready { .. } = state.status
            && let Some(server) = state.server.as_mut()
            && server.has_exited()
        {
            let error = LlmError::ExitedUnexpectedly(server.log_tail());
            state.server = None;
            state.status = RuntimeStatus::Failed { error };
        }
        state.status.clone()
    }

    pub fn stop(&self) -> RuntimeStatus {
        let server = {
            let mut state = self.lock();
            state.generation += 1;
            state.status = RuntimeStatus::Stopped;
            state.server.take()
        };
        drop(server);
        RuntimeStatus::Stopped
    }

    pub async fn start(
        &self,
        paths: &RuntimePaths,
        options: StartOptions,
    ) -> Result<RuntimeStatus, LlmError> {
        let model = resolve_model_file(&paths.models_dir, &options.model)?;
        let mmproj = options
            .mmproj
            .as_deref()
            .map(|name| resolve_model_file(&paths.models_dir, name))
            .transpose()?;
        if !paths.sidecar.is_file() {
            return Err(LlmError::SidecarMissing(
                paths.sidecar.display().to_string(),
            ));
        }
        self.stop();

        let port = free_port().map_err(|e| LlmError::SpawnFailed(e.to_string()))?;
        let api_key = random_key()?;
        let mut command = Command::new(&paths.sidecar);
        command
            .args(server_args(&model, mmproj.as_deref(), &options, port))
            .env("LLAMA_API_KEY", &api_key)
            .env(
                LIBRARY_PATH_VAR,
                library_search_path(&paths.library_dir, std::env::var_os(LIBRARY_PATH_VAR)),
            )
            .current_dir(&paths.library_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| LlmError::SpawnFailed(e.to_string()))?;
        let log_tail = collect_log_tail(child.stderr.take());

        let generation = {
            let mut state = self.lock();
            state.generation += 1;
            state.server = Some(Server {
                child,
                port,
                api_key,
                log_tail,
            });
            state.status = RuntimeStatus::Starting {
                model: options.model.clone(),
            };
            state.generation
        };
        self.wait_until_ready(generation, port, options.model).await
    }

    async fn wait_until_ready(
        &self,
        generation: u64,
        port: u16,
        model: String,
    ) -> Result<RuntimeStatus, LlmError> {
        let health = format!("http://{HOST}:{port}/health");
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if let Some(outcome) = self.check_process(generation) {
                return outcome;
            }
            let healthy = self
                .http
                .get(&health)
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .is_ok_and(|response| response.status().is_success());
            if let Some(outcome) = self.record_health(generation, healthy, &model, port, deadline) {
                return outcome;
            }
            tokio::time::sleep(HEALTH_INTERVAL).await;
        }
    }

    fn check_process(&self, generation: u64) -> Option<Result<RuntimeStatus, LlmError>> {
        let mut state = self.lock();
        if state.generation != generation {
            return Some(Ok(state.status.clone()));
        }
        let log = match state.server.as_mut() {
            Some(server) => server.has_exited().then(|| server.log_tail())?,
            None => return Some(Ok(state.status.clone())),
        };
        Some(Err(fail(&mut state, LlmError::ExitedDuringStartup(log))))
    }

    fn record_health(
        &self,
        generation: u64,
        healthy: bool,
        model: &str,
        port: u16,
        deadline: Instant,
    ) -> Option<Result<RuntimeStatus, LlmError>> {
        let mut state = self.lock();
        if state.generation != generation {
            return Some(Ok(state.status.clone()));
        }
        if healthy {
            state.status = RuntimeStatus::Ready {
                model: model.into(),
                port,
            };
            return Some(Ok(state.status.clone()));
        }
        (Instant::now() >= deadline).then(|| Err(fail(&mut state, LlmError::StartupTimeout)))
    }

    pub async fn chat(&self, request: Value) -> Result<Value, LlmError> {
        let (port, api_key) = {
            let state = self.lock();
            match (&state.status, &state.server) {
                (RuntimeStatus::Ready { .. }, Some(server)) => {
                    (server.port, server.api_key.clone())
                }
                _ => return Err(LlmError::NotReady),
            }
        };
        let mut body = request;
        let Some(fields) = body.as_object_mut() else {
            return Err(LlmError::Request("request must be a JSON object".into()));
        };
        fields.insert("stream".into(), Value::Bool(false));

        let response = self
            .http
            .post(format!("http://{HOST}:{port}/v1/chat/completions"))
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Request(e.to_string()))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| LlmError::Request(e.to_string()))?;
        if !status.is_success() {
            return Err(LlmError::Server {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| LlmError::Request(e.to_string()))
    }
}

fn fail(state: &mut State, error: LlmError) -> LlmError {
    state.server = None;
    state.status = RuntimeStatus::Failed {
        error: error.clone(),
    };
    error
}

pub fn resolve_model_file(models_dir: &Path, name: &str) -> Result<PathBuf, LlmError> {
    let plain_file_name = Path::new(name).file_name() == Some(OsStr::new(name))
        && !name.contains(['/', '\\'])
        && name.ends_with(".gguf");
    if !plain_file_name {
        return Err(LlmError::InvalidModelName(name.into()));
    }
    let path = models_dir.join(name);
    if !path.is_file() {
        return Err(LlmError::ModelNotFound(name.into()));
    }
    Ok(path)
}

fn library_search_path(library_dir: &Path, existing: Option<OsString>) -> OsString {
    let mut paths = vec![library_dir.to_path_buf()];
    if let Some(existing) = existing {
        paths.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(paths).unwrap_or_else(|_| library_dir.as_os_str().to_owned())
}

fn server_args(
    model: &Path,
    mmproj: Option<&Path>,
    options: &StartOptions,
    port: u16,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["--model".into(), model.into()];
    if let Some(mmproj) = mmproj {
        args.extend(["--mmproj".into(), mmproj.into()]);
    }
    let context_size = options.context_size.unwrap_or(DEFAULT_CONTEXT_SIZE);
    args.extend(
        [
            "--host",
            &HOST.to_string(),
            "--port",
            &port.to_string(),
            "--ctx-size",
            &context_size.to_string(),
            "--parallel",
            "1",
            "--cache-ram",
            "0",
            "--no-webui",
            "--no-slots",
            "--offline",
        ]
        .map(OsString::from),
    );
    if let Some(threads) = options.threads {
        args.extend(["--threads".into(), threads.to_string().into()]);
    }
    if let Some(layers) = options.gpu_layers {
        args.extend(["--n-gpu-layers".into(), layers.to_string().into()]);
    }
    args
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind((HOST, 0))?.local_addr()?.port())
}

fn random_key() -> Result<String, LlmError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| LlmError::Environment(e.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn collect_log_tail(stream: Option<impl Read + Send + 'static>) -> LogTail {
    let tail = LogTail::default();
    if let Some(stream) = stream {
        let sink = Arc::clone(&tail);
        std::thread::spawn(move || {
            for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                let mut lines = sink.lock().unwrap_or_else(|e| e.into_inner());
                if lines.len() == LOG_TAIL_LINES {
                    lines.pop_front();
                }
                lines.push_back(String::from_utf8_lossy(&line).trim_end().to_owned());
            }
        });
    }
    tail
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_models_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn options(model: &str) -> StartOptions {
        StartOptions {
            model: model.into(),
            mmproj: None,
            context_size: None,
            threads: None,
            gpu_layers: None,
        }
    }

    #[test]
    fn resolves_plain_gguf_file_names_inside_the_models_dir() {
        let dir = temp_models_dir("resolve");
        std::fs::write(dir.join("model.gguf"), b"").unwrap();
        assert_eq!(
            resolve_model_file(&dir, "model.gguf"),
            Ok(dir.join("model.gguf"))
        );
        assert_eq!(
            resolve_model_file(&dir, "other.gguf"),
            Err(LlmError::ModelNotFound("other.gguf".into()))
        );
    }

    #[test]
    fn rejects_model_names_that_leave_the_models_dir() {
        let dir = temp_models_dir("reject");
        for name in [
            "",
            "..",
            "../model.gguf",
            "sub/model.gguf",
            "sub\\model.gguf",
            "/etc/model.gguf",
            "model.bin",
        ] {
            assert_eq!(
                resolve_model_file(&dir, name),
                Err(LlmError::InvalidModelName(name.into())),
                "{name}"
            );
        }
    }

    #[test]
    fn library_dir_comes_first_in_the_search_path() {
        let existing = std::env::join_paths(["/usr/lib", "/opt/lib"]).unwrap();
        let joined = library_search_path(Path::new("/app/llama"), Some(existing));
        let paths: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            paths,
            ["/app/llama", "/usr/lib", "/opt/lib"].map(PathBuf::from)
        );
    }

    #[test]
    fn server_listens_on_loopback_only_and_keeps_the_key_off_the_command_line() {
        let args = server_args(Path::new("m.gguf"), None, &options("m.gguf"), 4242);
        let args: Vec<String> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into())
            .collect();
        let host = args.iter().position(|arg| arg == "--host").unwrap();
        assert_eq!(args[host + 1], "127.0.0.1");
        assert!(args.windows(2).any(|pair| pair == ["--port", "4242"]));
        assert!(!args.iter().any(|arg| arg.contains("api-key")));
        assert!(args.contains(&"--offline".into()));
    }

    #[test]
    fn passes_projector_and_tuning_options() {
        let mut options = options("m.gguf");
        options.context_size = Some(4096);
        options.threads = Some(4);
        options.gpu_layers = Some(0);
        let args = server_args(
            Path::new("m.gguf"),
            Some(Path::new("mmproj.gguf")),
            &options,
            1,
        );
        let args: Vec<String> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into())
            .collect();
        for pair in [
            ["--mmproj", "mmproj.gguf"],
            ["--ctx-size", "4096"],
            ["--threads", "4"],
            ["--n-gpu-layers", "0"],
        ] {
            assert!(args.windows(2).any(|window| window == pair), "{pair:?}");
        }
    }

    #[test]
    fn status_and_errors_serialize_as_tagged_objects() {
        let ready = RuntimeStatus::Ready {
            model: "m.gguf".into(),
            port: 4242,
        };
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            json!({ "state": "ready", "model": "m.gguf", "port": 4242 })
        );
        let failed = RuntimeStatus::Failed {
            error: LlmError::StartupTimeout,
        };
        assert_eq!(
            serde_json::to_value(failed).unwrap(),
            json!({ "state": "failed", "error": { "kind": "startupTimeout" } })
        );
        assert_eq!(
            serde_json::to_value(LlmError::ModelNotFound("x.gguf".into())).unwrap(),
            json!({ "kind": "modelNotFound", "detail": "x.gguf" })
        );
    }

    #[test]
    fn keeps_only_the_last_log_lines() {
        let log: String = (0..100).map(|line| format!("line {line}\n")).collect();
        let tail = collect_log_tail(Some(std::io::Cursor::new(log.into_bytes())));
        let deadline = Instant::now() + Duration::from_secs(5);
        while tail.lock().unwrap().back().map(String::as_str) != Some("line 99") {
            assert!(Instant::now() < deadline, "log reader did not finish");
            std::thread::sleep(Duration::from_millis(10));
        }
        let lines = tail.lock().unwrap();
        assert_eq!(lines.len(), LOG_TAIL_LINES);
        assert_eq!(lines.front().map(String::as_str), Some("line 60"));
    }

    #[tokio::test]
    async fn chat_requires_a_ready_server() {
        let runtime = LlmRuntime::new();
        assert_eq!(runtime.chat(json!({})).await, Err(LlmError::NotReady));
    }

    #[tokio::test]
    async fn start_reports_a_missing_sidecar() {
        let dir = temp_models_dir("sidecar");
        std::fs::write(dir.join("model.gguf"), b"").unwrap();
        let paths = RuntimePaths {
            sidecar: dir.join("missing-llama-server"),
            library_dir: dir.clone(),
            models_dir: dir.clone(),
        };
        let result = LlmRuntime::new().start(&paths, options("model.gguf")).await;
        assert!(matches!(result, Err(LlmError::SidecarMissing(_))));
    }

    #[tokio::test]
    #[ignore = "needs pnpm fetch:runtime, ROTSTIFT_TEST_MODELS_DIR and ROTSTIFT_TEST_MODEL"]
    async fn starts_the_real_sidecar_and_answers_a_chat_request() {
        let models_dir = PathBuf::from(std::env::var("ROTSTIFT_TEST_MODELS_DIR").unwrap());
        let model = std::env::var("ROTSTIFT_TEST_MODEL").unwrap();
        let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let triple = std::fs::read_to_string(binaries.join("runtime.json")).unwrap();
        let triple: Value = serde_json::from_str(&triple).unwrap();
        let sidecar = binaries.join(format!(
            "llama-server-{}{}",
            triple["target"].as_str().unwrap(),
            std::env::consts::EXE_SUFFIX
        ));
        let paths = RuntimePaths {
            sidecar,
            library_dir: binaries.join("llama"),
            models_dir,
        };
        let runtime = LlmRuntime::new();
        let mut start = options(&model);
        start.context_size = Some(2048);
        let status = runtime.start(&paths, start).await.unwrap();
        assert!(matches!(status, RuntimeStatus::Ready { .. }), "{status:?}");

        let answer = runtime
            .chat(json!({
                "messages": [{ "role": "user", "content": "Antworte nur mit dem Wort Hallo." }],
                "max_tokens": 16,
            }))
            .await
            .unwrap();
        assert!(answer["choices"][0]["message"]["content"].is_string());

        assert_eq!(runtime.stop(), RuntimeStatus::Stopped);
        assert_eq!(runtime.status(), RuntimeStatus::Stopped);
    }
}
