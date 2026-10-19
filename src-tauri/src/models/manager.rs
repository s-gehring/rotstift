use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tokio::fs;
use tokio::sync::watch;

use super::download::{DownloadError, Downloader, Progress, part_path};
use super::registry::{ModelEntry, ModelFile, registry};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Missing,
    Downloading,
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

struct Job {
    cancel: watch::Sender<bool>,
    progress: Arc<Mutex<Progress>>,
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
    }
    true
}

async fn inspect(dir: &Path, entry: &ModelEntry) -> ModelStatus {
    let mut present = 0;
    let mut corrupt = false;
    for file in entry.file_list() {
        match installed_bytes(dir, file).await {
            Some(len) if len == file.bytes => present += len,
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
        let running = self
            .jobs()
            .get(&entry.id)
            .map(|job| *job.progress.lock().unwrap_or_else(|p| p.into_inner()));
        match running {
            Some(progress) => ModelStatus {
                model_id: entry.id.clone(),
                state: State::Downloading,
                downloaded_bytes: progress.downloaded_bytes,
                total_bytes: progress.total_bytes,
            },
            None => inspect(dir, entry).await,
        }
    }

    pub fn is_downloading(&self, model_id: &str) -> bool {
        self.jobs().contains_key(model_id)
    }

    pub async fn start(
        self: &Arc<Self>,
        dir: &Path,
        entry: &'static ModelEntry,
        emit: Emitter,
    ) -> Result<(), DownloadError> {
        let files: Vec<&'static ModelFile> = entry.file_list().to_vec();
        let downloader = self.downloader()?;
        let (cancel, receiver) = watch::channel(false);
        let progress = Arc::new(Mutex::new(Progress {
            downloaded_bytes: 0,
            total_bytes: entry.total_bytes(),
        }));
        {
            let mut jobs = self.jobs();
            if jobs.contains_key(&entry.id) {
                return Err(DownloadError::Busy);
            }
            jobs.insert(
                entry.id.clone(),
                Job {
                    cancel,
                    progress: Arc::clone(&progress),
                },
            );
        }
        if let Err(error) = downloader.preflight(&files, dir).await {
            self.jobs().remove(&entry.id);
            return Err(error);
        }

        let manager = Arc::clone(self);
        let dir = dir.to_path_buf();
        tokio::spawn(async move {
            let sink = |update: Progress| {
                *progress.lock().unwrap_or_else(|p| p.into_inner()) = update;
                emit(DownloadEvent {
                    model_id: entry.id.clone(),
                    update: Update::Progress(update),
                });
            };
            let result = downloader.download(&files, &dir, &receiver, &sink).await;
            manager.jobs().remove(&entry.id);
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

    pub fn cancel(&self, model_id: &str) -> bool {
        self.jobs()
            .get(model_id)
            .is_some_and(|job| job.cancel.send(true).is_ok())
    }

    pub async fn delete(&self, dir: &Path, entry: &ModelEntry) -> Result<(), DownloadError> {
        if self.is_downloading(&entry.id) {
            return Err(DownloadError::Busy);
        }
        for file in entry.file_list() {
            for path in [dir.join(&file.name), part_path(dir, file)] {
                match fs::remove_file(&path).await {
                    Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                        return Err(error.into());
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }
}
