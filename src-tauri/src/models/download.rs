use std::future::pending;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use reqwest::{Client, StatusCode, Url, redirect};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::sync::watch;

use super::registry::{ModelFile, url_allowed};
use super::verified::{has_valid_marker, remove_marker, verify_installed, write_marker};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const STALL_TIMEOUT: Duration = Duration::from_secs(45);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const MAX_REDIRECTS: usize = 8;
const DISK_RESERVE: u64 = 256 * 1024 * 1024;
const BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DownloadError {
    UnknownModel(String),
    Busy,
    InsufficientDisk { needed: u64, available: u64 },
    NotAllowed(String),
    Network(String),
    Http { status: u16 },
    Incomplete,
    SizeMismatch { file: String },
    HashMismatch { file: String },
    Io(String),
    Cancelled,
}

impl From<std::io::Error> for DownloadError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

pub type FreeSpace = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;
pub type ProgressSink<'a> = &'a (dyn Fn(Progress) + Send + Sync);
pub type UrlPolicy = fn(&Url) -> bool;

pub fn part_path(dir: &Path, file: &ModelFile) -> PathBuf {
    let version = file.sha256.get(..16).unwrap_or(&file.sha256);
    dir.join(format!("{}.{version}.part", file.name))
}

pub fn import_path(dir: &Path, file: &ModelFile) -> PathBuf {
    dir.join(format!("{}.import", file.name))
}

fn is_part_of(candidate: &str, file: &ModelFile) -> bool {
    candidate.strip_suffix(".part").is_some_and(|stem| {
        stem == file.name
            || stem
                .strip_prefix(file.name.as_str())
                .is_some_and(|rest| rest.starts_with('.'))
    })
}

pub fn remove_stale_parts(dir: &Path, file: &ModelFile, keep_current: bool) -> std::io::Result<()> {
    let current = part_path(dir, file);
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let is_part = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| is_part_of(name, file));
        if is_part && !(keep_current && path == current) {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

pub fn hex_digest(hasher: Sha256) -> String {
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .await
        .ok()
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if cancel.wait_for(|requested| *requested).await.is_err() {
        pending::<()>().await;
    }
}

fn network_error(error: reqwest::Error) -> DownloadError {
    if error.is_redirect() {
        DownloadError::NotAllowed("redirect".into())
    } else {
        DownloadError::Network(error.without_url().to_string())
    }
}

fn parse_content_range(value: &str) -> Option<(u64, u64)> {
    let range = value.trim().strip_prefix("bytes ")?;
    let (span, total) = range.split_once('/')?;
    let (start, _end) = span.split_once('-')?;
    Some((start.parse().ok()?, total.parse().ok()?))
}

struct Reporter<'a> {
    sink: ProgressSink<'a>,
    total: u64,
    last: Instant,
}

impl Reporter<'_> {
    fn report(&mut self, downloaded: u64, force: bool) {
        if force || self.last.elapsed() >= PROGRESS_INTERVAL {
            self.last = Instant::now();
            (self.sink)(Progress {
                downloaded_bytes: downloaded.min(self.total),
                total_bytes: self.total,
            });
        }
    }
}

pub struct Downloader {
    client: Client,
    allowed: UrlPolicy,
    free_space: FreeSpace,
}

impl Downloader {
    pub fn new() -> Result<Self, DownloadError> {
        Self::with_policy(url_allowed, Arc::new(super::system::free_space))
    }

