use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::download::{DownloadError, hex_digest, part_path};
use super::registry::{ModelEntry, ModelFile};

const COPY_BUFFER: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: Vec<String>,
    pub unmatched: Vec<String>,
}

fn copy_verified(
    source: &Path,
    target: &Path,
    file: &ModelFile,
    dir: &Path,
) -> Result<bool, DownloadError> {
    let part = part_path(dir, file);
    let mut reader = std::fs::File::open(source)?;
    let mut writer = std::fs::File::create(&part)?;
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
    drop(writer);
    if hex_digest(hasher) == file.sha256 {
        std::fs::rename(&part, target)?;
        Ok(true)
    } else {
        std::fs::remove_file(&part)?;
        Ok(false)
    }
}

pub fn import_files(
    dir: &Path,
    entry: &ModelEntry,
    sources: &[PathBuf],
) -> Result<ImportOutcome, DownloadError> {
    std::fs::create_dir_all(dir)?;
    let mut outcome = ImportOutcome::default();
    for source in sources {
        let label = source
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        let size = std::fs::metadata(source)?.len();
        let candidate = entry
            .file_list()
            .into_iter()
            .find(|file| file.bytes == size);
        let imported = match candidate {
            Some(file) => {
                copy_verified(source, &dir.join(&file.name), file, dir)?.then(|| file.name.clone())
            }
            None => None,
        };
        match imported {
            Some(name) => outcome.imported.push(name),
            None => outcome.unmatched.push(label),
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::registry::{ModelFiles, RequestParams, ServerParams};

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
            display_name: "T".into(),
            license: "MIT".into(),
            recommended_ram_gb: 8,
            files: ModelFiles {
                model: file("model.gguf", b"model bytes"),
                mmproj: file("mmproj.gguf", b"projector"),
            },
            server: ServerParams {
                context_size: 4096,
                image_max_tokens: None,
                threads: None,
                gpu_layers: None,
            },
            request: RequestParams {
                max_output_tokens: 1024,
                temperature: 0.0,
                image_max_edge: 1024,
            },
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
        assert!(!target.join("model.gguf.part").exists());
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
        assert_eq!(outcome.unmatched, ["fake.gguf", "other.gguf"]);
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
    }
}
