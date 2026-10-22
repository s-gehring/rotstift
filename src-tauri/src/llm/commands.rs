use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

use super::process;
use super::runtime::{
    LlmError, LlmRuntime, RuntimePaths, RuntimeStatus, StartOptions, installed_layout,
};
use crate::models::{
    self, ModelManager,
    registry::{ModelEntry, Reasoning},
    system,
};

const REPACK_MIN_RAM_BYTES: u64 = 12 * 1024 * 1024 * 1024;

fn environment_error(error: impl ToString) -> LlmError {
    LlmError::Environment(error.to_string())
}

pub fn runtime_paths<R: Runtime>(app: &AppHandle<R>) -> Result<RuntimePaths, LlmError> {
    let executable = tauri::utils::platform::current_exe().map_err(environment_error)?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| environment_error("executable has no parent directory"))?;
    let resolver = app.path();
    let data_dir = resolver.app_data_dir().map_err(environment_error)?;
    let resource_dir = resolver.resource_dir().map_err(environment_error)?;
    let (sidecar, library_dir) = installed_layout(executable_dir, &resource_dir);
    Ok(RuntimePaths {
        sidecar,
        library_dir,
        models_dir: data_dir.join("models"),
        records_dir: data_dir.join("runtime"),
    })
}

pub fn stop_orphaned_sidecars<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(paths) = runtime_paths(app) {
        std::thread::spawn(move || process::stop_orphans(&paths.records_dir));
    }
}

pub fn start_options(entry: &ModelEntry, total_ram_bytes: u64) -> StartOptions {
    StartOptions {
        model: entry.files.model.name.clone(),
        mmproj: entry.files.mmproj.as_ref().map(|file| file.name.clone()),
        context_size: Some(entry.server.context_size),
        threads: entry.server.threads,
        gpu_layers: entry.server.gpu_layers,
        image_max_tokens: entry.server.image_max_tokens,
        no_repack: !entry.server.cpu_repack && total_ram_bytes < REPACK_MIN_RAM_BYTES,
        reasoning_off: entry.server.reasoning == Reasoning::Off,
    }
}

#[tauri::command]
pub async fn llm_start_model<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, LlmRuntime>,
    models: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<RuntimeStatus, LlmError> {
    let paths = runtime_paths(&app)?;
    let entry = models::entry(&model_id).map_err(|_| LlmError::InvalidModelName(model_id))?;
    if !models.startable(&paths.models_dir, entry).await {
        return Err(LlmError::ModelNotFound(entry.files.model.name.clone()));
    }
    let options = start_options(entry, system::total_memory());
    runtime.start(&paths, options).await
}

#[tauri::command]
pub async fn llm_probe_model<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, LlmRuntime>,
    models: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), LlmError> {
    if runtime.is_busy() {
        return Err(LlmError::NotReady);
    }
    let started = llm_start_model(app, runtime.clone(), models, model_id).await;
    runtime.stop();
    started.map(drop)
}

#[tauri::command]
pub fn llm_stop(runtime: State<'_, LlmRuntime>) -> RuntimeStatus {
    runtime.stop()
}

#[tauri::command]
pub fn llm_stop_if_idle(runtime: State<'_, LlmRuntime>, idle_ms: u64) -> bool {
    runtime.stop_if_idle(idle_ms)
}

#[tauri::command]
pub async fn llm_status(runtime: State<'_, LlmRuntime>) -> Result<RuntimeStatus, LlmError> {
    Ok(runtime.status().await)
}

#[tauri::command]
pub async fn llm_chat(
    runtime: State<'_, LlmRuntime>,
    request_id: Option<String>,
    request: Value,
) -> Result<Value, LlmError> {
    runtime.chat(request_id, request).await
}

#[tauri::command]
pub fn llm_cancel(runtime: State<'_, LlmRuntime>, request_id: String) -> bool {
    runtime.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::registry::{DEFAULT_CORRECTOR_ID, DEFAULT_MODEL_ID, registry};

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn the_corrector_starts_without_projector_and_skips_repacking_on_small_machines() {
        let corrector = registry().unwrap().find(DEFAULT_CORRECTOR_ID).unwrap();
        let small = start_options(corrector, 8 * GIB);
        assert_eq!(small.model, corrector.files.model.name);
        assert_eq!(small.mmproj, None);
        assert_eq!(small.image_max_tokens, None);
        assert!(small.no_repack);
        assert!(!start_options(corrector, 16 * GIB).no_repack);
        assert!(small.reasoning_off);
    }

    #[test]
    fn the_transcriber_keeps_its_projector_and_always_repacks() {
        let transcriber = registry().unwrap().find(DEFAULT_MODEL_ID).unwrap();
        let options = start_options(transcriber, 8 * GIB);
        assert_eq!(
            options.mmproj.as_deref(),
            Some(transcriber.files.mmproj.as_ref().unwrap().name.as_str())
        );
        assert!(!options.no_repack);
        assert!(!options.reasoning_off);
    }
}