    pub fn with_policy(allowed: UrlPolicy, free_space: FreeSpace) -> Result<Self, DownloadError> {
        let policy = redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("redirect to a host that is not allowed")
            }
        });
        let client = Client::builder()
            .redirect(policy)
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(concat!("rotstift/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| DownloadError::Network(error.to_string()))?;
        Ok(Self {
            client,
            allowed,
            free_space,
        })
    }

    pub async fn preflight(&self, files: &[&ModelFile], dir: &Path) -> Result<(), DownloadError> {
        for file in files {
            let allowed = Url::parse(&file.url).is_ok_and(|url| (self.allowed)(&url));
            if !allowed {
                return Err(DownloadError::NotAllowed(file.name.clone()));
            }
        }
        fs::create_dir_all(dir).await?;
        let mut needed = DISK_RESERVE;
        for file in files {
            if file_len(&dir.join(&file.name)).await == Some(file.bytes)
                && has_valid_marker(dir, file)
            {
                continue;
            }
            let partial = file_len(&part_path(dir, file)).await.unwrap_or(0);
            needed += file.bytes - if partial <= file.bytes { partial } else { 0 };
        }
        if let Some(available) = (self.free_space)(dir)
            && available < needed
        {
            return Err(DownloadError::InsufficientDisk { needed, available });
        }
        Ok(())
    }

    pub async fn download(
        &self,
        files: &[&ModelFile],
        dir: &Path,
        cancel: &watch::Receiver<bool>,
        sink: ProgressSink<'_>,
    ) -> Result<(), DownloadError> {
        self.preflight(files, dir).await?;
        let total: u64 = files.iter().map(|file| file.bytes).sum();
        let mut reporter = Reporter {
            sink,
            total,
            last: Instant::now()
                .checked_sub(PROGRESS_INTERVAL)
                .unwrap_or_else(Instant::now),
        };
        let mut cancel = cancel.clone();
        let mut finished = 0;
        for file in files {
            self.fetch(file, dir, &mut cancel, &mut reporter, finished)
                .await?;
            finished += file.bytes;
            reporter.report(finished, true);
        }
        Ok(())
    }

    async fn fetch(
        &self,
        file: &ModelFile,
        dir: &Path,
        cancel: &mut watch::Receiver<bool>,
        reporter: &mut Reporter<'_>,
        finished: u64,
    ) -> Result<(), DownloadError> {
        let target = dir.join(&file.name);
        match file_len(&target).await {
            Some(len) if len == file.bytes => {
                if has_valid_marker(dir, file) || verify_installed(dir, file, cancel).await? {
                    return Ok(());
                }
                remove_marker(dir, file);
                fs::remove_file(&target).await?;
            }
            Some(_) => {
                remove_marker(dir, file);
                fs::remove_file(&target).await?;
            }
            None => {}
        }
        fs::create_dir_all(dir).await?;
        remove_stale_parts(dir, file, true)?;

        let mut resumed = false;
        match self
            .stream(file, dir, cancel, reporter, finished, &mut resumed)
            .await
        {
            Err(DownloadError::HashMismatch { .. }) if resumed => {
                self.stream(file, dir, cancel, reporter, finished, &mut resumed)
                    .await?;
            }
            other => other?,
        }
        write_marker(dir, file)
    }

    async fn stream(
        &self,
        file: &ModelFile,
        dir: &Path,
        cancel: &mut watch::Receiver<bool>,
        reporter: &mut Reporter<'_>,
        finished: u64,
        resumed: &mut bool,
    ) -> Result<(), DownloadError> {
        let target = dir.join(&file.name);
        let part = part_path(dir, file);
        let mut offset = file_len(&part).await.unwrap_or(0);
        if offset > file.bytes {
            fs::remove_file(&part).await?;
            offset = 0;
        }
        let mut hasher = Sha256::new();
        if offset > 0 {
            reporter.report(finished + offset, true);
            seed_hasher(&part, &mut hasher, cancel).await?;
        }
        if offset < file.bytes {
            let mut response = self.open(file, offset, cancel).await?;
            if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && offset > 0 {
                fs::remove_file(&part).await?;
                offset = 0;
                hasher = Sha256::new();
                response = self.open(file, 0, cancel).await?;
            }
            if offset > 0 && response.status() == StatusCode::OK {
                offset = 0;
                hasher = Sha256::new();
            }
            check_response(file, &response, offset)?;

            let handle = if offset == 0 {
                File::create(&part).await?
            } else {
                OpenOptions::new().append(true).open(&part).await?
            };
            let mut writer = BufWriter::with_capacity(BUFFER_BYTES, handle);
            let mut written = offset;
            let streamed = loop {
                let chunk = tokio::select! {
                    biased;
                    () = cancelled(cancel) => break Err(DownloadError::Cancelled),
                    next = tokio::time::timeout(STALL_TIMEOUT, response.chunk()) => match next {
                        Err(_) => break Err(DownloadError::Network("timeout".into())),
                        Ok(Err(error)) => break Err(network_error(error)),
                        Ok(Ok(chunk)) => chunk,
                    },
                };
                let Some(chunk) = chunk else { break Ok(()) };
                written += chunk.len() as u64;
                if written > file.bytes {
                    drop(writer);
                    fs::remove_file(&part).await?;
                    return Err(DownloadError::SizeMismatch {
                        file: file.name.clone(),
                    });
                }
                hasher.update(&chunk);
                if let Err(error) = writer.write_all(&chunk).await {
                    break Err(error.into());
                }
                reporter.report(finished + written, false);
            };
            writer.flush().await?;
            writer.get_mut().sync_all().await?;
            drop(writer);
            streamed?;
            if written != file.bytes {
                return Err(DownloadError::Incomplete);
            }
        }

        *resumed = offset > 0;
        if hex_digest(hasher) != file.sha256 {
            fs::remove_file(&part).await?;
            return Err(DownloadError::HashMismatch {
                file: file.name.clone(),
            });
        }
        fs::rename(&part, &target).await?;
        Ok(())
    }

    async fn open(
        &self,
        file: &ModelFile,
        offset: u64,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<reqwest::Response, DownloadError> {
        let mut request = self.client.get(&file.url);
        if offset > 0 {
            request = request.header(RANGE, format!("bytes={offset}-"));
        }
        tokio::select! {
            biased;
            () = cancelled(cancel) => Err(DownloadError::Cancelled),
            sent = request.send() => sent.map_err(network_error),
        }
    }
}

fn check_response(
    file: &ModelFile,
    response: &reqwest::Response,
    offset: u64,
) -> Result<(), DownloadError> {
    let mismatch = || DownloadError::SizeMismatch {
        file: file.name.clone(),
    };
    match response.status() {
        StatusCode::PARTIAL_CONTENT => {
            let range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(parse_content_range);
            match range {
                Some((start, total)) if start == offset && total == file.bytes => Ok(()),
                _ => Err(mismatch()),
            }
        }
        StatusCode::OK => {
            let length = response
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            match length {
                Some(length) if length != file.bytes => Err(mismatch()),
                _ => Ok(()),
            }
        }
        status => Err(DownloadError::Http {
            status: status.as_u16(),
        }),
    }
}

pub(super) async fn seed_hasher(
    path: &Path,
    hasher: &mut Sha256,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), DownloadError> {
    hash_file(path, hasher, cancel, &mut |_| {}).await
}

pub(super) async fn hash_file(
    path: &Path,
    hasher: &mut Sha256,
    cancel: &mut watch::Receiver<bool>,
    on_read: &mut (dyn FnMut(u64) + Send),
) -> Result<(), DownloadError> {
    let mut reader = File::open(path).await?;
    let mut buffer = vec![0u8; BUFFER_BYTES];
    loop {
        if *cancel.borrow() {
            return Err(DownloadError::Cancelled);
        }
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
        on_read(read as u64);
    }
}
