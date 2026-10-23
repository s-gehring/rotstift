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
    heads: Arc<Mutex<Vec<String>>>,
}

async fn mock(replies: Vec<Reply>) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let heads = Arc::new(Mutex::new(Vec::new()));
    let (counter, seen, seen_heads) = (hits.clone(), bodies.clone(), heads.clone());
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
            let seen_heads = seen_heads.clone();
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
                            seen_heads
                                .lock()
                                .unwrap()
                                .push(text[..end].to_ascii_lowercase());
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
        heads,
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
    json!({ "messages": [{ "role": "user", "content": "Ein geheimer Schülersatz." }], "seed": 3, "repeat_penalty": 1.1, "logprobs": true, "max_tokens": 50 })
}

fn class(result: Result<Value, CloudError>) -> ErrorClass {
    result.unwrap_err().class()
}

#[tokio::test]
async fn nothing_is_sent_without_a_confirmed_choice() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("consent", &mock, fast());

    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );
    assert_eq!(
        cloud
            .use_step(
                Step::Corrector,
                "server",
                LAN,
                "m",
                None,
                false,
                None,
                false
            )
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ConsentMissing
    );
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );

    cloud
        .use_step(
            Step::Transcriber,
            "server",
            LAN,
            "m",
            None,
            true,
            None,
            false,
        )
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );

    let mut config = Config::load(&cloud.config_path);
    let mut moved = config.steps[&Step::Transcriber].clone();
    moved.base_url = "http://10.255.255.2:8080/v1".into();
    config.steps.insert(Step::Corrector, moved);
    config.save(&cloud.config_path).unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::ConsentMissing
    );

    cloud.clear(Step::Transcriber).await.unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Transcriber, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_confirmed_step_sends_only_the_allowed_fields() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("send", &mock, fast());
    let view = cloud
        .use_step(
            Step::Corrector,
            "server",
            LAN,
            "llama",
            None,
            true,
            None,
            false,
        )
        .await
        .unwrap();
    let step = &view.steps[&Step::Corrector];
    assert!(step.confirmed);
    assert!(!step.loopback);
    assert_eq!(step.label, "10.255.255.1");

    cloud
        .chat(None, Step::Corrector, text_request(), true)
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
        .use_step(
            Step::Reviewer,
            "server",
            &url,
            "m",
            None,
            false,
            None,
            false,
        )
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    let image = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } },
        { "type": "text", "text": "Lies." },
    ] }] });
    assert_eq!(
        class(cloud.chat(None, Step::Corrector, image, true).await),
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
                true,
                None,
                false,
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
                true,
                None,
                false,
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
                true,
                None,
                false
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    cloud
        .chat(None, Step::Corrector, text_request(), true)
        .await
        .unwrap();
    assert_eq!(transient.hits.load(Ordering::SeqCst), 3);

    let rejected = mock(vec![status_reply(401)]).await;
    let cloud = state("retry-auth", &rejected, fast());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
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
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::Timeout
    );

    let waiting = mock(vec![Reply {
        delay: Duration::from_secs(3),
        ..ok_reply()
    }])
    .await;
    let cloud = Arc::new(state("cancel", &waiting, fast()));
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    let running = cloud.clone();
    let call = tokio::spawn(async move {
        running
            .chat(Some("r1".into()), Step::Corrector, text_request(), true)
            .await
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(cloud.cancel("r1"));
    assert_eq!(class(call.await.unwrap()), ErrorClass::Cancelled);
    assert!(!cloud.cancel("r2"));
    assert_eq!(
        class(
            cloud
                .chat(Some("r2".into()), Step::Corrector, text_request(), true)
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
            None,
            false,
        )
        .await
        .unwrap();
    let view = cloud
        .use_step(Step::Reviewer, "mistral", url, "m", None, true, None, false)
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

const ANTHROPIC: &str = "https://api.anthropic.com/v1";

fn anthropic_reply(text: &str) -> Reply {
    Reply {
        body: json!({
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-test",
            "content": [{ "type": "text", "text": text }],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 7, "output_tokens": 2 },
        })
        .to_string(),
        ..ok_reply()
    }
}

async fn anthropic_state(name: &str, mock: &Mock, step: Step) -> CloudState {
    let cloud = state(name, mock, fast());
    cloud
        .use_step(
            step,
            "anthropic",
            ANTHROPIC,
            "claude-test",
            Some("sk-ant-fake".into()),
            true,
            Some(false),
            true,
        )
        .await
        .unwrap();
    cloud
}

#[tokio::test]
async fn anthropic_text_goes_through_the_messages_api() {
    let mock = mock(vec![anthropic_reply("Das ist korrekt.")]).await;
    let cloud = anthropic_state("ant-text", &mock, Step::Corrector).await;
    let request = json!({
        "messages": [
            { "role": "system", "content": "Du korrigierst." },
            { "role": "user", "content": "Ein geheimer Schülersatz." },
        ],
        "temperature": 0,
        "seed": 3,
        "stop": ["###"],
        "max_tokens": 50,
    });
    let answer = cloud
        .chat(None, Step::Corrector, request, true)
        .await
        .unwrap();
    assert_eq!(
        answer,
        json!({
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": { "role": "assistant", "content": "Das ist korrekt." },
            }],
            "usage": { "prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9 },
        })
    );
    assert_eq!(
        mock.bodies.lock().unwrap()[0],
        json!({
            "model": "claude-test",
            "max_tokens": 50,
            "system": "Du korrigierst.",
            "stop_sequences": ["###"],
            "messages": [{ "role": "user", "content": "Ein geheimer Schülersatz." }],
        })
    );
    let head = mock.heads.lock().unwrap()[0].clone();
    assert!(head.starts_with("post /v1/messages "), "{head}");
    assert!(head.contains("x-api-key: sk-ant-fake"));
    assert!(head.contains("anthropic-version: 2023-06-01"));
    assert!(!head.contains("authorization"));
}

#[tokio::test]
async fn anthropic_images_and_schemas_are_translated_and_tokens_default_per_step() {
    let mock = mock(vec![anthropic_reply("Haus")]).await;
    let cloud = anthropic_state("ant-image", &mock, Step::Transcriber).await;
    let image = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/AAAA" } },
        { "type": "text", "text": "Lies." },
    ] }] });
    cloud
        .chat(None, Step::Transcriber, image, true)
        .await
        .unwrap();
    assert_eq!(
        mock.bodies.lock().unwrap()[0],
        json!({
            "model": "claude-test",
            "max_tokens": 4096,
            "messages": [{ "role": "user", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "/9j/AAAA" } },
                { "type": "text", "text": "Lies." },
            ] }],
        })
    );

    let mock = mock_reviewer().await;
    let cloud = anthropic_state("ant-schema", &mock, Step::Reviewer).await;
    let request = json!({
        "messages": [{ "role": "user", "content": "Frage?" }],
        "response_format": { "type": "json_schema", "json_schema": {
            "name": "antwort",
            "schema": {
                "type": "object",
                "properties": { "score": { "type": "integer", "minimum": 0, "maximum": 3 } },
                "required": ["score"],
                "additionalProperties": false,
            },
        } },
    });
    let answer = cloud
        .chat(None, Step::Reviewer, request, true)
        .await
        .unwrap();
    assert_eq!(
        answer
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        Some("{\"score\": 2}")
    );
    let body = mock.bodies.lock().unwrap()[0].clone();
    assert_eq!(body["max_tokens"], 512);
    assert_eq!(
        body["output_config"],
        json!({ "format": { "type": "json_schema", "schema": {
            "type": "object",
            "properties": { "score": { "type": "integer" } },
            "required": ["score"],
            "additionalProperties": false,
        } } })
    );
    assert!(body.get("response_format").is_none());
}

