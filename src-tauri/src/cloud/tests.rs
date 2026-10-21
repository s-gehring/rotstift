use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::config::Config;
use super::keys::fake::MemoryStore;
use super::send::{Policy, Sender};
use super::*;

#[derive(Clone)]
struct Reply {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: String,
    delay: Duration,
}

fn ok_reply() -> Reply {
    Reply {
        status: 200,
        headers: Vec::new(),
        body: json!({
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": { "role": "assistant", "content": "{\"ok\": true}" },
            }],
        })
        .to_string(),
        delay: Duration::ZERO,
    }
}

fn status_reply(status: u16) -> Reply {
    Reply {
        status,
        body: "{\"error\":\"echo of the request\"}".into(),
        ..ok_reply()
    }
}

struct Mock {
    address: SocketAddr,
    hits: Arc<AtomicUsize>,
    bodies: Arc<Mutex<Vec<Value>>>,
}

async fn mock(replies: Vec<Reply>) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let (counter, seen) = (hits.clone(), bodies.clone());
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let index = counter.fetch_add(1, Ordering::SeqCst);
            let reply = replies
                .get(index)
                .or(replies.last())
                .cloned()
                .unwrap_or_else(ok_reply);
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut data = Vec::new();
                let mut buffer = [0u8; 8192];
                loop {
                    let Ok(read) = socket.read(&mut buffer).await else {
                        return;
                    };
                    if read == 0 {
                        return;
                    }
                    data.extend_from_slice(&buffer[..read]);
                    let text = String::from_utf8_lossy(&data).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if data.len() >= end + 4 + length {
                            let body = &data[end + 4..end + 4 + length];
                            if let Ok(value) = serde_json::from_slice(body) {
                                seen.lock().unwrap().push(value);
                            }
                            break;
                        }
                    }
                }
                tokio::time::sleep(reply.delay).await;
                let mut head = format!(
                    "HTTP/1.1 {} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
                    reply.status,
                    reply.body.len()
                );
                for (name, value) in &reply.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str("\r\n");
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(reply.body.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    Mock {
        address,
        hits,
        bodies,
    }
}

const LAN: &str = "http://10.255.255.1:8080/v1";

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "rotstift-cloud-{name}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn state(name: &str, mock: &Mock, policy: Policy) -> CloudState {
    let mut sender = Sender::new(policy);
    sender.route_to = Some(mock.address);
    CloudState::with_sender(
        temp_dir(name),
        Keys::with_store(Arc::new(MemoryStore::default())),
        sender,
    )
}

fn fast() -> Policy {
    Policy {
        connect_timeout: Duration::from_secs(2),
        timeout: Duration::from_secs(5),
        delays: [Duration::ZERO, Duration::ZERO],
        max_retry_after: Duration::from_secs(30),
    }
}

fn text_request() -> Value {
    json!({ "messages": [{ "role": "user", "content": "Ein geheimer Schülersatz." }], "seed": 3, "logprobs": true, "max_tokens": 50 })
}

fn class(result: Result<Value, CloudError>) -> ErrorClass {
    result.unwrap_err().class()
}

#[tokio::test]
async fn nothing_is_sent_without_a_confirmed_choice() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("consent", &mock, fast());

    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::NotConfigured
    );
    assert_eq!(
        cloud
            .use_step(Step::Corrector, "server", LAN, "m", None, false)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ConsentMissing
    );
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::NotConfigured
    );

    cloud
        .use_step(Step::Transcriber, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::NotConfigured
    );

    let mut config = Config::load(&cloud.config_path);
    let mut moved = config.steps[&Step::Transcriber].clone();
    moved.base_url = "http://10.255.255.2:8080/v1".into();
    config.steps.insert(Step::Corrector, moved);
    config.save(&cloud.config_path).unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::ConsentMissing
    );

    cloud.clear(Step::Transcriber).await.unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Transcriber, text_request()).await),
        ErrorClass::NotConfigured
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_confirmed_step_sends_only_the_allowed_fields() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("send", &mock, fast());
    let view = cloud
        .use_step(Step::Corrector, "server", LAN, "llama", None, true)
        .await
        .unwrap();
    let step = &view.steps[&Step::Corrector];
    assert!(step.confirmed);
    assert!(!step.loopback);
    assert_eq!(step.label, "10.255.255.1");

    cloud
        .chat(None, Step::Corrector, text_request())
        .await
        .unwrap();
    let bodies = mock.bodies.lock().unwrap();
    assert_eq!(
        bodies[0],
        json!({
            "messages": [{ "role": "user", "content": "Ein geheimer Schülersatz." }],
            "max_tokens": 50,
            "model": "llama",
        })
    );
}

