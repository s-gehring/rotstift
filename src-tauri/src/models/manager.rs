use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tokio::fs;
use tokio::sync::watch;

use super::download::{
    DownloadError, Downloader, Progress, import_path, part_path, remove_stale_parts,
};
use super::import::{ImportOutcome, import_files};
use super::registry::{ModelEntry, ModelFile, registry};
use super::verified::{has_valid_marker, marker_path, remove_marker, verify_uninterrupted};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Missing,
    Downloading,
    Verifying,
    Importing,
    Deleting,
    Unverified,
    Ready,
    Corrupt,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub model_id: String,
    pub state: State,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Update {
    Progress(Progress),
    Done,
    Cancelled,
    Failed { error: DownloadError },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEvent {
    pub model_id: String,
    #[serde(flatten)]
    pub update: Update,
}

pub type Emitter = Arc<dyn Fn(DownloadEvent) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JobKind {
    Download,
    Verify,
    Import,
    Delete,
}

impl JobKind {
    fn state(self) -> State {
        match self {
            Self::Download => State::Downloading,
            Self::Verify => State::Verifying,
            Self::Import => State::Importing,
            Self::Delete => State::Deleting,
        }
    }
}

struct Job {
    kind: JobKind,
    cancel: watch::Sender<bool>,
    progress: Arc<Mutex<Progress>>,
}

struct Reservation {
    manager: Arc<ModelManager>,
    model_id: String,
    cancel: watch::Receiver<bool>,
    progress: Arc<Mutex<Progress>>,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        self.manager.jobs().remove(&self.model_id);
    }
}

pub struct ModelManager {
    jobs: Mutex<HashMap<String, Job>>,
    downloader: Mutex<Option<Arc<Downloader>>>,
}

impl Default for ModelManager {
    fn default() -> Self {
        Self::new()
    }
}

pub fn entry(model_id: &str) -> Result<&'static ModelEntry, DownloadError> {
    registry()
        .map_err(DownloadError::Io)?
        .find(model_id)
        .ok_or_else(|| DownloadError::UnknownModel(model_id.into()))
}

async fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .await
        .ok()
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
}

pub async fn installed_bytes(dir: &Path, file: &ModelFile) -> Option<u64> {
    file_len(&dir.join(&file.name)).await
}

pub async fn is_ready(dir: &Path, entry: &ModelEntry) -> bool {
    for file in entry.file_list() {
        if installed_bytes(dir, file).await != Some(file.bytes) {
            return false;
        }
        if !has_valid_marker(dir, file)
            && !matches!(verify_uninterrupted(dir, file).await, Ok(true))
        {
            return false;
        }
    }
    true
}

async fn inspect(dir: &Path, entry: &ModelEntry) -> ModelStatus {
    let mut present = 0;
    let mut corrupt = false;
    let mut unverified = false;
    for file in entry.file_list() {
        match installed_bytes(dir, file).await {
            Some(len) if len == file.bytes => {
                present += len;
                unverified |= !has_valid_marker(dir, file);
            }
            Some(_) => corrupt = true,
            None => {
                present += file_len(&part_path(dir, file))
                    .await
                    .map_or(0, |len| len.min(file.bytes));
            }
        }
    }
    let state = if corrupt {
        State::Corrupt
    } else if present == entry.total_bytes() && unverified {
        State::Unverified
    } else if present == entry.total_bytes() {
        State::Ready
    } else {
        State::Missing
    };
    ModelStatus {
        model_id: entry.id.clone(),
        state,
        downloaded_bytes: present,
        total_bytes: entry.total_bytes(),
    }
}

