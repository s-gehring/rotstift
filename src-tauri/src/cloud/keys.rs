use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sha2::{Digest, Sha256};

const SERVICE: &str = "tv.gehring.rotstift";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreUnavailable;

pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreUnavailable>;
    fn get(&self, account: &str) -> Result<Option<String>, StoreUnavailable>;
    fn delete(&self, account: &str) -> Result<(), StoreUnavailable>;
}

struct Keyring;

impl SecretStore for Keyring {
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreUnavailable> {
        keyring::Entry::new(SERVICE, account)
            .and_then(|entry| entry.set_password(secret))
            .map_err(|_| StoreUnavailable)
    }

    fn get(&self, account: &str) -> Result<Option<String>, StoreUnavailable> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.get_password()) {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(StoreUnavailable),
        }
    }

    fn delete(&self, account: &str) -> Result<(), StoreUnavailable> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(StoreUnavailable),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyStore {
    System,
    Session,
}

#[derive(Clone)]
pub struct Keys {
    system: Arc<dyn SecretStore>,
    cache: Arc<Mutex<HashMap<String, Cached>>>,
}

#[derive(Clone)]
struct Cached {
    secret: String,
    store: KeyStore,
}

pub fn account(base_url: &str) -> String {
    let digest = Sha256::digest(base_url.as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("cloud-{hex}")
}

impl Keys {
    pub fn system() -> Self {
        Self::with_store(Arc::new(Keyring))
    }

    pub fn with_store(system: Arc<dyn SecretStore>) -> Self {
        Self {
            system,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, HashMap<String, Cached>> {
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub async fn set(&self, account: &str, secret: &str) -> KeyStore {
        let system = self.system.clone();
        let (owned_account, owned_secret) = (account.to_owned(), secret.to_owned());
        let stored = tokio::task::spawn_blocking(move || system.set(&owned_account, &owned_secret))
            .await
            .unwrap_or(Err(StoreUnavailable));
        let store = if stored.is_ok() {
            KeyStore::System
        } else {
            KeyStore::Session
        };
        self.cache().insert(
            account.to_owned(),
            Cached {
                secret: secret.to_owned(),
                store,
            },
        );
        store
    }

    pub async fn get(&self, account: &str) -> Option<(String, KeyStore)> {
        if let Some(cached) = self.cache().get(account) {
            return Some((cached.secret.clone(), cached.store));
        }
        let system = self.system.clone();
        let owned = account.to_owned();
        let found = tokio::task::spawn_blocking(move || system.get(&owned))
            .await
            .ok()
            .and_then(Result::ok)
            .flatten()?;
        self.cache().insert(
            account.to_owned(),
            Cached {
                secret: found.clone(),
                store: KeyStore::System,
            },
        );
        Some((found, KeyStore::System))
    }

    pub async fn delete(&self, account: &str) {
        self.cache().remove(account);
        let system = self.system.clone();
        let owned = account.to_owned();
        let _ = tokio::task::spawn_blocking(move || system.delete(&owned)).await;
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    #[derive(Default)]
    pub struct MemoryStore {
        pub secrets: Mutex<HashMap<String, String>>,
        pub broken: bool,
    }

    impl SecretStore for MemoryStore {
        fn set(&self, account: &str, secret: &str) -> Result<(), StoreUnavailable> {
            if self.broken {
                return Err(StoreUnavailable);
            }
            self.secrets
                .lock()
                .unwrap()
                .insert(account.to_owned(), secret.to_owned());
            Ok(())
        }

        fn get(&self, account: &str) -> Result<Option<String>, StoreUnavailable> {
            if self.broken {
                return Err(StoreUnavailable);
            }
            Ok(self.secrets.lock().unwrap().get(account).cloned())
        }

        fn delete(&self, account: &str) -> Result<(), StoreUnavailable> {
            if self.broken {
                return Err(StoreUnavailable);
            }
            self.secrets.lock().unwrap().remove(account);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::MemoryStore;
    use super::*;

    #[tokio::test]
    async fn keys_go_to_the_system_store_and_survive_a_new_session() {
        let store = Arc::new(MemoryStore::default());
        let keys = Keys::with_store(store.clone());
        assert_eq!(keys.set("cloud-a", "sk-test").await, KeyStore::System);
        let fresh = Keys::with_store(store.clone());
        assert_eq!(
            fresh.get("cloud-a").await,
            Some(("sk-test".to_owned(), KeyStore::System))
        );
        fresh.delete("cloud-a").await;
        assert!(store.secrets.lock().unwrap().is_empty());
        assert_eq!(fresh.get("cloud-a").await, None);
    }

    #[tokio::test]
    async fn without_a_system_store_keys_live_only_for_the_session() {
        let store = Arc::new(MemoryStore {
            broken: true,
            ..MemoryStore::default()
        });
        let keys = Keys::with_store(store.clone());
        assert_eq!(keys.set("cloud-a", "sk-test").await, KeyStore::Session);
        assert_eq!(
            keys.get("cloud-a").await,
            Some(("sk-test".to_owned(), KeyStore::Session))
        );
        assert_eq!(Keys::with_store(store).get("cloud-a").await, None);
    }

    #[test]
    fn accounts_depend_only_on_the_address() {
        assert_eq!(account("https://a/v1"), account("https://a/v1"));
        assert_ne!(account("https://a/v1"), account("https://b/v1"));
        assert!(account("https://a/v1").starts_with("cloud-"));
    }
}
