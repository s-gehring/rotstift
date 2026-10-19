use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Url;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use super::download::{DownloadError, Downloader, FreeSpace, Progress, hex_digest, part_path};
use super::manager::{DownloadEvent, ModelManager, State, Update};
use super::registry::{
    ModelEntry, ModelFile, ModelFiles, RequestParams, ServerParams, url_allowed,
};

#[derive(Clone, Default)]
struct Behavior {
    ignore_range: bool,
    cut_after: Option<usize>,
    chunk_delay: Option<Duration>,
    redirect_to: Option<String>,
    extra_bytes: usize,
}

struct TestServer {
    port: u16,
    ranges: Arc<Mutex<Vec<Option<String>>>>,
}

impl TestServer {
    async fn start(files: &[(&str, Vec<u8>)], behavior: Behavior) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let bodies: HashMap<String, Vec<u8>> = files
            .iter()
            .map(|(name, body)| (format!("/{name}"), body.clone()))
            .collect();
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&ranges);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let (bodies, behavior, seen) =
                    (bodies.clone(), behavior.clone(), Arc::clone(&seen));
                tokio::spawn(async move {
                    let _ = serve(stream, &bodies, &behavior, &seen).await;
                });
            }
        });
        Self { port, ranges }
    }

    fn url(&self, name: &str) -> String {
        format!("http://127.0.0.1:{}/{name}", self.port)
    }

    fn requests(&self) -> Vec<Option<String>> {
        self.ranges.lock().unwrap().clone()
    }
}

async fn serve(
    mut stream: TcpStream,
    bodies: &HashMap<String, Vec<u8>>,
    behavior: &Behavior,
    seen: &Mutex<Vec<Option<String>>>,
) -> std::io::Result<()> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).await? == 0 {
            return Ok(());
        }
        head.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&head).into_owned();
    let path = text.split_whitespace().nth(1).unwrap_or("/").to_owned();
    let range = text.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("range")
            .then(|| value.trim().to_owned())
    });
    seen.lock().unwrap().push(range.clone());

    if let Some(target) = &behavior.redirect_to {
        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        return stream.write_all(response.as_bytes()).await;
    }
    let Some(body) = bodies.get(&path) else {
        return stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
    };
    let start = range
        .as_deref()
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.strip_suffix('-'))
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|_| !behavior.ignore_range);
    let mut payload = body.clone();
    payload.extend(std::iter::repeat_n(0u8, behavior.extra_bytes));
    let header = match start {
        Some(start) => format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            payload.len() - 1,
            payload.len(),
            payload.len() - start
        ),
        None => format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            payload.len()
        ),
    };
    stream.write_all(header.as_bytes()).await?;
    let content = &payload[start.unwrap_or(0)..];
    let limit = behavior
        .cut_after
        .unwrap_or(content.len())
        .min(content.len());
    for chunk in content[..limit].chunks(32 * 1024) {
        stream.write_all(chunk).await?;
        stream.flush().await?;
        if let Some(delay) = behavior.chunk_delay {
            tokio::time::sleep(delay).await;
        }
    }
    stream.shutdown().await
}

fn content(seed: u8, length: usize) -> Vec<u8> {
    let mut state = u32::from(seed) + 1;
    (0..length)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 24) as u8
        })
        .collect()
}

fn sha(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_digest(hasher)
}

fn file(server: &TestServer, name: &str, body: &[u8]) -> ModelFile {
    ModelFile {
        name: name.into(),
        url: server.url(name),
        sha256: sha(body),
        bytes: body.len() as u64,
    }
}

fn temp_dir(name: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "rotstift-download-{name}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn local_only(url: &Url) -> bool {
    url.host_str() == Some("127.0.0.1")
}

fn plenty() -> FreeSpace {
    Arc::new(|_| None)
}

fn downloader() -> Downloader {
    Downloader::with_policy(local_only, plenty()).unwrap()
}

fn no_cancel() -> watch::Receiver<bool> {
    watch::channel(false).1
}

fn ignore(_: Progress) {}

const MODEL: usize = 300_000;
const PROJECTOR: usize = 70_000;

#[tokio::test]
async fn downloads_all_files_and_reports_progress() {
    let (model, projector) = (content(1, MODEL), content(2, PROJECTOR));
    let server = TestServer::start(
        &[("m.gguf", model.clone()), ("p.gguf", projector.clone())],
        Behavior::default(),
    )
    .await;
    let files = [
        file(&server, "m.gguf", &model),
        file(&server, "p.gguf", &projector),
    ];
    let dir = temp_dir("all");
    let last = Mutex::new(None);
    let sink = |progress: Progress| *last.lock().unwrap() = Some(progress);
    downloader()
        .download(&[&files[0], &files[1]], &dir, &no_cancel(), &sink)
        .await
        .unwrap();
    assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), model);
    assert_eq!(std::fs::read(dir.join("p.gguf")).unwrap(), projector);
    assert!(!part_path(&dir, &files[0]).exists());
    let last = last.lock().unwrap().unwrap();
    assert_eq!(last.downloaded_bytes, (MODEL + PROJECTOR) as u64);
    assert_eq!(last.total_bytes, (MODEL + PROJECTOR) as u64);
}

