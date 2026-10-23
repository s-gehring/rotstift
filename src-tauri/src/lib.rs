mod cloud;
mod diagnostics;
mod llm;
#[cfg(target_os = "macos")]
mod menu;
mod models;
mod power;
mod save;

use std::sync::Arc;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(llm::LlmRuntime::new())
        .manage(Arc::new(models::ModelManager::new()))
        .manage(power::system())
        .setup(|app| {
            diagnostics::init(app.handle());
            llm::commands::stop_orphaned_sidecars(app.handle());
            models::commands::init_custom_models(app.handle());
            cloud::commands::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            llm::commands::llm_start_model,
            llm::commands::llm_probe_model,
            llm::commands::llm_stop,
            llm::commands::llm_stop_if_idle,
            llm::commands::llm_status,
            llm::commands::llm_chat,
            llm::commands::llm_cancel,
            cloud::commands::cloud_config,
            cloud::commands::cloud_use,
            cloud::commands::cloud_set_key,
            cloud::commands::cloud_clear,
            cloud::commands::cloud_set_protection,
            cloud::commands::cloud_models,
            cloud::commands::cloud_check,
            cloud::commands::cloud_chat,
            cloud::commands::cloud_cancel,
            diagnostics::commands::diag_log,
            diagnostics::commands::diag_heartbeat,
            diagnostics::commands::diag_read,
            diagnostics::commands::diag_clear,
            models::commands::model_status,
            models::commands::model_selection,
            models::commands::model_select,
            models::commands::model_corrector_selection,
            models::commands::model_select_corrector,
            models::commands::model_reviewer_selection,
            models::commands::model_select_reviewer,
            models::commands::hardware_info,
            models::commands::model_download_start,
            models::commands::model_download_cancel,
            models::commands::model_delete,
            models::commands::model_import,
            models::commands::model_verify,
            models::commands::model_custom_list,
            models::commands::model_custom_resolve,
            models::commands::model_custom_add_link,
            models::commands::model_custom_import,
            power::commands::power_hold,
            power::commands::power_release,
            save::save_file,
        ])
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                webview.state::<power::SystemPowerHold>().release();
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<power::SystemPowerHold>().release();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<llm::LlmRuntime>().stop();
                app.state::<power::SystemPowerHold>().release();
            }
        });
}
