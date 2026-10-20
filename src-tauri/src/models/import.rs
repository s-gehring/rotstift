use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::download::{DownloadError, hex_digest, import_path};
use super::registry::{ModelEntry, ModelFile};
use super::verified::write_marker;

const COPY_BUFFER: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnmatchedReason {
    UnknownFile,
    WrongContent,
    IoError,
    Duplicate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmatchedFile {
    pub name: String,
    pub reason: UnmatchedReason,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: Vec<String>,
    pub unmatched: Vec<UnmatchedFile>,
}

fn copy_to_temp(source: &Path, temp: &Path) -> std::io::Result<String> {
    let mut reader = std::fs::File::open(source)?;
    let mut writer = std::fs::File::create(temp)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer.write_all(&buffer[..read])?;
    }
    writer.sync_all()?;
    Ok(hex_digest(hasher))
}

fn copy_verified(source: &Path, file: &ModelFile, dir: &Path) -> Result<bool, DownloadError> {
    let temp = import_path(dir, file);
    let target = dir.join(&file.name);
    let result = copy_to_temp(source, &temp)
        .map_err(DownloadError::from)
        .and_then(|digest| {
            if digest != file.sha256 {
                return Ok(false);
            }
            std::fs::rename(&temp, &target)?;
            write_marker(dir, file)?;
            Ok(true)
        });
    if !matches!(result, Ok(true)) {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub fn import_files(
    dir: &Path,
    entry: &ModelEntry,
    sources: &[PathBuf],
) -> Result<ImportOutcome, DownloadError> {
    std::fs::create_dir_all(dir)?;
    let mut outcome = ImportOutcome::default();
    for source in sources {
        let name = source
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        let reject = |outcome: &mut ImportOutcome, reason| {
            outcome.unmatched.push(UnmatchedFile {
                name: name.clone(),
                reason,
            });
        };
        let Ok(meta) = std::fs::metadata(source) else {
            reject(&mut outcome, UnmatchedReason::IoError);
            continue;
        };
        let Some(file) = entry
            .file_list()
            .into_iter()
            .find(|file| file.bytes == meta.len())
        else {
            reject(&mut outcome, UnmatchedReason::UnknownFile);
            continue;
        };
        if outcome.imported.contains(&file.name) {
            reject(&mut outcome, UnmatchedReason::Duplicate);
            continue;
        }
        match copy_verified(source, file, dir) {
            Ok(true) => outcome.imported.push(file.name.clone()),
            Ok(false) => reject(&mut outcome, UnmatchedReason::WrongContent),
            Err(_) => reject(&mut outcome, UnmatchedReason::IoError),
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::registry::{ModelFiles, Reasoning, RequestParams, Role, ServerParams};
    use crate::models::verified::has_valid_marker;

    fn sha(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex_digest(hasher)
    }

    fn file(name: &str, content: &[u8]) -> ModelFile {
        ModelFile {
            name: name.into(),
            url: "https://huggingface.co/x".into(),
            sha256: sha(content),
            bytes: content.len() as u64,
        }
    }

    fn entry() -> ModelEntry {
        ModelEntry {
            id: "t".into(),
            role: Role::Transcriber,
            display_name: "T".into(),
            license: "MIT".into(),
            recommended_ram_gb: 8,
            files: ModelFiles {
                model: file("model.gguf", b"model bytes"),
                mmproj: Some(file("mmproj.gguf", b"projector")),
            },
            server: ServerParams {
                context_size: 4096,
                image_max_tokens: None,
                threads: None,
                gpu_layers: None,
                cpu_repack: true,
                reasoning: Reasoning::Auto,
            },
            request: RequestParams {
                max_output_tokens: 1024,
                temperature: 0.0,
                image_max_edge: Some(1024),
            },
            line_mode: None,
            system: None,
            prompt: "p".into(),
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rotstift-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(outcome: &ImportOutcome) -> Vec<(&str, UnmatchedReason)> {
        outcome
            .unmatched
            .iter()
            .map(|file| (file.name.as_str(), file.reason))
            .collect()
    }

    #[test]
    fn imports_files_that_match_the_registry_hashes() {
        let source = temp_dir("source");
        let target = temp_dir("target").join("models");
        std::fs::write(source.join("renamed-a.bin"), b"model bytes").unwrap();
        std::fs::write(source.join("renamed-b.bin"), b"projector").unwrap();
        let sources = [source.join("renamed-a.bin"), source.join("renamed-b.bin")];
        let outcome = import_files(&target, &entry(), &sources).unwrap();
        assert_eq!(outcome.imported, ["model.gguf", "mmproj.gguf"]);
        assert!(outcome.unmatched.is_empty());
        assert_eq!(
            std::fs::read(target.join("model.gguf")).unwrap(),
            b"model bytes"
        );
        assert!(!import_path(&target, &entry().files.model).exists());
        assert!(has_valid_marker(&target, &entry().files.model));
        assert!(has_valid_marker(
            &target,
            entry().files.mmproj.as_ref().unwrap()
        ));
    }

    #[test]
    fn rejects_same_sized_files_with_the_wrong_content() {
        let source = temp_dir("wrong-source");
        let target = temp_dir("wrong-target");
        std::fs::write(source.join("fake.gguf"), b"MODEL BYTES").unwrap();
        std::fs::write(source.join("other.gguf"), b"different size").unwrap();
        let sources = [source.join("fake.gguf"), source.join("other.gguf")];
        let outcome = import_files(&target, &entry(), &sources).unwrap();
        assert!(outcome.imported.is_empty());
        assert_eq!(
            names(&outcome),
            [
                ("fake.gguf", UnmatchedReason::WrongContent),
                ("other.gguf", UnmatchedReason::UnknownFile)
            ]
        );
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
    }

    #[test]
    fn an_unreadable_file_does_not_abort_the_other_imports() {
        let source = temp_dir("unreadable-source");
        let target = temp_dir("unreadable-target");
        std::fs::write(source.join("good.bin"), b"projector").unwrap();
        let sources = [source.join("gone.gguf"), source.join("good.bin")];
        let outcome = import_files(&target, &entry(), &sources).unwrap();
        assert_eq!(outcome.imported, ["mmproj.gguf"]);
        assert_eq!(names(&outcome), [("gone.gguf", UnmatchedReason::IoError)]);
    }

    #[test]
    fn removes_the_temporary_file_when_installing_fails() {
        let source = temp_dir("cleanup-source");
        let target = temp_dir("cleanup-target");
        std::fs::write(source.join("a.bin"), b"model bytes").unwrap();
        std::fs::create_dir_all(target.join("model.gguf")).unwrap();
        std::fs::write(target.join("model.gguf").join("blocker"), b"x").unwrap();
        let outcome = import_files(&target, &entry(), &[source.join("a.bin")]).unwrap();
        assert!(outcome.imported.is_empty());
        assert_eq!(names(&outcome), [("a.bin", UnmatchedReason::IoError)]);
        assert!(!import_path(&target, &entry().files.model).exists());
    }

    #[test]
    fn ignores_the_same_file_picked_twice() {
        let source = temp_dir("dup-source");
        let target = temp_dir("dup-target");
        std::fs::write(source.join("a.bin"), b"model bytes").unwrap();
        std::fs::write(source.join("b.bin"), b"model bytes").unwrap();
        let sources = [source.join("a.bin"), source.join("b.bin")];
        let outcome = import_files(&target, &entry(), &sources).unwrap();
        assert_eq!(outcome.imported, ["model.gguf"]);
        assert_eq!(names(&outcome), [("b.bin", UnmatchedReason::Duplicate)]);
    }
}
