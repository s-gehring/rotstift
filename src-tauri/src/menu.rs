use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let about = AboutMetadata {
        name: Some("Rotstift".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "Rotstift",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Über Rotstift"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Rotstift ausblenden"))?,
            &PredefinedMenuItem::hide_others(app, Some("Andere ausblenden"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Rotstift beenden"))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Bearbeiten",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Widerrufen"))?,
            &PredefinedMenuItem::redo(app, Some("Wiederholen"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Ausschneiden"))?,
            &PredefinedMenuItem::copy(app, Some("Kopieren"))?,
            &PredefinedMenuItem::paste(app, Some("Einsetzen"))?,
            &PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Fenster",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimieren"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoomen"))?,
        ],
    )?;
    window_menu.set_as_windows_menu_for_nsapp()?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}
