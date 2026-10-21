use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::endpoint::{self, Endpoint};
use super::templates::{self, Template};
use super::{CONSENT_VERSION, ErrorClass, Step};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Consent {
    pub host: String,
    pub version: u32,
    pub at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Choice {
    pub template: String,
    pub base_url: String,
    pub model: String,
    pub consent: Option<Consent>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    #[serde(default)]
    pub steps: BTreeMap<Step, Choice>,
}

pub struct Resolved<'a> {
    pub choice: &'a Choice,
    pub template: &'static Template,
    pub endpoint: Endpoint,
}

impl Choice {
    pub fn resolve(&self) -> Result<Resolved<'_>, ErrorClass> {
        let template = templates::find(&self.template).ok_or(ErrorClass::NotConfigured)?;
        let endpoint = endpoint::parse(template, &self.base_url)?;
        Ok(Resolved {
            choice: self,
            template,
            endpoint,
        })
    }
}

impl Resolved<'_> {
    pub fn confirmed(&self) -> bool {
        self.endpoint.loopback
            || self.choice.consent.as_ref().is_some_and(|consent| {
                consent.host == self.endpoint.host && consent.version == CONSENT_VERSION
            })
    }
}

impl Config {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), ErrorClass> {
        let text = serde_json::to_string_pretty(self).map_err(|_| ErrorClass::Storage)?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|_| ErrorClass::Storage)?;
        }
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, text).map_err(|_| ErrorClass::Storage)?;
        std::fs::rename(&temp, path).map_err(|_| ErrorClass::Storage)
    }

    pub fn uses(&self, base_url: &str) -> bool {
        self.steps
            .values()
            .any(|choice| endpoint::normalize(&choice.base_url) == base_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(base_url: &str, consent: Option<Consent>) -> Choice {
        Choice {
            template: "server".into(),
            base_url: base_url.into(),
            model: "m".into(),
            consent,
        }
    }

    fn consent(host: &str, version: u32) -> Option<Consent> {
        Some(Consent {
            host: host.into(),
            version,
            at_ms: 0,
        })
    }

    #[test]
    fn consent_is_bound_to_host_and_version_and_loopback_needs_none() {
        let lan = "https://ki.schule.example/v1";
        assert!(!choice(lan, None).resolve().unwrap().confirmed());
        assert!(
            choice(lan, consent("ki.schule.example", CONSENT_VERSION))
                .resolve()
                .unwrap()
                .confirmed()
        );
        assert!(
            !choice(lan, consent("other.example", CONSENT_VERSION))
                .resolve()
                .unwrap()
                .confirmed()
        );
        assert!(
            !choice(lan, consent("ki.schule.example", CONSENT_VERSION + 1))
                .resolve()
                .unwrap()
                .confirmed()
        );
        assert!(
            choice("http://127.0.0.1:8080/v1", None)
                .resolve()
                .unwrap()
                .confirmed()
        );
    }

    #[test]
    fn a_damaged_file_holds_no_consent() {
        let dir = std::env::temp_dir().join(format!("rotstift-cloud-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cloud.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(Config::load(&path).steps.is_empty());
        let mut config = Config::default();
        config.steps.insert(
            Step::Corrector,
            choice(
                "https://ki.schule.example/v1",
                consent("ki.schule.example", 1),
            ),
        );
        config.save(&path).unwrap();
        assert_eq!(Config::load(&path).steps, config.steps);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
