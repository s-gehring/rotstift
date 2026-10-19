use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

use super::runtime::{LlmError, LlmRuntime, RuntimePaths, RuntimeStatus, StartOptions};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    name: String,
    bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDirectory {
    path: String,
    files: Vec<ModelFile>,
}

fn environment_error(error: impl ToString) -> LlmError {
    LlmError::Environment(error.to_string())
}

fn runtime_paths<R: Runtime>(app: &AppHandle<R>) -> Result<RuntimePaths, LlmError> {
    let executable = tauri::utils::platform::current_exe().map_err(environment_error)?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| environment_error("executable has no parent directory"))?;
    let resolver = app.path();
    Ok(RuntimePaths {
        sidecar: executable_dir.join(format!("llama-server{}", std::env::consts::EXE_SUFFIX)),
        library_dir: resolver
            .resource_dir()
            .map_err(environment_error)?
            .join("llama"),
        models_dir: resolver
            .app_data_dir()
            .map_err(environment_error)?
            .join("models"),
    })
}

#[tauri::command]
pub async fn llm_start<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, LlmRuntime>,
    options: StartOptions,
) -> Result<RuntimeStatus, LlmError> {
    let paths = runtime_paths(&app)?;
    runtime.start(&paths, options).await
}

#[tauri::command]
pub fn llm_stop(runtime: State<'_, LlmRuntime>) -> RuntimeStatus {
    runtime.stop()
}

#[tauri::command]
pub fn llm_status(runtime: State<'_, LlmRuntime>) -> RuntimeStatus {
    runtime.status()
}

#[tauri::command]
pub async fn llm_chat(runtime: State<'_, LlmRuntime>, request: Value) -> Result<Value, LlmError> {
    runtime.chat(request).await
}

#[tauri::command]
pub fn llm_models<R: Runtime>(app: AppHandle<R>) -> Result<ModelDirectory, LlmError> {
    let dir = runtime_paths(&app)?.models_dir;
    std::fs::create_dir_all(&dir).map_err(environment_error)?;
    let mut files: Vec<ModelFile> = std::fs::read_dir(&dir)
        .map_err(environment_error)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let metadata = entry.metadata().ok()?;
            (metadata.is_file() && name.ends_with(".gguf")).then_some(ModelFile {
                name,
                bytes: metadata.len(),
            })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ModelDirectory {
        path: dir.display().to_string(),
        files,
    })
}