async fn mock_reviewer() -> Mock {
    mock(vec![anthropic_reply("{\"score\": 2}")]).await
}

#[tokio::test]
async fn anthropic_check_accepts_a_schema_answer() {
    let mock = mock(vec![anthropic_reply("{\"ok\": true}")]).await;
    let cloud = anthropic_state("ant-check", &mock, Step::Reviewer).await;
    cloud.check(Step::Reviewer).await.unwrap();
    assert_eq!(mock.hits.load(Ordering::SeqCst), 1);
    let mock = self::mock(vec![anthropic_reply("kein json")]).await;
    let cloud = anthropic_state("ant-check-bad", &mock, Step::Reviewer).await;
    assert_eq!(
        cloud.check(Step::Reviewer).await.unwrap_err().class(),
        ErrorClass::InvalidResponse
    );
}

#[tokio::test]
async fn anthropic_failures_map_to_the_shared_error_classes() {
    let rejected = mock(vec![status_reply(401)]).await;
    let cloud = anthropic_state("ant-401", &rejected, Step::Corrector).await;
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::Auth
    );
    assert_eq!(rejected.hits.load(Ordering::SeqCst), 1);

    let limited = mock(vec![
        Reply {
            headers: vec![("retry-after", "0".into())],
            ..status_reply(429)
        },
        anthropic_reply("ok"),
    ])
    .await;
    let cloud = anthropic_state("ant-429", &limited, Step::Corrector).await;
    cloud
        .chat(None, Step::Corrector, text_request(), true)
        .await
        .unwrap();
    assert_eq!(limited.hits.load(Ordering::SeqCst), 2);

    let long_wait = mock(vec![Reply {
        headers: vec![("retry-after", "120".into())],
        ..status_reply(429)
    }])
    .await;
    let cloud = anthropic_state("ant-429-long", &long_wait, Step::Corrector).await;
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::RateLimited
    );
    assert_eq!(long_wait.hits.load(Ordering::SeqCst), 1);

    let overloaded = mock(vec![status_reply(529), anthropic_reply("ok")]).await;
    let cloud = anthropic_state("ant-529", &overloaded, Step::Corrector).await;
    cloud
        .chat(None, Step::Corrector, text_request(), true)
        .await
        .unwrap();
    assert_eq!(overloaded.hits.load(Ordering::SeqCst), 2);

    let broken = mock(vec![status_reply(500)]).await;
    let cloud = anthropic_state("ant-500", &broken, Step::Corrector).await;
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::Server
    );
    assert_eq!(broken.hits.load(Ordering::SeqCst), 3);

    let garbled = mock(vec![ok_reply()]).await;
    let cloud = anthropic_state("ant-garbled", &garbled, Step::Corrector).await;
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::InvalidResponse
    );
}

