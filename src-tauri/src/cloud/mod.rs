mod anthropic;
mod cli;
pub mod commands;
mod config;
mod endpoint;
mod keys;
mod send;
mod templates;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

pub use keys::Keys;

pub const CONSENT_VERSION: u32 = 1;
pub const PROTECTION_CONSENT_VERSION: u32 = 1;
const CONFIG_FILE: &str = "cloud.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Transcriber,
    Corrector,
    Reviewer,
}

impl Step {
    fn name(self) -> &'static str {
        match self {
            Self::Transcriber => "transcriber",
            Self::Corrector => "corrector",
            Self::Reviewer => "reviewer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorClass {
    NotConfigured,
    ConsentMissing,
    ProtectionActive,
    NotPseudonymized,
    ProtectionConsentMissing,
    KeyMissing,
    InvalidAddress,
    Insecure,
    InvalidRequest,
    Auth,
    RateLimited,
    NotFound,
    TooLarge,
    BadRequest,
    Server,
    Network,
    Timeout,
    Cancelled,
    InvalidResponse,
    Storage,
    CliMissing,
    CliOutdated,
    CliFailed,
    NotLoggedIn,
    QuotaExhausted,
}

impl ErrorClass {
    fn name(self) -> &'static str {
        match self {
            Self::NotConfigured => "notConfigured",
            Self::ConsentMissing => "consentMissing",
            Self::ProtectionActive => "protectionActive",
            Self::NotPseudonymized => "notPseudonymized",
            Self::ProtectionConsentMissing => "protectionConsentMissing",
            Self::KeyMissing => "keyMissing",
            Self::InvalidAddress => "invalidAddress",
            Self::Insecure => "insecure",
            Self::InvalidRequest => "invalidRequest",
            Self::Auth => "auth",
            Self::RateLimited => "rateLimited",
            Self::NotFound => "notFound",
            Self::TooLarge => "tooLarge",
            Self::BadRequest => "badRequest",
            Self::Server => "server",
            Self::Network => "network",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::InvalidResponse => "invalidResponse",
            Self::Storage => "storage",
            Self::CliMissing => "cliMissing",
            Self::CliOutdated => "cliOutdated",
            Self::CliFailed => "cliFailed",
            Self::NotLoggedIn => "notLoggedIn",
            Self::QuotaExhausted => "quotaExhausted",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum CloudError {
    Cloud(ErrorClass),
}

impl From<ErrorClass> for CloudError {
    fn from(class: ErrorClass) -> Self {
        Self::Cloud(class)
    }
}

#[cfg(test)]
impl CloudError {
    fn class(self) -> ErrorClass {
        let Self::Cloud(class) = self;
        class
    }
}

#[derive(Default)]
struct Requests {
    pending: HashMap<String, oneshot::Sender<()>>,
    cancelled_early: Vec<String>,
}

pub struct CloudState {
    config_path: PathBuf,
    keys: Keys,
    sender: send::Sender,
    cli: cli::Runtime,
    cli_lock: tokio::sync::Mutex<()>,
    config_lock: tokio::sync::Mutex<()>,
    requests: Mutex<Requests>,
}

impl CloudState {
    pub fn new(data_dir: PathBuf, keys: Keys) -> Self {
        Self::with_sender(data_dir, keys, send::Sender::new(send::Policy::default()))
    }

    fn with_sender(data_dir: PathBuf, keys: Keys, sender: send::Sender) -> Self {
        Self {
            config_path: data_dir.join(CONFIG_FILE),
            keys,
            sender,
            cli: cli::Runtime::default(),
            cli_lock: tokio::sync::Mutex::new(()),
            config_lock: tokio::sync::Mutex::new(()),
            requests: Mutex::new(Requests::default()),
        }
    }
}
