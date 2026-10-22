use std::collections::{HashMap, VecDeque};
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Read};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::process::{self, RecordGuard};
use super::request::{ChatRequest, MAX_OUTPUT_TOKENS};
use crate::diagnostics;

pub const SIDECAR_NAME: &str = "rotstift-llama-server";
const HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
const DEFAULT_CONTEXT_SIZE: u32 = 8192;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(300);
const CHAT_TIMEOUT: Duration = Duration::from_secs(900);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);
const CRASH_GRACE: Duration = Duration::from_secs(1);
const LOG_TAIL_LINES: usize = 40;
const LOG_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
const LISTENING_MARKER: &str = "listening on http://";
const MAX_EARLY_CANCELS: usize = 32;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub model: String,
    pub mmproj: Option<String>,
    pub context_size: Option<u32>,
    pub threads: Option<u32>,
    pub gpu_layers: Option<u32>,
    pub image_max_tokens: Option<u32>,
    #[serde(default)]
    pub no_repack: bool,
    pub reasoning_off: bool,
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
pub struct ExitReport {
    pub code: Option<i32>,
    pub log: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum LlmError {
    InvalidModelName(String),
    ModelNotFound(String),
    SidecarMissing(String),
    Environment(String),
    SpawnFailed(String),
    ExitedDuringStartup(ExitReport),
    ExitedUnexpectedly(ExitReport),
    StartupTimeout,
    NotReady,
    InvalidRequest(String),
    Cancelled,
    Timeout,
    Request(String),
    Server { status: u16, body: String },
}

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub sidecar: PathBuf,
    pub library_dir: PathBuf,
    pub models_dir: PathBuf,
    pub records_dir: PathBuf,
}

#[derive(Default)]
struct Log {
    lines: VecDeque<String>,
    port: Option<u16>,
    closed: bool,
}

type SharedLog = Arc<Mutex<Log>>;

fn lock_log(log: &SharedLog) -> MutexGuard<'_, Log> {
    log.lock().unwrap_or_else(|e| e.into_inner())
}

struct Server {
    child: Child,
    api_key: String,
    log: SharedLog,
    _record: RecordGuard,
}

impl Server {
    fn listening_port(&self) -> Option<u16> {
        lock_log(&self.log).port
    }

    fn exit_code(&mut self) -> Option<Option<i32>> {
        match self.child.try_wait() {
            Ok(None) => None,
            Ok(Some(status)) => Some(status.code()),
            Err(_) => Some(None),
        }
    }
}

struct Exit {
    generation: u64,
    code: Option<i32>,
    log: SharedLog,
    during_startup: bool,
    api_key: String,
}

impl Exit {
    fn error(&self, report: ExitReport) -> LlmError {
        if self.during_startup {
            LlmError::ExitedDuringStartup(report)
        } else {
            LlmError::ExitedUnexpectedly(report)
        }
    }
}

fn log_tail(log: &SharedLog) -> String {
    lock_log(log)
        .lines
        .iter()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

async fn exit_report(code: Option<i32>, log: &SharedLog) -> ExitReport {
    let deadline = Instant::now() + LOG_DRAIN_TIMEOUT;
    while !lock_log(log).closed && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    ExitReport {
        code,
        log: log_tail(log),
    }
}

fn take_exited(state: &mut State) -> Option<Exit> {
    let during_startup = match state.status {
        RuntimeStatus::Starting { .. } => true,
        RuntimeStatus::Ready { .. } => false,
        _ => return None,
    };
    let code = state.server.as_mut()?.exit_code()?;
    let server = state.server.take()?;
    let exit = Exit {
        generation: state.generation,
        code,
        log: Arc::clone(&server.log),
        during_startup,
        api_key: server.api_key.clone(),
    };
    drop(server);
    let provisional = ExitReport {
        code,
        log: String::new(),
    };
    state.status = RuntimeStatus::Failed {
        error: exit.error(provisional),
    };
    Some(exit)
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

#[derive(Default)]
struct Requests {
    pending: HashMap<String, oneshot::Sender<()>>,
    cancelled_early: VecDeque<String>,
}

enum Startup {
    Waiting(Option<u16>),
    Finished(Result<RuntimeStatus, LlmError>),
}

pub struct LlmRuntime {
    state: Mutex<State>,
    starting: tokio::sync::Mutex<()>,
    requests: Mutex<Requests>,
    http: reqwest::Client,
    startup_timeout: Duration,
}

impl Default for LlmRuntime {
    fn default() -> Self {
        Self::new()
    }
}

struct PendingRequest<'a> {
    runtime: &'a LlmRuntime,
    id: String,
}

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        self.runtime.requests().pending.remove(&self.id);
    }
}