#[tokio::test]
async fn an_anthropic_request_can_be_cancelled() {
    let waiting = mock(vec![Reply {
        delay: Duration::from_secs(3),
        ..anthropic_reply("spät")
    }])
    .await;
    let cloud = Arc::new(anthropic_state("ant-cancel", &waiting, Step::Corrector).await);
    let running = cloud.clone();
    let call = tokio::spawn(async move {
        running
            .chat(Some("a1".into()), Step::Corrector, text_request(), true)
            .await
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(cloud.cancel("a1"));
    assert_eq!(class(call.await.unwrap()), ErrorClass::Cancelled);
}

#[tokio::test]
async fn nothing_is_sent_to_anthropic_without_consent() {
    let mock = mock(vec![anthropic_reply("x")]).await;
    let cloud = state("ant-consent", &mock, fast());
    let attempt = cloud
        .use_step(
            Step::Corrector,
            "anthropic",
            ANTHROPIC,
            "claude-test",
            Some("sk-ant-fake".into()),
            false,
            None,
            false,
        )
        .await;
    assert_eq!(attempt.unwrap_err().class(), ErrorClass::ConsentMissing);
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );

    let mut config = Config::default();
    config.steps.insert(
        Step::Corrector,
        config::Choice {
            template: "anthropic".into(),
            base_url: ANTHROPIC.into(),
            model: "claude-test".into(),
            consent: None,
            protection: None,
            protection_consent: None,
        },
    );
    config.save(&cloud.config_path).unwrap();
    cloud
        .keys
        .set(&keys::account(ANTHROPIC), "sk-ant-fake")
        .await;
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::ConsentMissing
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn the_model_list_is_read_page_by_page_with_the_typed_key() {
    let page = |ids: &[&str], more: bool| {
        Reply {
        body: json!({
            "data": ids.iter().map(|id| json!({ "id": id, "display_name": format!("Name {id}"), "type": "model" })).collect::<Vec<_>>(),
            "has_more": more,
            "first_id": ids.first(),
            "last_id": ids.last(),
        })
        .to_string(),
        ..ok_reply()
    }
    };
    let mock = mock(vec![page(&["m-1", "m-2"], true), page(&["m-3"], false)]).await;
    let cloud = state("ant-models", &mock, fast());
    let models = cloud
        .models("anthropic", ANTHROPIC, Some(" sk-ant-fake ".into()))
        .await
        .unwrap();
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["m-1", "m-2", "m-3"]
    );
    assert_eq!(models[0].display_name, "Name m-1");
    assert!(cloud.keys.get(&keys::account(ANTHROPIC)).await.is_none());
    let heads = mock.heads.lock().unwrap();
    assert!(
        heads[0].starts_with("get /v1/models?limit=1000 "),
        "{}",
        heads[0]
    );
    assert!(
        heads[1].starts_with("get /v1/models?limit=1000&after_id=m-2 "),
        "{}",
        heads[1]
    );
    assert!(heads[0].contains("x-api-key: sk-ant-fake"));
    assert!(heads[0].contains("anthropic-version: 2023-06-01"));
    assert!(mock.bodies.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_model_list_reports_errors_and_is_limited_to_anthropic() {
    let rejected = mock(vec![status_reply(401)]).await;
    let cloud = state("ant-models-401", &rejected, fast());
    assert_eq!(
        cloud
            .models("anthropic", ANTHROPIC, Some("sk-ant-wrong".into()))
            .await
            .unwrap_err()
            .class(),
        ErrorClass::Auth
    );
    assert_eq!(
        cloud
            .models("anthropic", ANTHROPIC, None)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::KeyMissing
    );
    assert_eq!(
        cloud
            .models("mistral", "https://api.mistral.ai/v1", Some("k".into()))
            .await
            .unwrap_err()
            .class(),
        ErrorClass::InvalidRequest
    );
    assert_eq!(
        cloud
            .models("anthropic", "https://evil.example/v1", Some("k".into()))
            .await
            .unwrap_err()
            .class(),
        ErrorClass::InvalidAddress
    );
    assert_eq!(rejected.hits.load(Ordering::SeqCst), 1);
}

const MISTRAL: &str = "https://api.mistral.ai/v1";

async fn mistral(cloud: &CloudState, step: Step, protection: Option<bool>, confirmed: bool) {
    cloud
        .use_step(
            step,
            "mistral",
            MISTRAL,
            "m",
            Some("sk-fake".into()),
            true,
            protection,
            confirmed,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn text_steps_need_the_pseudonymized_flag_while_protection_is_on() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("flag", &mock, fast());
    mistral(&cloud, Step::Corrector, None, false).await;
    assert!(cloud.view().await.steps[&Step::Corrector].protection);

    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), false)
                .await
        ),
        ErrorClass::NotPseudonymized
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
    cloud
        .chat(None, Step::Corrector, text_request(), true)
        .await
        .unwrap();
    assert_eq!(mock.hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn the_transcriber_is_refused_while_protection_is_on() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("transcriber", &mock, fast());
    for protection in [None, Some(true)] {
        let refused = cloud
            .use_step(
                Step::Transcriber,
                "mistral",
                MISTRAL,
                "m",
                Some("sk-fake".into()),
                true,
                protection,
                true,
            )
            .await
            .unwrap_err();
        assert_eq!(refused.class(), ErrorClass::ProtectionActive);
    }
    assert!(cloud.view().await.steps.is_empty());

    let missing = cloud
        .use_step(
            Step::Transcriber,
            "mistral",
            MISTRAL,
            "m",
            Some("sk-fake".into()),
            true,
            Some(false),
            false,
        )
        .await
        .unwrap_err();
    assert_eq!(missing.class(), ErrorClass::ProtectionConsentMissing);
    assert!(cloud.view().await.steps.is_empty());

    mistral(&cloud, Step::Transcriber, Some(false), true).await;
    assert!(!cloud.view().await.steps[&Step::Transcriber].protection);
    let image = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } },
        { "type": "text", "text": "Lies." },
    ] }] });
    cloud
        .chat(None, Step::Transcriber, image.clone(), false)
        .await
        .unwrap();

    cloud
        .set_protection(Step::Transcriber, true, false)
        .await
        .unwrap();
    assert_eq!(
        class(cloud.chat(None, Step::Transcriber, image, true).await),
        ErrorClass::ProtectionActive
    );
    assert_eq!(mock.hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn switching_protection_off_needs_its_own_confirmation_every_time() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("switch", &mock, fast());
    mistral(&cloud, Step::Corrector, None, false).await;

    assert_eq!(
        cloud
            .set_protection(Step::Corrector, false, false)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ProtectionConsentMissing
    );
    assert!(cloud.view().await.steps[&Step::Corrector].protection);

    let view = cloud
        .set_protection(Step::Corrector, false, true)
        .await
        .unwrap();
    assert!(!view.steps[&Step::Corrector].protection);
    cloud
        .chat(None, Step::Corrector, text_request(), false)
        .await
        .unwrap();

    let view = cloud
        .set_protection(Step::Corrector, true, false)
        .await
        .unwrap();
    assert!(view.steps[&Step::Corrector].protection);
    assert_eq!(
        cloud
            .set_protection(Step::Corrector, false, false)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ProtectionConsentMissing
    );

    assert_eq!(
        cloud
            .set_protection(Step::Reviewer, false, true)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::NotConfigured
    );
}