#[tokio::test]
async fn skips_files_that_are_already_complete() {
    let body = content(3, MODEL);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("skip");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("m.gguf"), &body).unwrap();
    downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap();
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn resumes_a_partial_download_with_a_range_request() {
    let body = content(4, MODEL);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("resume");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(part_path(&dir, &model), &body[..100_000]).unwrap();
    downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap();
    assert_eq!(server.requests(), [Some("bytes=100000-".to_owned())]);
    assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), body);
}

#[tokio::test]
async fn restarts_when_the_server_ignores_the_range() {
    let body = content(5, MODEL);
    let behavior = Behavior {
        ignore_range: true,
        ..Behavior::default()
    };
    let server = TestServer::start(&[("m.gguf", body.clone())], behavior).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("ignore-range");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(part_path(&dir, &model), &body[..100_000]).unwrap();
    downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap();
    assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), body);
}

#[tokio::test]
async fn an_interrupted_download_keeps_its_partial_file_and_resumes_later() {
    let body = content(6, MODEL);
    let cutting = Behavior {
        cut_after: Some(120_000),
        ..Behavior::default()
    };
    let broken = TestServer::start(&[("m.gguf", body.clone())], cutting).await;
    let model = file(&broken, "m.gguf", &body);
    let dir = temp_dir("interrupted");
    let error = downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert!(
        matches!(error, DownloadError::Network(_) | DownloadError::Incomplete),
        "{error:?}"
    );
    let partial = std::fs::metadata(part_path(&dir, &model)).unwrap().len();
    assert!(partial > 0 && partial < MODEL as u64);
    assert!(!dir.join("m.gguf").exists());

    let healthy = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&healthy, "m.gguf", &body);
    downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap();
    assert_eq!(healthy.requests(), [Some(format!("bytes={partial}-"))]);
    assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), body);
}

#[tokio::test]
async fn a_wrong_hash_deletes_the_download_and_never_installs_it() {
    let body = content(7, MODEL);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let mut model = file(&server, "m.gguf", &body);
    model.sha256 = sha(b"something else");
    let dir = temp_dir("hash");
    let error = downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        DownloadError::HashMismatch {
            file: "m.gguf".into()
        }
    );
    assert!(!dir.join("m.gguf").exists());
    assert!(!part_path(&dir, &model).exists());
}

#[tokio::test]
async fn a_corrupt_partial_file_fails_the_hash_check_on_resume() {
    let body = content(8, MODEL);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("corrupt-part");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(part_path(&dir, &model), vec![0u8; 100_000]).unwrap();
    let error = downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        DownloadError::HashMismatch {
            file: "m.gguf".into()
        }
    );
    assert!(!dir.join("m.gguf").exists());
    assert!(!part_path(&dir, &model).exists());
}

#[tokio::test]
async fn rejects_servers_that_send_more_than_the_registry_size() {
    let body = content(9, MODEL);
    let behavior = Behavior {
        extra_bytes: 1000,
        ..Behavior::default()
    };
    let server = TestServer::start(&[("m.gguf", body.clone())], behavior).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("oversized");
    let error = downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        DownloadError::SizeMismatch {
            file: "m.gguf".into()
        }
    );
    assert!(!dir.join("m.gguf").exists());
}

