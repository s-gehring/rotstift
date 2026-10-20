use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_CSV_BYTES: usize = 8 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 200 * 1024 * 1024;
const FALLBACK_NAME: &str = "Rotstift";
const KIND_HEADER: &str = "x-rotstift-kind";
const NAME_HEADER: &str = "x-rotstift-name";
const PDF_MAGIC: &[u8] = b"%PDF-";

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SaveError {
    TooLarge,
    InvalidRequest,
    AlreadyExists { file_name: String },
    Io { message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    file_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Csv,
    Pdf,
}

impl FileKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "csv" => Some(Self::Csv),
            "pdf" => Some(Self::Pdf),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Pdf => "pdf",
        }
    }

    fn max_bytes(self) -> usize {
        match self {
            Self::Csv => MAX_CSV_BYTES,
            Self::Pdf => MAX_PDF_BYTES,
        }
    }

    fn dialog_title(self) -> &'static str {
        match self {
            Self::Csv => "Als CSV-Datei speichern",
            Self::Pdf => "Als PDF-Datei speichern",
        }
    }

    fn filter_name(self) -> &'static str {
        match self {
            Self::Csv => "CSV-Datei",
            Self::Pdf => "PDF-Dokument",
        }
    }
}

pub fn decode_name(encoded: &str) -> Option<String> {
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = bytes.get(index + 1..index + 3)?;
            let value = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
            decoded.push(value);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

pub fn file_name(kind: FileKind, suggested: &str) -> String {
    let extension = kind.extension();
    let stem: String = suggested
        .trim()
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let stem = stem.trim().trim_end_matches('.').trim();
    let suffix = format!(".{extension}");
    let stem = if stem.len() >= suffix.len()
        && stem.is_char_boundary(stem.len() - suffix.len())
        && stem[stem.len() - suffix.len()..].eq_ignore_ascii_case(&suffix)
    {
        &stem[..stem.len() - suffix.len()]
    } else {
        stem
    };
    let stem = if stem.is_empty() { FALLBACK_NAME } else { stem };
    format!("{stem}.{extension}")
}

fn check_content(kind: FileKind, bytes: &[u8]) -> Result<(), SaveError> {
    if bytes.len() > kind.max_bytes() {
        return Err(SaveError::TooLarge);
    }
    let matches_kind = match kind {
        FileKind::Csv => std::str::from_utf8(bytes).is_ok(),
        FileKind::Pdf => bytes.starts_with(PDF_MAGIC),
    };
    if matches_kind {
        Ok(())
    } else {
        Err(SaveError::InvalidRequest)
    }
}

pub fn write_file(path: &Path, kind: FileKind, bytes: &[u8]) -> Result<(), SaveError> {
    check_content(kind, bytes)?;
    let has_extension = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(kind.extension()));
    let (path, confirmed) = if has_extension {
        (path.to_path_buf(), true)
    } else {
        let mut with_extension = path.as_os_str().to_owned();
        with_extension.push(format!(".{}", kind.extension()));
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
    file.write_all(bytes).map_err(|error| SaveError::Io {
        message: error.to_string(),
    })
}

fn parse_metadata(kind: Option<&str>, name: Option<&str>) -> Result<(FileKind, String), SaveError> {
    let kind = kind
        .and_then(FileKind::parse)
        .ok_or(SaveError::InvalidRequest)?;
    let name = match name {
        Some(encoded) => decode_name(encoded).ok_or(SaveError::InvalidRequest)?,
        None => String::new(),
    };
    Ok((kind, name))
}

#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Option<SavedFile>, SaveError> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let (kind, suggested_name) = parse_metadata(header(KIND_HEADER), header(NAME_HEADER))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(SaveError::InvalidRequest);
    };
    check_content(kind, bytes)?;
    let bytes = bytes.clone();
    let name = file_name(kind, &suggested_name);
    let dialog = app.clone();
    let default_name = name.clone();
    let picked = tokio::task::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title(kind.dialog_title())
            .set_file_name(default_name)
            .add_filter(kind.filter_name(), &[kind.extension()])
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
        .unwrap_or(name);
    tokio::task::spawn_blocking(move || write_file(&path, kind, &bytes))
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

    const PDF: &[u8] = b"%PDF-1.7\n\x00\xff\x80binary\r\n\x00%%EOF";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-save-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_csv_bytes_unchanged_including_the_bom() {
        let dir = scratch("csv-bytes");
        let path = dir.join("klasse.csv");
        let content = "\u{feff}Name;Seiten;Wörter\r\nAnna;2;120\r\n";
        write_file(&path, FileKind::Csv, content.as_bytes()).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], [0xEF, 0xBB, 0xBF]);
        assert_eq!(bytes, content.as_bytes());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_pdf_bytes_unchanged() {
        let dir = scratch("pdf-bytes");
        let path = dir.join("arbeit.pdf");
        let mut content = PDF.to_vec();
        content.extend((0..=255u8).cycle().take(100_000));
        write_file(&path, FileKind::Pdf, &content).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), content);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn appends_the_extension_of_the_kind_when_the_chosen_name_has_none() {
        let dir = scratch("extension");
        write_file(&dir.join("klasse"), FileKind::Csv, b"a").unwrap();
        write_file(&dir.join("klasse"), FileKind::Pdf, PDF).unwrap();
        assert!(dir.join("klasse.csv").is_file());
        assert!(dir.join("klasse.pdf").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_csv_name_does_not_count_as_confirmed_for_a_pdf() {
        let dir = scratch("other-extension");
        write_file(&dir.join("klasse.csv"), FileKind::Pdf, PDF).unwrap();
        assert!(dir.join("klasse.csv.pdf").is_file());
        assert!(!dir.join("klasse.csv").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn never_overwrites_a_file_the_dialog_did_not_confirm() {
        let dir = scratch("exists");
        for (kind, name, content) in [
            (FileKind::Csv, "klasse.csv", b"neu".as_slice()),
            (FileKind::Pdf, "klasse.pdf", PDF),
        ] {
            std::fs::write(dir.join(name), "alt").unwrap();
            let result = write_file(&dir.join("klasse"), kind, content);
            assert!(matches!(
                result,
                Err(SaveError::AlreadyExists { ref file_name }) if file_name == name
            ));
            assert_eq!(std::fs::read_to_string(dir.join(name)).unwrap(), "alt");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn overwrites_the_file_the_dialog_confirmed() {
        let dir = scratch("confirmed");
        std::fs::write(dir.join("klasse.pdf"), vec![0u8; 4096]).unwrap();
        write_file(&dir.join("klasse.pdf"), FileKind::Pdf, PDF).unwrap();
        assert_eq!(std::fs::read(dir.join("klasse.pdf")).unwrap(), PDF);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_a_chosen_extension_in_any_case() {
        let dir = scratch("upper");
        write_file(&dir.join("klasse.CSV"), FileKind::Csv, b"a").unwrap();
        write_file(&dir.join("klasse.PDF"), FileKind::Pdf, PDF).unwrap();
        assert!(dir.join("klasse.CSV").is_file());
        assert!(dir.join("klasse.PDF").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn serialises_errors_for_the_frontend() {
        let conflict = serde_json::to_value(SaveError::AlreadyExists {
            file_name: "klasse.pdf".into(),
        })
        .unwrap();
        assert_eq!(conflict["kind"], "alreadyExists");
        assert_eq!(conflict["fileName"], "klasse.pdf");
        assert_eq!(
            serde_json::to_value(SaveError::TooLarge).unwrap()["kind"],
            "tooLarge"
        );
        assert_eq!(
            serde_json::to_value(SaveError::InvalidRequest).unwrap()["kind"],
            "invalidRequest"
        );
    }

    #[test]
    fn limits_each_kind_separately() {
        let dir = scratch("limits");
        let csv = vec![b'x'; MAX_CSV_BYTES + 1];
        assert!(matches!(
            write_file(&dir.join("a.csv"), FileKind::Csv, &csv),
            Err(SaveError::TooLarge)
        ));
        assert!(!dir.join("a.csv").exists());

        let mut pdf = PDF.to_vec();
        pdf.resize(MAX_CSV_BYTES + 1, 0);
        write_file(&dir.join("a.pdf"), FileKind::Pdf, &pdf).unwrap();
        assert_eq!(
            std::fs::metadata(dir.join("a.pdf")).unwrap().len(),
            pdf.len() as u64
        );

        pdf.resize(MAX_PDF_BYTES + 1, 0);
        assert!(matches!(
            write_file(&dir.join("b.pdf"), FileKind::Pdf, &pdf),
            Err(SaveError::TooLarge)
        ));
        assert!(!dir.join("b.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn accepts_content_of_exactly_the_limit() {
        let dir = scratch("exact");
        let csv = vec![b'x'; MAX_CSV_BYTES];
        write_file(&dir.join("a.csv"), FileKind::Csv, &csv).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_content_that_does_not_match_the_kind() {
        let dir = scratch("mismatch");
        assert!(matches!(
            write_file(&dir.join("a.pdf"), FileKind::Pdf, b"Name;Seiten"),
            Err(SaveError::InvalidRequest)
        ));
        assert!(matches!(
            write_file(&dir.join("a.csv"), FileKind::Csv, PDF),
            Err(SaveError::InvalidRequest)
        ));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reports_io_errors() {
        let dir = scratch("missing");
        let result = write_file(&dir.join("fehlt").join("a.csv"), FileKind::Csv, b"a");
        assert!(matches!(result, Err(SaveError::Io { .. })));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn derives_a_safe_default_file_name() {
        assert_eq!(file_name(FileKind::Csv, "Klasse 8b"), "Klasse 8b.csv");
        assert_eq!(file_name(FileKind::Csv, "Klasse.csv"), "Klasse.csv");
        assert_eq!(file_name(FileKind::Csv, "Klasse.CSV"), "Klasse.csv");
        assert_eq!(file_name(FileKind::Pdf, "Klasse 8b"), "Klasse 8b.pdf");
        assert_eq!(file_name(FileKind::Pdf, "Anna.pdf"), "Anna.pdf");
        assert_eq!(file_name(FileKind::Pdf, "Anna.csv"), "Anna.csv.pdf");
        assert_eq!(
            file_name(FileKind::Csv, "../../etc/passwd"),
            "....etcpasswd.csv"
        );
        assert_eq!(file_name(FileKind::Pdf, "a:b*c?"), "abc.pdf");
        assert_eq!(file_name(FileKind::Pdf, "  "), "Rotstift.pdf");
        assert_eq!(file_name(FileKind::Csv, "..."), "Rotstift.csv");
        assert_eq!(file_name(FileKind::Pdf, ".pdf"), "Rotstift.pdf");
        assert_eq!(file_name(FileKind::Pdf, "Müller, Jörg"), "Müller, Jörg.pdf");
        assert_eq!(file_name(FileKind::Pdf, "äöü"), "äöü.pdf");
    }

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(
            decode_name("Anna%20M%C3%BCller").as_deref(),
            Some("Anna Müller")
        );
        assert_eq!(decode_name("Klasse%208b").as_deref(), Some("Klasse 8b"));
        assert_eq!(decode_name("").as_deref(), Some(""));
        assert_eq!(decode_name("%E2%82").as_deref(), None);
        assert_eq!(decode_name("100%").as_deref(), None);
        assert_eq!(decode_name("%zz").as_deref(), None);
    }

    #[test]
    fn parses_the_request_metadata() {
        let (kind, name) = parse_metadata(Some("pdf"), Some("Anna%20M%C3%BCller")).unwrap();
        assert_eq!(kind, FileKind::Pdf);
        assert_eq!(name, "Anna Müller");
        assert_eq!(parse_metadata(Some("csv"), None).unwrap().1, "");
        for bad in [None, Some(""), Some("exe"), Some("PDF")] {
            assert!(matches!(
                parse_metadata(bad, Some("x")),
                Err(SaveError::InvalidRequest)
            ));
        }
        assert!(matches!(
            parse_metadata(Some("pdf"), Some("%zz")),
            Err(SaveError::InvalidRequest)
        ));
    }
}