#[tokio::test]
async fn reselecting_the_same_host_keeps_a_valid_protection_consent() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("reselect", &mock, fast());
    mistral(&cloud, Step::Corrector, Some(false), true).await;
    mistral(&cloud, Step::Corrector, Some(false), false).await;
    assert!(!cloud.view().await.steps[&Step::Corrector].protection);
    mistral(&cloud, Step::Corrector, Some(true), false).await;
    assert_eq!(
        cloud
            .use_step(
                Step::Corrector,
                "mistral",
                MISTRAL,
                "m",
                None,
                false,
                Some(false),
                false,
            )
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ProtectionConsentMissing
    );
}

#[tokio::test]
async fn an_outdated_or_foreign_protection_consent_counts_as_protected() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("outdated", &mock, fast());
    mistral(&cloud, Step::Corrector, Some(false), true).await;
    let stored = std::fs::read_to_string(&cloud.config_path).unwrap();
    assert!(stored.contains("\"protection\": false"));

    let tamper: [fn(&mut config::Consent); 2] = [
        |consent| consent.version = 0,
        |consent| consent.host = "other.example".into(),
    ];
    for tamper in tamper {
        let mut config = Config::load(&cloud.config_path);
        let choice = config.steps.get_mut(&Step::Corrector).unwrap();
        tamper(choice.protection_consent.as_mut().unwrap());
        config.save(&cloud.config_path).unwrap();
        assert!(cloud.view().await.steps[&Step::Corrector].protection);
        assert_eq!(
            class(
                cloud
                    .chat(None, Step::Corrector, text_request(), false)
                    .await
            ),
            ErrorClass::NotPseudonymized
        );
        mistral(&cloud, Step::Corrector, Some(false), true).await;
    }
    assert_eq!(mock.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn own_servers_and_loopback_run_without_protection_by_default() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("server-default", &mock, fast());
    let local = format!("http://localhost:{}/v1", mock.address.port());
    cloud
        .use_step(Step::Corrector, "server", LAN, "m", None, true, None, false)
        .await
        .unwrap();
    cloud
        .use_step(
            Step::Reviewer,
            "custom",
            &local,
            "m",
            None,
            false,
            None,
            false,
        )
        .await
        .unwrap();
    cloud
        .use_step(
            Step::Transcriber,
            "server",
            LAN,
            "m",
            None,
            true,
            None,
            false,
        )
        .await
        .unwrap();
    let view = cloud.view().await;
    assert!(view.steps.values().all(|step| !step.protection));
    for step in [Step::Corrector, Step::Reviewer, Step::Transcriber] {
        cloud.chat(None, step, text_request(), false).await.unwrap();
    }

    let view = cloud
        .set_protection(Step::Corrector, true, false)
        .await
        .unwrap();
    assert!(view.steps[&Step::Corrector].protection);
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), false)
                .await
        ),
        ErrorClass::NotPseudonymized
    );
    let view = cloud
        .set_protection(Step::Corrector, false, false)
        .await
        .unwrap();
    assert!(!view.steps[&Step::Corrector].protection);
}