#[tokio::test]
async fn reports_http_errors() {
    let server = TestServer::start(&[], Behavior::default()).await;
    let model = file(&server, "missing.gguf", b"x");
    let error = downloader()
        .download(&[&model], &temp_dir("404"), &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(error, DownloadError::Http { status: 404 });
}

#[tokio::test]
async fn cancelling_stops_the_transfer_and_keeps_the_partial_file() {
    let body = content(10, 2_000_000);
    let slow = Behavior {
        chunk_delay: Some(Duration::from_millis(20)),
        ..Behavior::default()
    };
    let server = TestServer::start(&[("m.gguf", body.clone())], slow).await;
    let model = file(&server, "m.gguf", &body);
    let dir = temp_dir("cancel");
    let (cancel, receiver) = watch::channel(false);
    let sink = |progress: Progress| {
        if progress.downloaded_bytes > 0 {
            cancel.send(true).unwrap();
        }
    };
    let error = downloader()
        .download(&[&model], &dir, &receiver, &sink)
        .await
        .unwrap_err();
    assert_eq!(error, DownloadError::Cancelled);
    assert!(!dir.join("m.gguf").exists());
    let partial = std::fs::metadata(part_path(&dir, &model)).unwrap().len();
    assert!(partial > 0 && partial < body.len() as u64);
}

#[tokio::test]
async fn refuses_urls_outside_the_allowed_hosts_without_any_request() {
    let body = content(11, 1000);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&server, "m.gguf", &body);
    let production = Downloader::with_policy(url_allowed, plenty()).unwrap();
    let dir = temp_dir("host");
    let error = production
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(error, DownloadError::NotAllowed("m.gguf".into()));
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn refuses_redirects_to_hosts_that_are_not_allowed() {
    let body = content(12, 1000);
    let target = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let redirecting = Behavior {
        redirect_to: Some(format!("http://localhost:{}/m.gguf", target.port)),
        ..Behavior::default()
    };
    let origin = TestServer::start(&[], redirecting).await;
    let model = file(&origin, "m.gguf", &body);
    let error = downloader()
        .download(&[&model], &temp_dir("redirect"), &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert_eq!(error, DownloadError::NotAllowed("redirect".into()));
    assert!(target.requests().is_empty());
}

#[tokio::test]
async fn follows_redirects_between_allowed_hosts() {
    let body = content(13, 5000);
    let target = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let redirecting = Behavior {
        redirect_to: Some(target.url("m.gguf")),
        ..Behavior::default()
    };
    let origin = TestServer::start(&[], redirecting).await;
    let model = file(&origin, "m.gguf", &body);
    let dir = temp_dir("follow");
    downloader()
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap();
    assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), body);
}

#[tokio::test]
async fn checks_free_disk_space_before_downloading() {
    let body = content(14, MODEL);
    let server = TestServer::start(&[("m.gguf", body.clone())], Behavior::default()).await;
    let model = file(&server, "m.gguf", &body);
    let scarce: FreeSpace = Arc::new(|_| Some(1024 * 1024));
    let low = Downloader::with_policy(local_only, scarce).unwrap();
    let dir = temp_dir("disk");
    let error = low
        .download(&[&model], &dir, &no_cancel(), &ignore)
        .await
        .unwrap_err();
    assert!(
        matches!(error, DownloadError::InsufficientDisk { available: 1_048_576, needed } if needed > MODEL as u64),
        "{error:?}"
    );
    assert!(server.requests().is_empty());
    assert!(!part_path(&dir, &model).exists());
}

fn leaked_entry(model: ModelFile, mmproj: ModelFile) -> &'static ModelEntry {
    Box::leak(Box::new(ModelEntry {
        id: "test-model".into(),
        display_name: "Test".into(),
        license: "MIT".into(),
        recommended_ram_gb: 8,
        files: ModelFiles { model, mmproj },
        server: ServerParams {
            context_size: 4096,
            image_max_tokens: None,
            threads: None,
            gpu_layers: None,
        },
        request: RequestParams {
            max_output_tokens: 512,
            temperature: 0.0,
            image_max_edge: 512,
        },
        prompt: "p".into(),
    }))
}

async fn next_final(events: &mut tokio::sync::mpsc::UnboundedReceiver<DownloadEvent>) -> Update {
    loop {
        let event = tokio::time::timeout(Duration::from_secs(20), events.recv())
            .await
            .expect("no final event")
            .unwrap();
        if !matches!(event.update, Update::Progress(_)) {
            return event.update;
        }
    }
}

#[tokio::test]
async fn the_manager_tracks_status_through_download_cancel_and_delete() {
    let (model, projector) = (content(15, 600_000), content(16, PROJECTOR));
    let slow = Behavior {
        chunk_delay: Some(Duration::from_millis(15)),
        ..Behavior::default()
    };
    let server = TestServer::start(
        &[("m.gguf", model.clone()), ("p.gguf", projector.clone())],
        slow,
    )
    .await;
    let entry = leaked_entry(
        file(&server, "m.gguf", &model),
        file(&server, "p.gguf", &projector),
    );
    let dir = temp_dir("manager");
    let manager = Arc::new(ModelManager::with_downloader(downloader()));
    assert_eq!(manager.status(&dir, entry).await.state, State::Missing);

    let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
    let emit = move |event: DownloadEvent| {
        let _ = sender.send(event);
    };
    manager
        .start(&dir, entry, Arc::new(emit.clone()))
        .await
        .unwrap();
    assert_eq!(
        manager.start(&dir, entry, Arc::new(emit.clone())).await,
        Err(DownloadError::Busy)
    );
    assert_eq!(manager.status(&dir, entry).await.state, State::Downloading);
    assert_eq!(manager.delete(&dir, entry).await, Err(DownloadError::Busy));
    assert!(manager.cancel("test-model"));
    assert_eq!(next_final(&mut events).await, Update::Cancelled);
    let status = manager.status(&dir, entry).await;
    assert_eq!(status.state, State::Missing);
    assert!(status.downloaded_bytes < status.total_bytes);

    manager.start(&dir, entry, Arc::new(emit)).await.unwrap();
    assert_eq!(next_final(&mut events).await, Update::Done);
    let status = manager.status(&dir, entry).await;
    assert_eq!(status.state, State::Ready);
    assert_eq!(status.downloaded_bytes, status.total_bytes);

    std::fs::write(dir.join("p.gguf"), b"truncated").unwrap();
    assert_eq!(manager.status(&dir, entry).await.state, State::Corrupt);

    manager.delete(&dir, entry).await.unwrap();
    let status = manager.status(&dir, entry).await;
    assert_eq!((status.state, status.downloaded_bytes), (State::Missing, 0));
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
}

