use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::watch;

use super::download::{DownloadError, hex_digest, seed_hasher};
use super::registry::ModelFile;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    sha256: String,
    bytes: u64,
    mtime_nanos: u64,
}

pub fn marker_path(dir: &Path, file: &ModelFile) -> PathBuf {
    dir.join(format!("{}.verified", file.name))
}

fn mtime_nanos(meta: &std::fs::Metadata) -> Option<u64> {
    let elapsed = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(elapsed.as_nanos()).ok()
}

fn current_marker(dir: &Path, file: &ModelFile) -> Option<Marker> {
    let meta = std::fs::metadata(dir.join(&file.name)).ok()?;
    Some(Marker {
        sha256: file.sha256.clone(),
        bytes: meta.len(),
        mtime_nanos: mtime_nanos(&meta)?,
    })
}

pub fn write_marker(dir: &Path, file: &ModelFile) -> Result<(), DownloadError> {
    let marker = current_marker(dir, file)
        .ok_or_else(|| DownloadError::Io(format!("cannot stat {}", file.name)))?;
    let text =
        serde_json::to_string(&marker).map_err(|error| DownloadError::Io(error.to_string()))?;
    std::fs::write(marker_path(dir, file), text)?;
    Ok(())
}

pub fn remove_marker(dir: &Path, file: &ModelFile) {
    let _ = std::fs::remove_file(marker_path(dir, file));
}

pub fn has_valid_marker(dir: &Path, file: &ModelFile) -> bool {
    let Some(expected) = current_marker(dir, file) else {
        return false;
    };
    if expected.bytes != file.bytes {
        return false;
    }
    std::fs::read_to_string(marker_path(dir, file))
        .ok()
        .and_then(|text| serde_json::from_str::<Marker>(&text).ok())
        .is_some_and(|stored| stored == expected)
}

pub async fn verify_installed(
    dir: &Path,
    file: &ModelFile,
    cancel: &mut watch::Receiver<bool>,
) -> Result<bool, DownloadError> {
    let target = dir.join(&file.name);
    if tokio::fs::metadata(&target)
        .await
        .map(|meta| meta.len())
        .ok()
        != Some(file.bytes)
    {
        return Ok(false);
    }
    let mut hasher = Sha256::new();
    seed_hasher(&target, &mut hasher, cancel).await?;
    if hex_digest(hasher) != file.sha256 {
        return Ok(false);
    }
    write_marker(dir, file)?;
    Ok(true)
}

pub async fn verify_uninterrupted(dir: &Path, file: &ModelFile) -> Result<bool, DownloadError> {
    let (_sender, mut receiver) = watch::channel(false);
    verify_installed(dir, file, &mut receiver).await
}