impl LlmRuntime {
    pub fn new() -> Self {
        Self::with_startup_timeout(STARTUP_TIMEOUT)
    }

    fn with_startup_timeout(startup_timeout: Duration) -> Self {
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
            starting: tokio::sync::Mutex::new(()),
            requests: Mutex::default(),
            http,
            startup_timeout,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn requests(&self) -> MutexGuard<'_, Requests> {
        self.requests.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn check_exit(&self) -> Option<LlmError> {
        let exit = take_exited(&mut self.lock())?;
        let report = exit_report(exit.code, &exit.log).await;
        diagnostics::record(
            "sidecar_exit",
            json!({
                "code": report.code,
                "duringStartup": exit.during_startup,
                "stderrTail": diagnostics::stderr_tail(&report.log, &redactions(&exit.api_key)),
            }),
        );
        let error = exit.error(report);
        let mut state = self.lock();
        if state.generation == exit.generation
            && matches!(state.status, RuntimeStatus::Failed { .. })
        {
            state.status = RuntimeStatus::Failed {
                error: error.clone(),
            };
        }
        Some(error)
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.check_exit().await;
        self.lock().status.clone()
    }

    fn abort_start(&self, generation: u64, error: LlmError) -> LlmError {
        diagnostics::record(
            "sidecar_start_failed",
            json!({ "kind": error_kind(&error) }),
        );
        let mut state = self.lock();
        if state.generation == generation {
            state.status = RuntimeStatus::Failed {
                error: error.clone(),
            };
        }
        error
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
        let _starting = self.starting.lock().await;
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
        process::stop_orphans(&paths.records_dir);

        let api_key = random_key()?;
        let generation = {
            let mut state = self.lock();
            state.generation += 1;
            state.status = RuntimeStatus::Starting {
                model: options.model.clone(),
            };
            state.generation
        };
        let mut command = process::sidecar_command(
            &paths.sidecar,
            &paths.library_dir,
            server_args(&model, mmproj.as_deref(), &options),
        );
        command.env("LLAMA_API_KEY", &api_key);
        let mut child = match process::spawn(command) {
            Ok(child) => child,
            Err(error) => {
                let error = LlmError::SpawnFailed(error.to_string());
                return Err(self.abort_start(generation, error));
            }
        };
        diagnostics::record(
            "sidecar_start",
            json!({
                "model": options.model,
                "contextSize": options.context_size,
                "threads": options.threads,
                "imageMaxTokens": options.image_max_tokens,
                "noRepack": options.no_repack,
                "reasoningOff": options.reasoning_off,
            }),
        );
        let log = read_log(child.stderr.take());
        let record = match process::record(&paths.records_dir, &child, &paths.sidecar) {
            Ok(record) => record,
            Err(error) => {
                let error = match child.try_wait() {
                    Ok(Some(status)) => {
                        LlmError::ExitedDuringStartup(exit_report(status.code(), &log).await)
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        LlmError::SpawnFailed(error.to_string())
                    }
                };
                return Err(self.abort_start(generation, error));
            }
        };
        let server = Server {
            child,
            api_key,
            log,
            _record: record,
        };
        {
            let mut state = self.lock();
            if state.generation != generation {
                drop(server);
                return Ok(state.status.clone());
            }
            state.server = Some(server);
        }
        self.wait_until_ready(generation, options.model).await
    }

    async fn wait_until_ready(
        &self,
        generation: u64,
        model: String,
    ) -> Result<RuntimeStatus, LlmError> {
        let began = Instant::now();
        let deadline = began + self.startup_timeout;
        loop {
            if let Some(error) = self.check_exit().await {
                return Err(error);
            }
            let port = match self.startup_progress(generation, deadline) {
                Startup::Finished(outcome) => {
                    if let Err(LlmError::StartupTimeout) = outcome {
                        diagnostics::record(
                            "sidecar_startup_timeout",
                            json!({ "afterMs": began.elapsed().as_millis() as u64 }),
                        );
                    }
                    return outcome;
                }
                Startup::Waiting(port) => port,
            };
            if let Some(port) = port {
                let healthy = self
                    .http
                    .get(format!("http://{HOST}:{port}/health"))
                    .timeout(Duration::from_secs(2))
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success());
                if healthy {
                    diagnostics::record(
                        "sidecar_ready",
                        json!({ "startupMs": began.elapsed().as_millis() as u64 }),
                    );
                    return Ok(self.mark_ready(generation, model, port));
                }
            }
            tokio::time::sleep(HEALTH_INTERVAL).await;
        }
    }

