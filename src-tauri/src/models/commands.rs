use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use super::download::DownloadError;
use super::import::ImportOutcome;
use super::manager::{self, DownloadEvent, ModelManager, ModelStatus};
use super::system;
use crate::llm::LlmRuntime;
use crate::llm::commands::runtime_paths;

pub const DOWNLOAD_EVENT: &str = "model-download";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    total_ram_bytes: u64,
    free_disk_bytes: Option<u64>,
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, DownloadError> {
    runtime_paths(app)
        .map(|paths| paths.models_dir)
        .map_err(|error| DownloadError::Io(format!("{error:?}")))
}

#[tauri::command]
pub async fn model_status<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<ModelStatus, DownloadError> {
    let entry = manager::entry(&model_id)?;
    Ok(models.status(&models_dir(&app)?, entry).await)
}

#[tauri::command]
pub async fn hardware_info<R: Runtime>(app: AppHandle<R>) -> Result<HardwareInfo, DownloadError> {
    let dir = models_dir(&app)?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(HardwareInfo {
        total_ram_bytes: system::total_memory(),
        free_disk_bytes: system::free_space(&dir),
    })
}

#[tauri::command]
pub async fn model_download_start<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), DownloadError> {
    let entry = manager::entry(&model_id)?;
    let dir = models_dir(&app)?;
    let emitter = app.clone();
    let emit: manager::Emitter = Arc::new(move |event: DownloadEvent| {
        let _ = emitter.emit(DOWNLOAD_EVENT, event);
    });
    models.start(&dir, entry, emit).await
}

#[tauri::command]
pub fn model_download_cancel(models: State<'_, Arc<ModelManager>>, model_id: String) -> bool {
    models.cancel(&model_id)
}

#[tauri::command]
pub async fn model_delete<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    llm: State<'_, LlmRuntime>,
    model_id: String,
) -> Result<ModelStatus, DownloadError> {
    let entry = manager::entry(&model_id)?;
    let dir = models_dir(&app)?;
    models.delete(&dir, entry, || drop(llm.stop())).await?;
    Ok(models.status(&dir, entry).await)
}

#[tauri::command]
pub async fn model_import<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    llm: State<'_, LlmRuntime>,
    model_id: String,
) -> Result<Option<ImportOutcome>, DownloadError> {
    let entry = manager::entry(&model_id)?;
    if models.is_busy(&model_id) {
        return Err(DownloadError::Busy);
    }
    let dir = models_dir(&app)?;
    let dialog = app.clone();
    let picked = tokio::task::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title("Modelldateien auswählen")
            .add_filter("Modelldatei (GGUF)", &["gguf"])
            .blocking_pick_files()
    })
    .await
    .map_err(|error| DownloadError::Io(error.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let sources: Vec<PathBuf> = picked
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect();
    Ok(Some(
        models
            .import(&dir, entry, sources, || drop(llm.stop()))
            .await?,
    ))
}

#[tauri::command]
pub async fn model_verify<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<ModelStatus, DownloadError> {
    let entry = manager::entry(&model_id)?;
    models.verify(&models_dir(&app)?, entry).await
}