impl ModelManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            downloader: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn with_downloader(downloader: Downloader) -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            downloader: Mutex::new(Some(Arc::new(downloader))),
        }
    }

    fn downloader(&self) -> Result<Arc<Downloader>, DownloadError> {
        let mut slot = self
            .downloader
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(downloader) = slot.as_ref() {
            return Ok(Arc::clone(downloader));
        }
        let downloader = Arc::new(Downloader::new()?);
        *slot = Some(Arc::clone(&downloader));
        Ok(downloader)
    }

    fn jobs(&self) -> MutexGuard<'_, HashMap<String, Job>> {
        self.jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub async fn status(&self, dir: &Path, entry: &ModelEntry) -> ModelStatus {
        let running = self.jobs().get(&entry.id).map(|job| {
            (
                job.kind,
                *job.progress.lock().unwrap_or_else(|p| p.into_inner()),
            )
        });
        match running {
            Some((JobKind::Download, progress)) => ModelStatus {
                model_id: entry.id.clone(),
                state: State::Downloading,
                downloaded_bytes: progress.downloaded_bytes,
                total_bytes: progress.total_bytes,
            },
            Some((kind, progress)) => ModelStatus {
                model_id: entry.id.clone(),
                state: kind.state(),
                downloaded_bytes: 0,
                total_bytes: progress.total_bytes,
            },
            None => inspect(dir, entry).await,
        }
    }

    #[cfg(test)]
    pub fn running_state(&self, model_id: &str) -> Option<State> {
        self.jobs().get(model_id).map(|job| job.kind.state())
    }

    pub fn has_jobs(&self) -> bool {
        !self.jobs().is_empty()
    }

    pub fn is_busy(&self, model_id: &str) -> bool {
        self.jobs().contains_key(model_id)
    }

    pub async fn startable(&self, dir: &Path, entry: &ModelEntry) -> bool {
        !self.is_busy(&entry.id) && is_ready(dir, entry).await
    }

    fn reserve(
        self: &Arc<Self>,
        entry: &ModelEntry,
        kind: JobKind,
    ) -> Result<Reservation, DownloadError> {
        let (cancel, receiver) = watch::channel(false);
        let progress = Arc::new(Mutex::new(Progress {
            downloaded_bytes: 0,
            total_bytes: entry.total_bytes(),
        }));
        let mut jobs = self.jobs();
        if jobs.contains_key(&entry.id) {
            return Err(DownloadError::Busy);
        }
        jobs.insert(
            entry.id.clone(),
            Job {
                kind,
                cancel,
                progress: Arc::clone(&progress),
            },
        );
        Ok(Reservation {
            manager: Arc::clone(self),
            model_id: entry.id.clone(),
            cancel: receiver,
            progress,
        })
    }

    pub async fn start(
        self: &Arc<Self>,
        dir: &Path,
        entry: &'static ModelEntry,
        emit: Emitter,
    ) -> Result<(), DownloadError> {
        let files: Vec<&'static ModelFile> = entry.file_list().to_vec();
        let downloader = self.downloader()?;
        let reservation = self.reserve(entry, JobKind::Download)?;
        downloader.preflight(&files, dir).await?;

        let dir = dir.to_path_buf();
        tokio::spawn(async move {
            let progress = Arc::clone(&reservation.progress);
            let sink = |update: Progress| {
                *progress.lock().unwrap_or_else(|p| p.into_inner()) = update;
                emit(DownloadEvent {
                    model_id: entry.id.clone(),
                    update: Update::Progress(update),
                });
            };
            let result = downloader
                .download(&files, &dir, &reservation.cancel, &sink)
                .await;
            drop(reservation);
            let update = match result {
                Ok(()) => Update::Done,
                Err(DownloadError::Cancelled) => Update::Cancelled,
                Err(error) => Update::Failed { error },
            };
            emit(DownloadEvent {
                model_id: entry.id.clone(),
                update,
            });
        });
        Ok(())
    }

    pub async fn verify(
        self: &Arc<Self>,
        dir: &Path,
        entry: &'static ModelEntry,
    ) -> Result<ModelStatus, DownloadError> {
        let _reservation = self.reserve(entry, JobKind::Verify)?;
        for file in entry.file_list() {
            let complete = installed_bytes(dir, file).await == Some(file.bytes);
            if complete && !has_valid_marker(dir, file) && !verify_uninterrupted(dir, file).await? {
                remove_marker(dir, file);
                fs::remove_file(dir.join(&file.name)).await?;
            }
        }
        Ok(inspect(dir, entry).await)
    }

    pub async fn import(
        self: &Arc<Self>,
        dir: &Path,
        entry: &'static ModelEntry,
        sources: Vec<PathBuf>,
        before_import: impl FnOnce(),
    ) -> Result<ImportOutcome, DownloadError> {
        let reservation = self.reserve(entry, JobKind::Import)?;
        before_import();
        let dir = dir.to_path_buf();
        let outcome = tokio::task::spawn_blocking(move || import_files(&dir, entry, &sources))
            .await
            .map_err(|error| DownloadError::Io(error.to_string()))?;
        drop(reservation);
        outcome
    }

    pub fn cancel(&self, model_id: &str) -> bool {
        self.jobs()
            .get(model_id)
            .is_some_and(|job| job.kind == JobKind::Download && job.cancel.send(true).is_ok())
    }

    pub async fn delete(
        self: &Arc<Self>,
        dir: &Path,
        entry: &'static ModelEntry,
        before_delete: impl FnOnce(),
    ) -> Result<(), DownloadError> {
        let _reservation = self.reserve(entry, JobKind::Delete)?;
        before_delete();
        for file in entry.file_list() {
            for path in [
                dir.join(&file.name),
                marker_path(dir, file),
                import_path(dir, file),
            ] {
                match fs::remove_file(&path).await {
                    Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                        return Err(error.into());
                    }
                    _ => {}
                }
            }
            match remove_stale_parts(dir, file, false) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(error.into());
                }
                _ => {}
            }
        }
        Ok(())
    }
}