    fn startup_progress(&self, generation: u64, deadline: Instant) -> Startup {
        let mut state = self.lock();
        if state.generation != generation {
            return Startup::Finished(Ok(state.status.clone()));
        }
        match &state.status {
            RuntimeStatus::Starting { .. } => {}
            RuntimeStatus::Failed { error } => return Startup::Finished(Err(error.clone())),
            status => return Startup::Finished(Ok(status.clone())),
        }
        let Some(port) = state.server.as_ref().map(Server::listening_port) else {
            return Startup::Finished(Ok(state.status.clone()));
        };
        if Instant::now() >= deadline {
            return Startup::Finished(Err(fail(&mut state, LlmError::StartupTimeout)));
        }
        Startup::Waiting(port)
    }

    fn mark_ready(&self, generation: u64, model: String, port: u16) -> RuntimeStatus {
        let mut state = self.lock();
        if state.generation == generation && state.server.is_some() {
            state.status = RuntimeStatus::Ready { model, port };
        }
        state.status.clone()
    }

    async fn ready_server(&self) -> Result<(u16, String), LlmError> {
        if let Some(error) = self.check_exit().await {
            return Err(error);
        }
        let state = self.lock();
        match (&state.status, &state.server) {
            (RuntimeStatus::Ready { port, .. }, Some(server)) => {
                Ok((*port, server.api_key.clone()))
            }
            (RuntimeStatus::Failed { error }, _) => Err(error.clone()),
            _ => Err(LlmError::NotReady),
        }
    }

    fn register(
        &self,
        id: String,
    ) -> Result<(PendingRequest<'_>, oneshot::Receiver<()>), LlmError> {
        let mut requests = self.requests();
        if let Some(index) = requests
            .cancelled_early
            .iter()
            .position(|early| *early == id)
        {
            requests.cancelled_early.remove(index);
            return Err(LlmError::Cancelled);
        }
        if requests.pending.contains_key(&id) {
            return Err(LlmError::InvalidRequest(format!(
                "request id {id} is already in use"
            )));
        }
        let (sender, receiver) = oneshot::channel();
        requests.pending.insert(id.clone(), sender);
        Ok((PendingRequest { runtime: self, id }, receiver))
    }

    pub fn is_busy(&self) -> bool {
        let starting = matches!(self.lock().status, RuntimeStatus::Starting { .. });
        starting || !self.requests().pending.is_empty()
    }

    pub fn cancel(&self, id: &str) -> bool {
        let mut requests = self.requests();
        if let Some(sender) = requests.pending.remove(id) {
            return sender.send(()).is_ok();
        }
        if requests.cancelled_early.len() == MAX_EARLY_CANCELS {
            requests.cancelled_early.pop_front();
        }
        requests.cancelled_early.push_back(id.to_owned());
        false
    }

    pub async fn chat(
        &self,
        request_id: Option<String>,
        request: Value,
    ) -> Result<Value, LlmError> {
        let request = ChatRequest::parse(request)?;
        let body = serde_json::to_value(request).map_err(|e| LlmError::Request(e.to_string()))?;
        self.send_chat(request_id, body).await
    }

    async fn send_chat(&self, request_id: Option<String>, body: Value) -> Result<Value, LlmError> {
        let guard = diagnostics::ChatGuard::begin(request_id.as_deref());
        let (port, api_key) = self.ready_server().await?;
        let send = self.post_chat(port, api_key, &body);
        let result = match request_id {
            None => send.await,
            Some(id) => {
                let (_pending, cancelled) = self.register(id)?;
                tokio::select! {
                    result = send => result,
                    _ = cancelled => Err(LlmError::Cancelled),
                }
            }
        };
        let result = match result {
            Err(error @ LlmError::Request(_)) => Err(self.explain_failure(error).await),
            other => other,
        };
        guard.finish(match &result {
            Ok(_) => "ok",
            Err(error) => error_kind(error),
        });
        result
    }

