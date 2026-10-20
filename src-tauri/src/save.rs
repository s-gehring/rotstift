use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_CSV_BYTES: usize = 8 * 1024 * 1024;
const FALLBACK_NAME: &str = "Rotstift";

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SaveError {
    TooLarge,
    AlreadyExists { file_name: String },
    Io { message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    file_name: String,
}

pub fn csv_file_name(suggested: &str) -> String {
    let stem: String = suggested
        .trim()
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let stem = stem.trim().trim_end_matches('.').trim();
    let stem = stem
        .strip_suffix(".csv")
        .or_else(|| stem.strip_suffix(".CSV"))
        .unwrap_or(stem);
    let stem = if stem.is_empty() { FALLBACK_NAME } else { stem };
    format!("{stem}.csv")
}

pub fn write_csv(path: &Path, content: &str) -> Result<(), SaveError> {
    if content.len() > MAX_CSV_BYTES {
        return Err(SaveError::TooLarge);
    }
    let has_extension = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"));
    let (path, confirmed) = if has_extension {
        (path.to_path_buf(), true)
    } else {
        let mut with_extension = path.as_os_str().to_owned();
        with_extension.push(".csv");
        (PathBuf::from(with_extension), false)
    };
    let mut options = OpenOptions::new();
    options.write(true);
    if confirmed {
        options.create(true).truncate(true);
    } else {
        options.create_new(true);
    }
    let mut file = options.open(&path).map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists {
            SaveError::AlreadyExists {
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            }
        } else {
            SaveError::Io {
                message: error.to_string(),
            }
        }
    })?;
    file.write_all(content.as_bytes())
        .map_err(|error| SaveError::Io {
            message: error.to_string(),
        })
}

#[tauri::command]
pub async fn save_csv<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    suggested_name: String,
) -> Result<Option<SavedFile>, SaveError> {
    if content.len() > MAX_CSV_BYTES {
        return Err(SaveError::TooLarge);
    }
    let file_name = csv_file_name(&suggested_name);
    let dialog = app.clone();
    let default_name = file_name.clone();
    let picked = tokio::task::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title("Wortzahlen als CSV speichern")
            .set_file_name(default_name)
            .add_filter("CSV-Datei", &["csv"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| SaveError::Io {
        message: error.to_string(),
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| SaveError::Io {
        message: error.to_string(),
    })?;
    let saved_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or(file_name);
    tokio::task::spawn_blocking(move || write_csv(&path, &content))
        .await
        .map_err(|error| SaveError::Io {
            message: error.to_string(),
        })??;
    Ok(Some(SavedFile {
        file_name: saved_name,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-save-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_the_bytes_unchanged_including_the_bom() {
        let dir = scratch("bytes");
        let path = dir.join("klasse.csv");
        let content = "\u{feff}Name;Seiten;Wörter\r\nAnna;2;120\r\n";
        write_csv(&path, content).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], [0xEF, 0xBB, 0xBF]);
        assert_eq!(bytes, content.as_bytes());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn appends_the_csv_extension_when_the_chosen_name_has_none() {
        let dir = scratch("extension");
        write_csv(&dir.join("klasse"), "a").unwrap();
        assert!(dir.join("klasse.csv").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn never_overwrites_a_file_the_dialog_did_not_confirm() {
        let dir = scratch("exists");
        std::fs::write(dir.join("klasse.csv"), "alt").unwrap();
        let result = write_csv(&dir.join("klasse"), "neu");
        assert!(matches!(
            result,
            Err(SaveError::AlreadyExists { ref file_name }) if file_name == "klasse.csv"
        ));
        assert_eq!(
            std::fs::read_to_string(dir.join("klasse.csv")).unwrap(),
            "alt"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn overwrites_the_file_the_dialog_confirmed() {
        let dir = scratch("confirmed");
        std::fs::write(dir.join("klasse.csv"), "alt, deutlich länger").unwrap();
        write_csv(&dir.join("klasse.csv"), "neu").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("klasse.csv")).unwrap(),
            "neu"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn serialises_the_conflict_for_the_frontend() {
        let json = serde_json::to_value(SaveError::AlreadyExists {
            file_name: "klasse.csv".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "alreadyExists");
        assert_eq!(json["fileName"], "klasse.csv");
    }

    #[test]
    fn keeps_a_chosen_extension_in_any_case() {
        let dir = scratch("upper");
        write_csv(&dir.join("klasse.CSV"), "a").unwrap();
        assert!(dir.join("klasse.CSV").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_oversized_content() {
        let dir = scratch("large");
        let content = "x".repeat(MAX_CSV_BYTES + 1);
        assert!(matches!(
            write_csv(&dir.join("a.csv"), &content),
            Err(SaveError::TooLarge)
        ));
        assert!(!dir.join("a.csv").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reports_io_errors() {
        let dir = scratch("missing");
        let result = write_csv(&dir.join("fehlt").join("a.csv"), "a");
        assert!(matches!(result, Err(SaveError::Io { .. })));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn derives_a_safe_default_file_name() {
        assert_eq!(csv_file_name("Klasse 8b"), "Klasse 8b.csv");
        assert_eq!(csv_file_name("Klasse.csv"), "Klasse.csv");
        assert_eq!(csv_file_name("../../etc/passwd"), "....etcpasswd.csv");
        assert_eq!(csv_file_name("a:b*c?"), "abc.csv");
        assert_eq!(csv_file_name("  "), "Rotstift.csv");
        assert_eq!(csv_file_name("..."), "Rotstift.csv");
    }
}
