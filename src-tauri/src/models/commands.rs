use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use super::download::DownloadError;
use super::import::ImportOutcome;
use super::manager::{self, DownloadEvent, ModelManager, ModelStatus};
use super::selection;
use super::system;
use crate::llm::LlmRuntime;

pub const DOWNLOAD_EVENT: &str = "model-download";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    total_ram_bytes: u64,
    free_disk_bytes: Option<u64>,
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, DownloadError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|error| DownloadError::Io(format!("{error:?}")))
}

fn download_emitter<R: Runtime>(app: &AppHandle<R>) -> manager::Emitter {
    let emitter = app.clone();
    Arc::new(move |event: DownloadEvent| {
        let _ = emitter.emit(DOWNLOAD_EVENT, event);
    })
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
    models.start(&dir, entry, download_emitter(&app)).await
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
    let serving = selection::serves_model(&llm.status().await, entry);
    models
        .delete(&dir, entry, || {
            if serving {
                drop(llm.stop());
            }
        })
        .await?;
    selection::forget(&selection::selection_path(&dir), entry)?;
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
    let serving = selection::serves_model(&llm.status().await, entry);
    Ok(Some(
        models
            .import(&dir, entry, sources, || {
                if serving {
                    drop(llm.stop());
                }
            })
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
    models
        .verify(&models_dir(&app)?, entry, download_emitter(&app))
        .await
}

#[tauri::command]
pub fn model_selection<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, DownloadError> {
    Ok(selection::load(&selection::selection_path(&models_dir(
        &app,
    )?)))
}

#[tauri::command]
pub async fn model_select<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    llm: State<'_, LlmRuntime>,
    model_id: String,
) -> Result<(), DownloadError> {
    let entry = manager::entry(&model_id)?;
    if llm.is_busy() || models.has_jobs() {
        return Err(DownloadError::Busy);
    }
    selection::save(&selection::selection_path(&models_dir(&app)?), entry)?;
    if selection::runs_other_model(&llm.status().await, entry) {
        drop(llm.stop());
    }
    Ok(())
}

#[tauri::command]
pub fn model_reviewer_selection<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, DownloadError> {
    Ok(selection::load_reviewer(&selection::selection_path(
        &models_dir(&app)?,
    )))
}

#[tauri::command]
pub fn model_select_reviewer<R: Runtime>(
    app: AppHandle<R>,
    models: State<'_, Arc<ModelManager>>,
    llm: State<'_, LlmRuntime>,
    model_id: String,
) -> Result<(), DownloadError> {
    let entry = manager::entry(&model_id)?;
    if llm.is_busy() || models.has_jobs() {
        return Err(DownloadError::Busy);
    }
    selection::save_reviewer(&selection::selection_path(&models_dir(&app)?), entry)
}