    async fn post_chat(&self, port: u16, api_key: String, body: &Value) -> Result<Value, LlmError> {
        let response = self
            .http
            .post(format!("http://{HOST}:{port}/v1/chat/completions"))
            .bearer_auth(api_key)
            .timeout(CHAT_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(request_error)?;
        let status = response.status();
        let text = response.text().await.map_err(request_error)?;
        if !status.is_success() {
            return Err(LlmError::Server {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| LlmError::Request(e.to_string()))
    }

    async fn explain_failure(&self, error: LlmError) -> LlmError {
        let deadline = Instant::now() + CRASH_GRACE;
        loop {
            if let Some(crash) = self.check_exit().await {
                return crash;
            }
            if Instant::now() >= deadline {
                return error;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

fn error_kind(error: &LlmError) -> &'static str {
    match error {
        LlmError::InvalidModelName(_) => "invalidModelName",
        LlmError::ModelNotFound(_) => "modelNotFound",
        LlmError::SidecarMissing(_) => "sidecarMissing",
        LlmError::Environment(_) => "environment",
        LlmError::SpawnFailed(_) => "spawnFailed",
        LlmError::ExitedDuringStartup(_) => "exitedDuringStartup",
        LlmError::ExitedUnexpectedly(_) => "exitedUnexpectedly",
        LlmError::StartupTimeout => "startupTimeout",
        LlmError::NotReady => "notReady",
        LlmError::InvalidRequest(_) => "invalidRequest",
        LlmError::Cancelled => "cancelled",
        LlmError::Timeout => "timeout",
        LlmError::Request(_) => "request",
        LlmError::Server { .. } => "server",
    }
}

fn redactions(api_key: &str) -> Vec<String> {
    ["HOME", "USERPROFILE"]
        .into_iter()
        .filter_map(|name| std::env::var(name).ok())
        .chain([api_key.to_owned()])
        .collect()
}

fn request_error(error: reqwest::Error) -> LlmError {
    if error.is_timeout() {
        LlmError::Timeout
    } else {
        LlmError::Request(error.to_string())
    }
}

fn fail(state: &mut State, error: LlmError) -> LlmError {
    state.server = None;
    state.status = RuntimeStatus::Failed {
        error: error.clone(),
    };
    error
}

pub fn installed_layout(executable_dir: &Path, resource_dir: &Path) -> (PathBuf, PathBuf) {
    let sidecar = executable_dir.join(format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX));
    // Windows searches System32 before PATH, so the bundled MSVC runtime only wins next to the exe.
    let library_dir = if cfg!(windows) {
        resource_dir.to_path_buf()
    } else {
        resource_dir.join("llama")
    };
    (sidecar, library_dir)
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

fn server_args(model: &Path, mmproj: Option<&Path>, options: &StartOptions) -> Vec<OsString> {
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
            "0",
            "--ctx-size",
            &context_size.to_string(),
            "--n-predict",
            &MAX_OUTPUT_TOKENS.to_string(),
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
    if let Some(tokens) = options.image_max_tokens {
        args.extend(["--image-max-tokens".into(), tokens.to_string().into()]);
    }
    if options.no_repack {
        args.push("--no-repack".into());
    }
    if options.reasoning_off {
        args.extend(["--reasoning".into(), "off".into()]);
    }
    args
}

fn random_key() -> Result<String, LlmError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| LlmError::Environment(e.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn listening_port(line: &str) -> Option<u16> {
    let start = line.find(LISTENING_MARKER)? + LISTENING_MARKER.len();
    let address = line[start..].split_whitespace().next()?;
    let (host, port) = address.rsplit_once(':')?;
    (host == HOST.to_string()).then(|| port.parse().ok())?
}

fn read_log(stream: Option<impl Read + Send + 'static>) -> SharedLog {
    let log = SharedLog::default();
    let Some(stream) = stream else {
        lock_log(&log).closed = true;
        return log;
    };
    let sink = Arc::clone(&log);
    std::thread::spawn(move || {
        for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
            let line = String::from_utf8_lossy(&line).trim_end().to_owned();
            let mut log = lock_log(&sink);
            if log.port.is_none() {
                log.port = listening_port(&line);
            }
            if log.lines.len() == LOG_TAIL_LINES {
                log.lines.pop_front();
            }
            log.lines.push_back(line);
        }
        lock_log(&sink).closed = true;
    });
    log
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process::Stdio;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
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
            image_max_tokens: None,
            no_repack: false,
            reasoning_off: false,
        }
    }

    fn arg_strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into())
            .collect()
    }

    fn bundled_sidecar() -> (PathBuf, PathBuf) {
        let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let stamp = std::fs::read_to_string(binaries.join("runtime.json")).unwrap();
        let stamp: Value = serde_json::from_str(&stamp).unwrap();
        let sidecar = binaries.join(format!(
            "{SIDECAR_NAME}-{}{}",
            stamp["target"].as_str().unwrap(),
            std::env::consts::EXE_SUFFIX
        ));
        (sidecar, binaries.join("llama"))
    }

    #[test]
    fn resolves_plain_gguf_file_names_inside_the_models_dir() {
        let dir = temp_dir("resolve");
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
        let dir = temp_dir("reject");
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
    fn server_binds_an_os_assigned_loopback_port_and_keeps_the_key_off_the_command_line() {
        let args = arg_strings(&server_args(Path::new("m.gguf"), None, &options("m.gguf")));
        let host = args.iter().position(|arg| arg == "--host").unwrap();
        assert_eq!(args[host + 1], "127.0.0.1");
        assert!(args.windows(2).any(|pair| pair == ["--port", "0"]));
        assert!(args.windows(2).any(|pair| pair == ["--n-predict", "4096"]));
        assert!(!args.iter().any(|arg| arg.contains("api-key")));
        assert!(args.contains(&"--offline".into()));
        assert!(!args.contains(&"--no-repack".into()));
        assert!(!args.contains(&"--mmproj".into()));
        assert!(!args.contains(&"--reasoning".into()));
    }

    #[test]
    fn switches_reasoning_off_when_asked() {
        let mut options = options("m.gguf");
        options.reasoning_off = true;
        let args = arg_strings(&server_args(Path::new("m.gguf"), None, &options));
        assert!(args.windows(2).any(|pair| pair == ["--reasoning", "off"]));
    }

    #[test]
    fn skips_weight_repacking_when_asked() {
        let mut options = options("m.gguf");
        options.no_repack = true;
        let args = arg_strings(&server_args(Path::new("m.gguf"), None, &options));
        assert!(args.contains(&"--no-repack".into()));
    }

    #[test]
    fn passes_projector_and_tuning_options() {
        let mut options = options("m.gguf");
        options.context_size = Some(4096);
        options.threads = Some(4);
        options.gpu_layers = Some(0);
        options.image_max_tokens = Some(1024);
        let args = arg_strings(&server_args(
            Path::new("m.gguf"),
            Some(Path::new("mmproj.gguf")),
            &options,
        ));
        for pair in [
            ["--mmproj", "mmproj.gguf"],
            ["--ctx-size", "4096"],
            ["--threads", "4"],
            ["--n-gpu-layers", "0"],
            ["--image-max-tokens", "1024"],
        ] {
            assert!(args.windows(2).any(|window| window == pair), "{pair:?}");
        }
    }

    #[test]
    fn reads_the_port_from_the_listening_line() {
        assert_eq!(
            listening_port("0.05.149 I srv  llama_server: listening on http://127.0.0.1:54548"),
            Some(54548)
        );
        assert_eq!(
            listening_port("main: server is listening on http://127.0.0.1:8080 - starting"),
            Some(8080)
        );
        assert_eq!(listening_port("listening on http://0.0.0.0:8080"), None);
        assert_eq!(listening_port("load_model: loading model"), None);
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
            error: LlmError::ExitedDuringStartup(ExitReport {
                code: Some(-1_073_741_515),
                log: "boom".into(),
            }),
        };
        assert_eq!(
            serde_json::to_value(failed).unwrap(),
            json!({
                "state": "failed",
                "error": {
                    "kind": "exitedDuringStartup",
                    "detail": { "code": -1_073_741_515, "log": "boom" },
                },
            })
        );
        assert_eq!(
            serde_json::to_value(LlmError::Cancelled).unwrap(),
            json!({ "kind": "cancelled" })
        );
    }

    #[test]
    fn keeps_only_the_last_log_lines_and_the_port() {
        let mut text = String::from("x: listening on http://127.0.0.1:4242\n");
        text.extend((0..100).map(|line| format!("line {line}\n")));
        let log = read_log(Some(std::io::Cursor::new(text.into_bytes())));
        let deadline = Instant::now() + Duration::from_secs(5);
        while !lock_log(&log).closed {
            assert!(Instant::now() < deadline, "log reader did not finish");
            std::thread::sleep(Duration::from_millis(10));
        }
        let log = lock_log(&log);
        assert_eq!(log.port, Some(4242));
        assert_eq!(log.lines.len(), LOG_TAIL_LINES);
        assert_eq!(log.lines.front().map(String::as_str), Some("line 60"));
    }

    #[tokio::test]
    async fn chat_requires_a_ready_server() {
        let runtime = LlmRuntime::new();
        let request = json!({ "messages": [{ "role": "user", "content": "x" }] });
        assert_eq!(runtime.chat(None, request).await, Err(LlmError::NotReady));
    }

    #[tokio::test]
    async fn chat_validates_before_contacting_the_server() {
        let runtime = LlmRuntime::new();
        let request = json!({ "messages": [], "stream": true });
        assert!(matches!(
            runtime.chat(None, request).await,
            Err(LlmError::InvalidRequest(_))
        ));
    }

    #[test]
    fn cancelling_before_the_request_arrives_still_cancels_it() {
        let runtime = LlmRuntime::new();
        assert!(!runtime.cancel("a"));
        assert!(matches!(
            runtime.register("a".into()),
            Err(LlmError::Cancelled)
        ));
        assert!(runtime.register("a".into()).is_ok());
    }

    #[test]
    fn forgets_the_oldest_early_cancellations_first() {
        let runtime = LlmRuntime::new();
        for id in 0..=MAX_EARLY_CANCELS {
            runtime.cancel(&id.to_string());
        }
        assert!(runtime.register("0".into()).is_ok());
        assert!(matches!(
            runtime.register("1".into()),
            Err(LlmError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn start_reports_a_missing_sidecar() {
        let dir = temp_dir("sidecar");
        std::fs::write(dir.join("model.gguf"), b"").unwrap();
        let paths = RuntimePaths {
            sidecar: dir.join("missing-sidecar"),
            library_dir: dir.clone(),
            models_dir: dir.clone(),
            records_dir: dir.join("records"),
        };
        let result = LlmRuntime::new().start(&paths, options("model.gguf")).await;
        assert!(matches!(result, Err(LlmError::SidecarMissing(_))));
    }

    #[test]
    fn smoke_bundled_sidecar_starts() {
        let installed = std::env::var_os("ROTSTIFT_BUNDLE_EXE_DIR")
            .zip(std::env::var_os("ROTSTIFT_BUNDLE_RESOURCE_DIR"));
        let (sidecar, library_dir) = match &installed {
            Some((exe_dir, resource_dir)) => {
                installed_layout(Path::new(exe_dir), Path::new(resource_dir))
            }
            None => bundled_sidecar(),
        };
        if installed.is_some() && cfg!(windows) {
            let neighbours: Vec<String> = std::fs::read_dir(sidecar.parent().unwrap())
                .unwrap()
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .map(|name| name.to_lowercase())
                .collect();
            for dll in ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"] {
                assert!(
                    neighbours.iter().any(|name| name == dll),
                    "{dll} is not next to the sidecar"
                );
            }
            assert!(
                neighbours
                    .iter()
                    .any(|name| name.starts_with("ggml") && name.ends_with(".dll")),
                "ggml is not next to the sidecar"
            );
        }
        let mut command = process::sidecar_command(&sidecar, &library_dir, ["--version".into()]);
        command.stdout(Stdio::piped());
        let output = process::spawn(command).unwrap().wait_with_output().unwrap();
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.status.success(), "{:?}: {text}", output.status);
        assert!(text.contains("version"), "{text}");
    }

    #[cfg(unix)]
    mod lifecycle {
        use super::*;
        use std::io::Write;
        use std::net::TcpListener;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicBool, Ordering};

        fn fake_sidecar(name: &str, script: &str) -> RuntimePaths {
            let dir = temp_dir(name);
            std::fs::write(dir.join("model.gguf"), b"").unwrap();
            let sidecar = dir.join("fake-sidecar");
            std::fs::write(&sidecar, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o755)).unwrap();
            RuntimePaths {
                sidecar,
                library_dir: dir.clone(),
                models_dir: dir.clone(),
                records_dir: dir.join("records"),
            }
        }

        fn fake_server(answer_chat: bool) -> u16 {
            let listener = TcpListener::bind((HOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            std::thread::spawn(move || {
                for stream in listener.incoming().map_while(Result::ok) {
                    std::thread::spawn(move || {
                        let mut stream = stream;
                        let mut reader = BufReader::new(stream.try_clone().unwrap());
                        let mut request_line = String::new();
                        reader.read_line(&mut request_line).unwrap();
                        let health = request_line.contains("/health");
                        if !health && !answer_chat {
                            std::thread::sleep(Duration::from_secs(30));
                            return;
                        }
                        let body = if health {
                            r#"{"status":"ok"}"#
                        } else {
                            r#"{"choices":[{"index":0,"message":{"role":"assistant","content":"Hallo"}}]}"#
                        };
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                    });
                }
            });
            port
        }

        fn listening(port: u16) -> String {
            format!("echo 'srv llama_server: listening on http://127.0.0.1:{port}' >&2")
        }

        fn pid_of(paths: &RuntimePaths) -> u32 {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(pid) = std::fs::read_to_string(paths.library_dir.join("pid")) {
                    return pid.trim().parse().unwrap();
                }
                assert!(Instant::now() < deadline, "fake sidecar did not start");
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn is_running(pid: u32) -> bool {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        }

        fn records(paths: &RuntimePaths) -> usize {
            std::fs::read_dir(&paths.records_dir).map_or(0, Iterator::count)
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn stopping_during_startup_ends_the_sidecar() {
            let paths = fake_sidecar(
                "stop-during-start",
                "echo $$ > pid.tmp\nmv pid.tmp pid\nexec sleep 30",
            );
            let runtime = Arc::new(LlmRuntime::new());
            let starting = {
                let (runtime, paths) = (Arc::clone(&runtime), paths.clone());
                tokio::spawn(async move { runtime.start(&paths, options("model.gguf")).await })
            };
            let pid = pid_of(&paths);
            assert!(matches!(
                runtime.status().await,
                RuntimeStatus::Starting { .. }
            ));
            assert!(runtime.is_busy());
            runtime.stop();
            assert!(!runtime.is_busy());
            assert_eq!(starting.await.unwrap(), Ok(RuntimeStatus::Stopped));
            assert!(!is_running(pid));
            assert_eq!(records(&paths), 0);
        }

        #[tokio::test]
        async fn reports_the_exit_code_when_the_sidecar_dies_during_startup() {
            let paths = fake_sidecar("exit-during-start", "echo 'cannot load model' >&2\nexit 7");
            let runtime = LlmRuntime::new();
            let result = runtime.start(&paths, options("model.gguf")).await;
            let expected = LlmError::ExitedDuringStartup(ExitReport {
                code: Some(7),
                log: "cannot load model".into(),
            });
            assert_eq!(result, Err(expected.clone()));
            assert_eq!(
                runtime.status().await,
                RuntimeStatus::Failed { error: expected }
            );
        }

        #[tokio::test]
        async fn gives_up_and_ends_the_sidecar_after_the_startup_timeout() {
            let paths = fake_sidecar("timeout", "exec sleep 30");
            let runtime = LlmRuntime::with_startup_timeout(Duration::from_millis(500));
            let result = runtime.start(&paths, options("model.gguf")).await;
            assert_eq!(result, Err(LlmError::StartupTimeout));
            assert_eq!(records(&paths), 0);
        }

        #[tokio::test]
        async fn detects_a_crash_after_ready() {
            let port = fake_server(true);
            let script = format!(
                "{}\nsleep 1\necho 'GGML_ASSERT failed' >&2\nexit 3",
                listening(port)
            );
            let paths = fake_sidecar("crash", &script);
            let runtime = LlmRuntime::new();
            let status = runtime.start(&paths, options("model.gguf")).await.unwrap();
            assert_eq!(
                status,
                RuntimeStatus::Ready {
                    model: "model.gguf".into(),
                    port
                }
            );
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let request = json!({ "messages": [{ "role": "user", "content": "x" }] });
            match runtime.chat(None, request).await {
                Err(LlmError::ExitedUnexpectedly(report)) => {
                    assert_eq!(report.code, Some(3));
                    assert!(report.log.ends_with("GGML_ASSERT failed"), "{}", report.log);
                }
                other => panic!("expected a crash report, got {other:?}"),
            }
            assert!(matches!(
                runtime.status().await,
                RuntimeStatus::Failed { .. }
            ));
            assert_eq!(records(&paths), 0);
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn cancels_a_running_chat_request() {
            let port = fake_server(false);
            let paths = fake_sidecar("cancel", &format!("{}\nexec sleep 30", listening(port)));
            let runtime = Arc::new(LlmRuntime::new());
            runtime.start(&paths, options("model.gguf")).await.unwrap();
            let finished = Arc::new(AtomicBool::new(false));
            let chat = {
                let (runtime, finished) = (Arc::clone(&runtime), Arc::clone(&finished));
                tokio::spawn(async move {
                    let request = json!({ "messages": [{ "role": "user", "content": "x" }] });
                    let result = runtime.chat(Some("r1".into()), request).await;
                    finished.store(true, Ordering::SeqCst);
                    result
                })
            };
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!finished.load(Ordering::SeqCst));
            assert!(runtime.is_busy());
            assert!(runtime.cancel("r1"));
            assert_eq!(chat.await.unwrap(), Err(LlmError::Cancelled));
            assert!(runtime.requests().pending.is_empty());
            assert!(!runtime.is_busy());
            runtime.stop();
        }

        #[tokio::test]
        async fn answers_chat_requests_with_the_server_response() {
            let port = fake_server(true);
            let paths = fake_sidecar("chat", &format!("{}\nexec sleep 30", listening(port)));
            let runtime = LlmRuntime::new();
            runtime.start(&paths, options("model.gguf")).await.unwrap();
            assert_eq!(records(&paths), 1);
            let request = json!({ "messages": [{ "role": "user", "content": "x" }] });
            let answer = runtime.chat(None, request).await.unwrap();
            assert_eq!(answer["choices"][0]["message"]["content"], "Hallo");
            runtime.stop();
            assert_eq!(records(&paths), 0);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs ROTSTIFT_TEST_MODELS_DIR and ROTSTIFT_TEST_MODEL"]
    async fn starts_the_real_sidecar_answers_and_cancels() {
        let models_dir = PathBuf::from(std::env::var("ROTSTIFT_TEST_MODELS_DIR").unwrap());
        let model = std::env::var("ROTSTIFT_TEST_MODEL").unwrap();
        let (sidecar, library_dir) = bundled_sidecar();
        let paths = RuntimePaths {
            sidecar,
            library_dir,
            models_dir,
            records_dir: temp_dir("real-records"),
        };
        let runtime = Arc::new(LlmRuntime::new());
        let mut start = options(&model);
        start.context_size = Some(4096);
        start.threads = Some(1);
        let status = runtime.start(&paths, start).await.unwrap();
        assert!(matches!(status, RuntimeStatus::Ready { .. }), "{status:?}");

        let long = {
            let runtime = Arc::clone(&runtime);
            tokio::spawn(async move {
                let request = ChatRequest::parse(json!({
                    "messages": [{ "role": "user", "content": "Erzähle eine lange Geschichte." }],
                    "max_tokens": MAX_OUTPUT_TOKENS,
                }))
                .unwrap();
                let mut body = serde_json::to_value(request).unwrap();
                body["ignore_eos"] = json!(true);
                runtime.send_chat(Some("long".into()), body).await
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        runtime.cancel("long");
        assert_eq!(long.await.unwrap(), Err(LlmError::Cancelled));

        let started = Instant::now();
        let answer = runtime
            .chat(
                None,
                json!({
                    "messages": [{ "role": "user", "content": "Antworte nur mit dem Wort Hallo." }],
                    "max_tokens": 16,
                }),
            )
            .await
            .unwrap();
        assert!(answer["choices"][0]["message"]["content"].is_string());
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "{:?}",
            started.elapsed()
        );

        assert_eq!(runtime.stop(), RuntimeStatus::Stopped);
        assert_eq!(runtime.status().await, RuntimeStatus::Stopped);
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs ROTSTIFT_TEST_MODELS_DIR with the registry model files"]
    async fn starts_the_registry_model_with_its_server_params() {
        let models_dir = PathBuf::from(std::env::var("ROTSTIFT_TEST_MODELS_DIR").unwrap());
        let registry = crate::models::registry::registry().unwrap();
        let (sidecar, library_dir) = bundled_sidecar();
        let paths = RuntimePaths {
            sidecar,
            library_dir,
            models_dir,
            records_dir: temp_dir("registry-records"),
        };
        let runtime = LlmRuntime::new();
        for entry in &registry.models {
            let options = crate::llm::commands::start_options(entry, 8 * 1024 * 1024 * 1024);
            let status = runtime.start(&paths, options).await.unwrap();
            assert!(matches!(status, RuntimeStatus::Ready { .. }), "{status:?}");
            runtime.stop();
        }
    }
}