#[tokio::test]
async fn the_manager_reports_failures_as_events() {
    let body = content(17, 5000);
    let server = TestServer::start(
        &[("m.gguf", body.clone()), ("p.gguf", body.clone())],
        Behavior::default(),
    )
    .await;
    let mut wrong = file(&server, "p.gguf", &body);
    wrong.sha256 = sha(b"nope");
    let entry = leaked_entry(file(&server, "m.gguf", &body), wrong);
    let dir = temp_dir("manager-fail");
    let manager = Arc::new(ModelManager::with_downloader(downloader()));
    let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
    let emit = move |event: DownloadEvent| {
        let _ = sender.send(event);
    };
    manager.start(&dir, entry, Arc::new(emit)).await.unwrap();
    assert_eq!(
        next_final(&mut events).await,
        Update::Failed {
            error: DownloadError::HashMismatch {
                file: "p.gguf".into()
            }
        }
    );
    assert!(!manager.is_downloading("test-model"));
}

#[test]
fn events_and_errors_serialize_in_the_shape_the_frontend_reads() {
    let progress = DownloadEvent {
        model_id: "m".into(),
        update: Update::Progress(Progress {
            downloaded_bytes: 5,
            total_bytes: 10,
        }),
    };
    assert_eq!(
        serde_json::to_value(progress).unwrap(),
        serde_json::json!({ "modelId": "m", "state": "progress", "downloadedBytes": 5, "totalBytes": 10 })
    );
    let failed = DownloadEvent {
        model_id: "m".into(),
        update: Update::Failed {
            error: DownloadError::InsufficientDisk {
                needed: 2,
                available: 1,
            },
        },
    };
    assert_eq!(
        serde_json::to_value(failed).unwrap(),
        serde_json::json!({
            "modelId": "m",
            "state": "failed",
            "error": { "kind": "insufficientDisk", "detail": { "needed": 2, "available": 1 } },
        })
    );
    assert_eq!(
        serde_json::to_value(DownloadError::Incomplete).unwrap(),
        serde_json::json!({ "kind": "incomplete" })
    );
    assert_eq!(
        serde_json::to_value(DownloadError::HashMismatch { file: "a".into() }).unwrap(),
        serde_json::json!({ "kind": "hashMismatch", "detail": { "file": "a" } })
    );
}

#[tokio::test]
#[ignore = "downloads the projector file (about 445 MB) from Hugging Face"]
async fn downloads_and_resumes_from_hugging_face() {
    let registry = super::registry::registry().unwrap();
    let file = &registry.models[0].files.mmproj;
    let dir = temp_dir("real");
    let downloader = Downloader::new().unwrap();

    let (cancel, receiver) = watch::channel(false);
    let sink = |progress: Progress| {
        if progress.downloaded_bytes > 30_000_000 {
            cancel.send(true).unwrap();
        }
    };
    let error = downloader
        .download(&[file], &dir, &receiver, &sink)
        .await
        .unwrap_err();
    assert_eq!(error, DownloadError::Cancelled);
    let partial = std::fs::metadata(part_path(&dir, file)).unwrap().len();
    assert!(partial > 30_000_000 && partial < file.bytes);

    let resumed_from = Mutex::new(None);
    let sink = |progress: Progress| {
        resumed_from
            .lock()
            .unwrap()
            .get_or_insert(progress.downloaded_bytes);
    };
    downloader
        .download(&[file], &dir, &no_cancel(), &sink)
        .await
        .unwrap();
    assert_eq!(resumed_from.lock().unwrap().unwrap(), partial);
    assert_eq!(
        std::fs::metadata(dir.join(&file.name)).unwrap().len(),
        file.bytes
    );
    let _ = std::fs::remove_dir_all(&dir);
}
