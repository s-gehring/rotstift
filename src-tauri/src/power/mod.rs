pub mod commands;
mod platform;

use std::sync::{Mutex, MutexGuard};

use serde_json::json;

use crate::diagnostics::record;

pub trait Backend: Send + Sync + 'static {
    type Lock: Send + 'static;

    fn acquire(&self) -> Result<Self::Lock, String>;
}

pub struct PowerHold<B: Backend> {
    backend: B,
    held: Mutex<Option<B::Lock>>,
}

impl<B: Backend> PowerHold<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            held: Mutex::new(None),
        }
    }

    fn held(&self) -> MutexGuard<'_, Option<B::Lock>> {
        self.held.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn hold(&self) -> bool {
        let mut held = self.held();
        if held.is_some() {
            return true;
        }
        match self.backend.acquire() {
            Ok(lock) => {
                *held = Some(lock);
                record("power_hold", json!({ "held": true }));
                true
            }
            Err(reason) => {
                record("power_hold", json!({ "held": false, "reason": reason }));
                false
            }
        }
    }

    pub fn release(&self) {
        if self.held().take().is_some() {
            record("power_release", json!({}));
        }
    }

    #[cfg(test)]
    fn is_held(&self) -> bool {
        self.held().is_some()
    }
}

pub type SystemPowerHold = PowerHold<platform::System>;

pub fn system() -> SystemPowerHold {
    PowerHold::new(platform::System)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Counts {
        acquired: AtomicUsize,
        released: AtomicUsize,
    }

    struct Fake {
        counts: Arc<Counts>,
        fail: bool,
    }

    struct FakeLock(Arc<Counts>);

    impl Drop for FakeLock {
        fn drop(&mut self) {
            self.0.released.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl Backend for Fake {
        type Lock = FakeLock;

        fn acquire(&self) -> Result<FakeLock, String> {
            if self.fail {
                return Err("no logind".to_owned());
            }
            self.counts.acquired.fetch_add(1, Ordering::SeqCst);
            Ok(FakeLock(self.counts.clone()))
        }
    }

    fn hold(fail: bool) -> (PowerHold<Fake>, Arc<Counts>) {
        let counts = Arc::new(Counts::default());
        let backend = Fake {
            counts: counts.clone(),
            fail,
        };
        (PowerHold::new(backend), counts)
    }

    #[test]
    fn holding_twice_takes_the_lock_once() {
        let (power, counts) = hold(false);
        assert!(power.hold());
        assert!(power.hold());
        assert_eq!(counts.acquired.load(Ordering::SeqCst), 1);
        assert!(power.is_held());
    }

    #[test]
    fn release_frees_the_lock_and_is_idempotent() {
        let (power, counts) = hold(false);
        power.hold();
        power.release();
        power.release();
        assert_eq!(counts.released.load(Ordering::SeqCst), 1);
        assert!(!power.is_held());
    }

    #[test]
    fn release_without_hold_does_nothing() {
        let (power, counts) = hold(false);
        power.release();
        assert_eq!(counts.released.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_lock_can_be_taken_again_after_release() {
        let (power, counts) = hold(false);
        power.hold();
        power.release();
        power.hold();
        assert_eq!(counts.acquired.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn dropping_the_state_frees_the_lock() {
        let (power, counts) = hold(false);
        power.hold();
        drop(power);
        assert_eq!(counts.released.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_failing_platform_layer_reports_false_and_stays_free() {
        let (power, counts) = hold(true);
        assert!(!power.hold());
        assert!(!power.is_held());
        power.release();
        assert_eq!(counts.released.load(Ordering::SeqCst), 0);
    }
}
