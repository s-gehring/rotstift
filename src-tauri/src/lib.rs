mod llm;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(llm::LlmRuntime::new())
        .invoke_handler(tauri::generate_handler![
            llm::commands::llm_start,
            llm::commands::llm_stop,
            llm::commands::llm_status,
            llm::commands::llm_chat,
            llm::commands::llm_models,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<llm::LlmRuntime>().stop();
            }
        });
}
