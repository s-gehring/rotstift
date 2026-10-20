use std::collections::BTreeSet;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct Thresholds {
    pub log_gap: Duration,
    pub cancel_gap: Duration,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            log_gap: Duration::from_secs(30),
            cancel_gap: Duration::from_secs(300),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    GapDetected {
        gap: Duration,
        batch_active: bool,
        in_flight: usize,
        visible: bool,
    },
    CancelInFlight {
        gap: Duration,
        ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resumed {
    pub gap: Duration,
    pub visible: bool,
}

pub struct Liveness {
    thresholds: Thresholds,
    batch_active: bool,
    visible: bool,
    last_beat: Option<Instant>,
    in_flight: BTreeSet<String>,
    gap_logged: bool,
    cancelled: bool,
}

impl Liveness {
    pub fn new(thresholds: Thresholds) -> Self {
        Self {
            thresholds,
            batch_active: false,
            visible: true,
            last_beat: None,
            in_flight: BTreeSet::new(),
            gap_logged: false,
            cancelled: false,
        }
    }

    fn watching(&self) -> bool {
        self.batch_active || !self.in_flight.is_empty()
    }

    pub fn heartbeat(
        &mut self,
        now: Instant,
        batch_active: bool,
        visible: bool,
    ) -> Option<Resumed> {
        let resumed = (self.gap_logged && self.last_beat.is_some()).then(|| Resumed {
            gap: now.saturating_duration_since(self.last_beat.unwrap_or(now)),
            visible,
        });
        self.batch_active = batch_active;
        self.visible = visible;
        self.last_beat = Some(now);
        self.gap_logged = false;
        self.cancelled = false;
        resumed
    }

    pub fn chat_began(&mut self, now: Instant, id: &str) {
        self.last_beat = Some(now);
        self.in_flight.insert(id.to_owned());
    }

    pub fn chat_ended(&mut self, id: &str) {
        self.in_flight.remove(id);
    }

    pub fn check(&mut self, now: Instant) -> Vec<Verdict> {
        let Some(last_beat) = self.last_beat else {
            return Vec::new();
        };
        if !self.watching() {
            self.gap_logged = false;
            self.cancelled = false;
            return Vec::new();
        }
        let gap = now.saturating_duration_since(last_beat);
        let mut verdicts = Vec::new();
        if gap >= self.thresholds.log_gap && !self.gap_logged {
            self.gap_logged = true;
            verdicts.push(Verdict::GapDetected {
                gap,
                batch_active: self.batch_active,
                in_flight: self.in_flight.len(),
                visible: self.visible,
            });
        }
        if gap >= self.thresholds.cancel_gap
            && !self.cancelled
            && self.visible
            && !self.in_flight.is_empty()
        {
            self.cancelled = true;
            verdicts.push(Verdict::CancelInFlight {
                gap,
                ids: self.in_flight.iter().cloned().collect(),
            });
        }
        verdicts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: Duration = Duration::from_secs(1);

    fn at(base: Instant, seconds: u64) -> Instant {
        base + SECOND * seconds as u32
    }

    #[test]
    fn stays_silent_while_heartbeats_arrive() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, true);
        for second in (5..120).step_by(5) {
            assert_eq!(live.heartbeat(at(base, second), true, true), None);
            assert!(live.check(at(base, second + 1)).is_empty());
        }
    }

    #[test]
    fn logs_a_gap_once_while_the_batch_is_active() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, false);
        assert!(live.check(at(base, 29)).is_empty());
        let verdicts = live.check(at(base, 31));
        assert_eq!(
            verdicts,
            vec![Verdict::GapDetected {
                gap: SECOND * 31,
                batch_active: true,
                in_flight: 0,
                visible: false,
            }]
        );
        assert!(live.check(at(base, 40)).is_empty());
    }

    #[test]
    fn reports_how_long_the_gap_lasted_when_heartbeats_resume() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, true);
        live.check(at(base, 45));
        let resumed = live.heartbeat(at(base, 90), true, true).unwrap();
        assert_eq!(resumed.gap, SECOND * 90);
        assert!(live.heartbeat(at(base, 95), true, true).is_none());
    }

    #[test]
    fn ignores_silence_when_nothing_is_running() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, false, true);
        assert!(live.check(at(base, 1000)).is_empty());
    }

    #[test]
    fn a_chat_in_flight_counts_even_without_an_active_batch() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, false, true);
        live.chat_began(at(base, 1), "req-1");
        assert!(matches!(
            live.check(at(base, 40)).as_slice(),
            [Verdict::GapDetected { in_flight: 1, .. }]
        ));
        live.chat_ended("req-1");
        assert!(live.check(at(base, 50)).is_empty());
    }

    #[test]
    fn cancels_in_flight_requests_once_after_the_long_gap() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, true);
        live.chat_began(at(base, 2), "req-1");
        live.chat_began(at(base, 3), "req-2");
        assert!(matches!(
            live.check(at(base, 100)).as_slice(),
            [Verdict::GapDetected { .. }]
        ));
        let verdicts = live.check(at(base, 304));
        assert_eq!(
            verdicts,
            vec![Verdict::CancelInFlight {
                gap: SECOND * 301,
                ids: vec!["req-1".into(), "req-2".into()],
            }]
        );
        assert!(live.check(at(base, 400)).is_empty());
    }

    #[test]
    fn never_cancels_while_the_window_is_hidden() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, false);
        live.chat_began(at(base, 2), "req-1");
        let verdicts = live.check(at(base, 2000));
        assert!(matches!(
            verdicts.as_slice(),
            [Verdict::GapDetected { visible: false, .. }]
        ));
        live.heartbeat(at(base, 2001), true, true);
        assert!(live.check(at(base, 2002)).is_empty());
    }

    #[test]
    fn never_cancels_without_a_request_in_flight() {
        let base = Instant::now();
        let mut live = Liveness::new(Thresholds::default());
        live.heartbeat(base, true, true);
        let verdicts = live.check(at(base, 1000));
        assert!(
            verdicts
                .iter()
                .all(|verdict| !matches!(verdict, Verdict::CancelInFlight { .. }))
        );
    }
}