#[tokio::test]
async fn loopback_needs_no_consent() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("loopback", &mock, fast());
    let url = format!("http://localhost:{}/v1", mock.address.port());
    let view = cloud
        .use_step(Step::Reviewer, "server", &url, "m", None, false)
        .await
        .unwrap();
    assert!(view.steps[&Step::Reviewer].loopback);
    assert!(view.steps[&Step::Reviewer].confirmed);
    cloud.check(Step::Reviewer).await.unwrap();
    assert_eq!(mock.hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn images_only_go_out_for_the_transcriber_and_keys_never_over_http() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("images", &mock, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    let image = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } },
        { "type": "text", "text": "Lies." },
    ] }] });
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, image).await),
        ErrorClass::InvalidRequest
    );
    assert_eq!(
        cloud
            .use_step(
                Step::Corrector,
                "server",
                LAN,
                "m",
                Some("sk-fake".into()),
                true
            )
            .await
            .unwrap_err()
            .class(),
        ErrorClass::Insecure
    );
    assert_eq!(
        cloud
            .use_step(
                Step::Corrector,
                "mistral",
                "https://evil.example/v1",
                "m",
                Some("k".into()),
                true
            )
            .await
            .unwrap_err()
            .class(),
        ErrorClass::InvalidAddress
    );
    assert_eq!(
        cloud
            .use_step(
                Step::Corrector,
                "mistral",
                "https://api.mistral.ai/v1",
                "m",
                None,
                true
            )
            .await
            .unwrap_err()
            .class(),
        ErrorClass::KeyMissing
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn retries_only_transient_failures() {
    let transient = mock(vec![status_reply(503), status_reply(502), ok_reply()]).await;
    let cloud = state("retry", &transient, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    cloud
        .chat(None, Step::Corrector, text_request())
        .await
        .unwrap();
    assert_eq!(transient.hits.load(Ordering::SeqCst), 3);

    let rejected = mock(vec![status_reply(401)]).await;
    let cloud = state("retry-auth", &rejected, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::Auth
    );
    assert_eq!(rejected.hits.load(Ordering::SeqCst), 1);

    let long_wait = mock(vec![Reply {
        headers: vec![("retry-after", "120".into())],
        ..status_reply(429)
    }])
    .await;
    let cloud = state("retry-after", &long_wait, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::RateLimited
    );
    assert_eq!(long_wait.hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn redirects_are_not_followed() {
    let target = mock(vec![ok_reply()]).await;
    let redirecting = mock(vec![Reply {
        headers: vec![(
            "location",
            format!("http://{}/v1/chat/completions", target.address),
        )],
        ..status_reply(307)
    }])
    .await;
    let cloud = state("redirect", &redirecting, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::Server
    );
    assert_eq!(target.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn oversized_slow_and_cancelled_answers_fail_cleanly() {
    let huge = mock(vec![Reply {
        body: "x".repeat(3 * 1024 * 1024),
        ..ok_reply()
    }])
    .await;
    let cloud = state("huge", &huge, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::InvalidResponse
    );

    let slow = mock(vec![Reply {
        delay: Duration::from_secs(3),
        ..ok_reply()
    }])
    .await;
    let cloud = Arc::new(state(
        "slow",
        &slow,
        Policy {
            timeout: Duration::from_millis(300),
            ..fast()
        },
    ));
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, text_request()).await),
        ErrorClass::Timeout
    );

    let waiting = mock(vec![Reply {
        delay: Duration::from_secs(3),
        ..ok_reply()
    }])
    .await;
    let cloud = Arc::new(state("cancel", &waiting, fast()));
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true)
        .await
        .unwrap();
    let running = cloud.clone();
    let call = tokio::spawn(async move {
        running
            .chat(Some("r1".into()), Step::Corrector, text_request())
            .await
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(cloud.cancel("r1"));
    assert_eq!(class(call.await.unwrap()), ErrorClass::Cancelled);
    assert!(!cloud.cancel("r2"));
    assert_eq!(
        class(
            cloud
                .chat(Some("r2".into()), Step::Corrector, text_request())
                .await
        ),
        ErrorClass::Cancelled
    );
}

#[tokio::test]
async fn clearing_the_last_step_of_an_address_forgets_its_key() {
    let mock = mock(vec![ok_reply()]).await;
    let store = Arc::new(MemoryStore::default());
    let mut sender = Sender::new(fast());
    sender.route_to = Some(mock.address);
    let cloud =
        CloudState::with_sender(temp_dir("forget"), Keys::with_store(store.clone()), sender);
    let url = "https://api.mistral.ai/v1";
    cloud
        .use_step(
            Step::Corrector,
            "mistral",
            url,
            "m",
            Some(" sk-fake ".into()),
            true,
        )
        .await
        .unwrap();
    let view = cloud
        .use_step(Step::Reviewer, "mistral", url, "m", None, true)
        .await
        .unwrap();
    assert_eq!(
        view.steps[&Step::Reviewer].key,
        Some(keys::KeyStore::System)
    );
    assert_eq!(view.steps[&Step::Reviewer].label, "Mistral AI");
    let account = keys::account(url);
    assert_eq!(
        store
            .secrets
            .lock()
            .unwrap()
            .get(&account)
            .map(String::as_str),
        Some("sk-fake")
    );
    cloud.clear(Step::Corrector).await.unwrap();
    assert!(store.secrets.lock().unwrap().contains_key(&account));
    cloud.clear(Step::Reviewer).await.unwrap();
    assert!(store.secrets.lock().unwrap().is_empty());
    let text = std::fs::read_to_string(&cloud.config_path).unwrap();
    assert!(!text.contains("sk-fake"));
}
