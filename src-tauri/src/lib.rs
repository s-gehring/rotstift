mod diagnostics;
mod llm;
mod models;
mod save;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(llm::LlmRuntime::new())
        .manage(Arc::new(models::ModelManager::new()))
        .setup(|app| {
            diagnostics::init(app.handle());
            llm::commands::stop_orphaned_sidecars(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            llm::commands::llm_start_model,
            llm::commands::llm_stop,
            llm::commands::llm_status,
            llm::commands::llm_chat,
            llm::commands::llm_cancel,
            diagnostics::commands::diag_log,
            diagnostics::commands::diag_heartbeat,
            diagnostics::commands::diag_read,
            diagnostics::commands::diag_clear,
            models::commands::model_status,
            models::commands::model_selection,
            models::commands::model_select,
            models::commands::hardware_info,
            models::commands::model_download_start,
            models::commands::model_download_cancel,
            models::commands::model_delete,
            models::commands::model_import,
            models::commands::model_verify,
            save::save_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<llm::LlmRuntime>().stop();
            }
        });
}
