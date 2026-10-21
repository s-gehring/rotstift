use std::net::SocketAddr;
use std::time::Duration;

use reqwest::{Client, ClientBuilder, StatusCode, header, redirect};
use serde_json::Value;

use super::ErrorClass;
use super::anthropic;
use super::endpoint::Endpoint;
use super::templates::Api;

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Policy {
    pub connect_timeout: Duration,
    pub timeout: Duration,
    pub delays: [Duration; 2],
    pub max_retry_after: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(10),
            timeout: Duration::from_secs(180),
            delays: [Duration::from_secs(1), Duration::from_secs(4)],
            max_retry_after: Duration::from_secs(30),
        }
    }
}

#[derive(Clone, Copy)]
pub enum Job<'a> {
    Chat(&'a Value),
    Models { after: Option<&'a str> },
}

pub struct Outcome {
    pub result: Result<Value, ErrorClass>,
    pub attempts: u32,
    pub status: Option<u16>,
}

pub struct Sender {
    policy: Policy,
    shared: Option<Client>,
    #[cfg(test)]
    pub route_to: Option<SocketAddr>,
}

struct Failure {
    class: ErrorClass,
    status: Option<u16>,
    retry_after: Option<Duration>,
}

fn builder(policy: &Policy) -> ClientBuilder {
    let builder = Client::builder()
        .connect_timeout(policy.connect_timeout)
        .timeout(policy.timeout)
        .redirect(redirect::Policy::none());
    dev_roots(builder)
}

#[cfg(debug_assertions)]
fn dev_roots(builder: ClientBuilder) -> ClientBuilder {
    let Some(pem) = std::env::var_os("ROTSTIFT_DEV_CA").and_then(|path| std::fs::read(path).ok())
    else {
        return builder;
    };
    match reqwest::Certificate::from_pem(&pem) {
        Ok(certificate) => builder.tls_certs_merge([certificate]),
        Err(_) => builder,
    }
}

#[cfg(not(debug_assertions))]
fn dev_roots(builder: ClientBuilder) -> ClientBuilder {
    builder
}

fn classify(status: StatusCode) -> ErrorClass {
    match status.as_u16() {
        401 | 403 => ErrorClass::Auth,
        404 => ErrorClass::NotFound,
        408 => ErrorClass::Timeout,
        413 => ErrorClass::TooLarge,
        429 => ErrorClass::RateLimited,
        400..=499 => ErrorClass::BadRequest,
        _ => ErrorClass::Server,
    }
}

fn retryable(status: Option<u16>, class: ErrorClass) -> bool {
    match status {
        Some(code) => matches!(code, 408 | 429 | 500 | 502 | 503 | 504 | 529),
        None => class == ErrorClass::Network,
    }
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn transport(error: &reqwest::Error) -> ErrorClass {
    if error.is_timeout() {
        ErrorClass::Timeout
    } else {
        ErrorClass::Network
    }
}

async fn read_limited(mut response: reqwest::Response) -> Result<Vec<u8>, ErrorClass> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| transport(&e))? {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(ErrorClass::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn completion(api: Api, body: &[u8]) -> Result<Value, ErrorClass> {
    let value: Value = serde_json::from_slice(body).map_err(|_| ErrorClass::InvalidResponse)?;
    if api == Api::Anthropic {
        return anthropic::response(&value);
    }
    let has_message = value
        .pointer("/choices/0/message")
        .is_some_and(Value::is_object);
    if has_message {
        Ok(value)
    } else {
        Err(ErrorClass::InvalidResponse)
    }
}

impl Sender {
    pub fn new(policy: Policy) -> Self {
        let shared = builder(&policy).build().ok();
        Self {
            policy,
            shared,
            #[cfg(test)]
            route_to: None,
        }
    }

    fn client(&self, endpoint: &Endpoint, pinned: &[SocketAddr]) -> Result<Client, ErrorClass> {
        if pinned.is_empty() {
            return self.shared.clone().ok_or(ErrorClass::Network);
        }
        builder(&self.policy)
            .resolve_to_addrs(&endpoint.host, pinned)
            .build()
            .map_err(|_| ErrorClass::Network)
    }

    async fn attempt(
        &self,
        client: &Client,
        endpoint: &Endpoint,
        key: Option<&str>,
        job: Job<'_>,
    ) -> Result<Value, Failure> {
        #[cfg_attr(not(test), allow(unused_mut))]
        let mut url = match job {
            Job::Chat(_) => endpoint.chat_url(),
            Job::Models { after } => {
                let mut url = endpoint.models_url();
                {
                    let mut query = url.query_pairs_mut();
                    query.append_pair("limit", &anthropic::MODELS_PAGE_SIZE.to_string());
                    if let Some(after) = after {
                        query.append_pair("after_id", after);
                    }
                }
                url
            }
        };
        #[cfg(test)]
        if let Some(address) = self.route_to {
            url.set_scheme("http").ok();
            url.set_ip_host(address.ip()).ok();
            url.set_port(Some(address.port())).ok();
        }
        let mut request = match job {
            Job::Chat(body) => client.post(url).json(body),
            Job::Models { .. } => client.get(url),
        };
        if let Some(key) = key {
            request = match endpoint.api {
                Api::Openai => request.bearer_auth(key),
                Api::Anthropic => request
                    .header("x-api-key", key)
                    .header("anthropic-version", anthropic::VERSION),
            };
        }
        let response = request.send().await.map_err(|error| Failure {
            class: transport(&error),
            status: None,
            retry_after: None,
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(Failure {
                class: classify(status),
                status: Some(status.as_u16()),
                retry_after: retry_after(&response),
            });
        }
        let failed = |class| Failure {
            class,
            status: Some(status.as_u16()),
            retry_after: None,
        };
        let bytes = read_limited(response).await.map_err(failed)?;
        match job {
            Job::Chat(_) => completion(endpoint.api, &bytes),
            Job::Models { .. } => {
                serde_json::from_slice(&bytes).map_err(|_| ErrorClass::InvalidResponse)
            }
        }
        .map_err(failed)
    }

    pub async fn post(
        &self,
        endpoint: &Endpoint,
        pinned: &[SocketAddr],
        key: Option<&str>,
        body: &Value,
    ) -> Outcome {
        self.run(endpoint, pinned, key, Job::Chat(body)).await
    }

    pub async fn run(
        &self,
        endpoint: &Endpoint,
        pinned: &[SocketAddr],
        key: Option<&str>,
        job: Job<'_>,
    ) -> Outcome {
        let client = match self.client(endpoint, pinned) {
            Ok(client) => client,
            Err(class) => {
                return Outcome {
                    result: Err(class),
                    attempts: 0,
                    status: None,
                };
            }
        };
        let mut attempts = 0;
        loop {
            attempts += 1;
            let failure = match self.attempt(&client, endpoint, key, job).await {
                Ok(value) => {
                    return Outcome {
                        result: Ok(value),
                        attempts,
                        status: Some(200),
                    };
                }
                Err(failure) => failure,
            };
            let delay = self.policy.delays.get(attempts as usize - 1).copied();
            let wait = match (delay, failure.retry_after) {
                (Some(_), Some(after)) if after > self.policy.max_retry_after => None,
                (Some(delay), after) => Some(after.unwrap_or(delay).max(delay)),
                (None, _) => None,
            };
            match wait {
                Some(wait) if retryable(failure.status, failure.class) => {
                    tokio::time::sleep(wait).await;
                }
                _ => {
                    return Outcome {
                        result: Err(failure.class),
                        attempts,
                        status: failure.status,
                    };
                }
            }
        }
    }
}
