use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

use super::process;
use super::runtime::{
    LlmError, LlmRuntime, RuntimePaths, RuntimeStatus, StartOptions, installed_layout,
};
use crate::models::{
    self, ModelManager,
    registry::{ModelEntry, Reasoning, Role},
    system,
};

const GIB: u64 = 1024 * 1024 * 1024;
const REPACK_MIN_RAM_BYTES: u64 = 12 * GIB;
const RESERVED_RAM_BYTES: u64 = 7 * GIB / 2;
const DRAFT_OVERHEAD_BYTES: f64 = 0.15e9;

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

fn needed_bytes(entry: &ModelEntry, repack: bool) -> f64 {
    let overhead = match entry.role {
        Role::Transcriber => 1.4e9,
        Role::Corrector => 0.65e9,
    };
    let repacked = if repack {
        0.47 * entry.files.model.bytes as f64
    } else {
        0.0
    };
    let draft = if entry.files.draft.is_some() {
        DRAFT_OVERHEAD_BYTES
    } else {
        0.0
    };
    1.05 * entry.total_bytes() as f64 + overhead + draft + repacked
}

pub fn start_options(entry: &ModelEntry, total_ram_bytes: u64, use_draft: bool) -> StartOptions {
    let budget = total_ram_bytes.saturating_sub(RESERVED_RAM_BYTES) as f64;
    let wants_repack = entry.server.cpu_repack || total_ram_bytes >= REPACK_MIN_RAM_BYTES;
    let repack = wants_repack && needed_bytes(entry, true) <= budget;
    StartOptions {
        model: entry.files.model.name.clone(),
        mmproj: entry.files.mmproj.as_ref().map(|file| file.name.clone()),
        draft: entry
            .files
            .draft
            .as_ref()
            .filter(|_| use_draft)
            .map(|file| file.name.clone()),
        context_size: Some(entry.server.context_size),
        threads: entry.server.threads,
        gpu_layers: entry.server.gpu_layers,
        image_max_tokens: entry.server.image_max_tokens,
        no_repack: !repack,
        from_disk: needed_bytes(entry, repack) > budget,
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
    let use_draft = match &entry.files.draft {
        Some(draft) => {
            !runtime.draft_failed(&draft.name)
                && models::draft_ready(&paths.models_dir, entry).await
        }
        None => false,
    };
    let options = start_options(entry, system::total_memory(), use_draft);
    runtime.start_with_fallback(&paths, options).await
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

    #[test]
    fn the_corrector_starts_without_projector_and_skips_repacking_on_small_machines() {
        let corrector = registry().unwrap().find(DEFAULT_CORRECTOR_ID).unwrap();
        let small = start_options(corrector, 8 * GIB, false);
        assert_eq!(small.model, corrector.files.model.name);
        assert_eq!(small.mmproj, None);
        assert_eq!(small.image_max_tokens, None);
        assert!(small.no_repack);
        assert!(!small.from_disk);
        assert!(!start_options(corrector, 16 * GIB, false).no_repack);
        assert!(small.reasoning_off);
    }

    #[test]
    fn hands_the_head_to_the_server_only_when_it_is_usable() {
        let corrector = registry().unwrap().find(DEFAULT_CORRECTOR_ID).unwrap();
        let draft = corrector.files.draft.as_ref().unwrap();
        assert_eq!(start_options(corrector, 8 * GIB, false).draft, None);
        assert_eq!(
            start_options(corrector, 8 * GIB, true).draft.as_deref(),
            Some(draft.name.as_str())
        );
        let transcriber = registry().unwrap().find(DEFAULT_MODEL_ID).unwrap();
        assert_eq!(start_options(transcriber, 8 * GIB, true).draft, None);
    }

    #[test]
    fn counts_the_head_in_the_memory_estimate() {
        let corrector = registry().unwrap().find(DEFAULT_CORRECTOR_ID).unwrap();
        let mut without = corrector.clone();
        without.files.draft = None;
        let extra = needed_bytes(corrector, false) - needed_bytes(&without, false);
        assert!((0.15e9..0.25e9).contains(&extra), "{extra}");
    }

    #[test]
    fn serves_a_model_larger_than_the_memory_from_the_file_without_repacking() {
        let registry = registry().unwrap();
        let large = registry.find("gemma-4-26b-a4b-q4").unwrap();
        for ram in [8 * GIB, 16 * GIB] {
            let options = start_options(large, ram, true);
            assert!(options.no_repack, "{ram}");
            assert!(options.from_disk, "{ram}");
        }
        let roomy = start_options(large, 48 * GIB, true);
        assert!(!roomy.no_repack);
        assert!(!roomy.from_disk);
        let medium = registry.find("gemma-4-e4b-q4").unwrap();
        assert!(start_options(medium, 8 * GIB, true).from_disk);
        assert!(!start_options(medium, 16 * GIB, true).no_repack);
    }

    #[test]
    fn repacks_the_vision_model_only_where_the_copy_fits() {
        let registry = registry().unwrap();
        let qwen = registry.find("qwen3-vl-4b-q4").unwrap();
        let tight = start_options(qwen, 8 * GIB, false);
        assert!(tight.no_repack);
        assert!(!tight.from_disk);
        assert!(!start_options(qwen, 16 * GIB, false).no_repack);
    }

    #[test]
    fn the_transcriber_keeps_its_projector_and_repacks_on_small_machines() {
        let transcriber = registry().unwrap().find(DEFAULT_MODEL_ID).unwrap();
        let options = start_options(transcriber, 8 * GIB, true);
        assert_eq!(
            options.mmproj.as_deref(),
            Some(transcriber.files.mmproj.as_ref().unwrap().name.as_str())
        );
        assert!(!options.no_repack);
        assert!(!options.reasoning_off);
    }
}