#[tokio::test]
async fn a_cloud_json_without_the_field_migrates_to_protection_on() {
    let mock = mock(vec![ok_reply()]).await;
    let cloud = state("migrate", &mock, fast());
    let consent = |host: &str| json!({ "host": host, "version": 1, "atMs": 1 });
    let local = format!("http://127.0.0.1:{}/v1", mock.address.port());
    let old = json!({ "steps": {
        "transcriber": { "template": "mistral", "baseUrl": MISTRAL, "model": "m", "consent": consent("api.mistral.ai") },
        "corrector": { "template": "custom", "baseUrl": "https://ki.example/v1", "model": "m", "consent": consent("ki.example") },
        "reviewer": { "template": "server", "baseUrl": LAN, "model": "m", "consent": consent("10.255.255.1") },
    } });
    std::fs::write(&cloud.config_path, old.to_string()).unwrap();
    cloud.keys.set(&keys::account(MISTRAL), "sk-fake").await;
    cloud
        .keys
        .set(&keys::account("https://ki.example/v1"), "sk-fake")
        .await;

    let view = cloud.view().await;
    assert!(view.steps[&Step::Transcriber].protection);
    assert!(view.steps[&Step::Corrector].protection);
    assert!(!view.steps[&Step::Reviewer].protection);
    let image = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } },
    ] }] });
    assert_eq!(
        class(cloud.chat(None, Step::Transcriber, image, true).await),
        ErrorClass::ProtectionActive
    );
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), false)
                .await
        ),
        ErrorClass::NotPseudonymized
    );
    cloud
        .chat(None, Step::Reviewer, text_request(), false)
        .await
        .unwrap();
    assert_eq!(mock.hits.load(Ordering::SeqCst), 1);

    let loopback = json!({ "steps": { "corrector": {
        "template": "custom", "baseUrl": local, "model": "m", "consent": null,
    } } });
    std::fs::write(&cloud.config_path, loopback.to_string()).unwrap();
    assert!(!cloud.view().await.steps[&Step::Corrector].protection);
}
