use std::collections::HashSet;
use std::sync::OnceLock;

use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::llm::MAX_OUTPUT_TOKENS;

const REGISTRY_JSON: &str = include_str!("../../models.json");
const MIN_CONTEXT_SIZE: u32 = 1024;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelFile {
    pub name: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelFiles {
    pub model: ModelFile,
    pub mmproj: ModelFile,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerParams {
    pub context_size: u32,
    pub image_max_tokens: Option<u32>,
    pub threads: Option<u32>,
    pub gpu_layers: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestParams {
    pub max_output_tokens: u32,
    pub temperature: f32,
    pub image_max_edge: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelEntry {
    pub id: String,
    pub display_name: String,
    pub license: String,
    pub recommended_ram_gb: u32,
    pub files: ModelFiles,
    pub server: ServerParams,
    pub request: RequestParams,
    pub prompt: String,
}

impl ModelEntry {
    pub fn total_bytes(&self) -> u64 {
        self.files.model.bytes + self.files.mmproj.bytes
    }

    pub fn file_list(&self) -> [&ModelFile; 2] {
        [&self.files.model, &self.files.mmproj]
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub models: Vec<ModelEntry>,
}

pub fn host_allowed(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    ["huggingface.co", "hf.co"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

pub fn url_allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(host_allowed)
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_plain_gguf_name(name: &str) -> bool {
    name.ends_with(".gguf")
        && name.len() > ".gguf".len()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        && !name.starts_with('.')
}

fn validate_file(model: &str, kind: &str, file: &ModelFile) -> Result<(), String> {
    let context = format!("model {model}, {kind}");
    if !is_plain_gguf_name(&file.name) {
        return Err(format!("{context}: invalid file name {:?}", file.name));
    }
    if !is_hex(&file.sha256, 64) {
        return Err(format!("{context}: sha256 must be 64 lowercase hex digits"));
    }
    if file.bytes == 0 {
        return Err(format!("{context}: bytes must be positive"));
    }
    let url = Url::parse(&file.url).map_err(|e| format!("{context}: invalid url: {e}"))?;
    if !url_allowed(&url) {
        return Err(format!(
            "{context}: url must be https on a Hugging Face host"
        ));
    }
    let segments: Vec<&str> = url
        .path_segments()
        .map(Iterator::collect)
        .unwrap_or_default();
    let pinned = segments.len() >= 5 && segments[2] == "resolve" && is_hex(segments[3], 40);
    if !pinned {
        return Err(format!(
            "{context}: url must be pinned to a commit (resolve/<40 hex>/<file>)"
        ));
    }
    if segments.last() != Some(&file.name.as_str()) {
        return Err(format!("{context}: url does not end in the file name"));
    }
    Ok(())
}

impl Registry {
    pub fn parse(json: &str) -> Result<Self, String> {
        let registry: Self = serde_json::from_str(json).map_err(|e| e.to_string())?;
        registry.validate()?;
        Ok(registry)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.models.is_empty() {
            return Err("registry lists no models".into());
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for entry in &self.models {
            let id = &entry.id;
            let valid_id = !id.is_empty()
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !valid_id {
                return Err(format!("invalid model id {id:?}"));
            }
            if !ids.insert(id.as_str()) {
                return Err(format!("duplicate model id {id}"));
            }
            validate_file(id, "model", &entry.files.model)?;
            validate_file(id, "mmproj", &entry.files.mmproj)?;
            for file in entry.file_list() {
                if !names.insert(file.name.as_str()) {
                    return Err(format!("file name {} is used twice", file.name));
                }
            }
            if entry.display_name.trim().is_empty() || entry.prompt.trim().is_empty() {
                return Err(format!("model {id}: display name and prompt are required"));
            }
            if entry.recommended_ram_gb == 0 {
                return Err(format!("model {id}: recommendedRamGb must be positive"));
            }
            let (server, request) = (&entry.server, &entry.request);
            if server.context_size < MIN_CONTEXT_SIZE {
                return Err(format!("model {id}: contextSize below {MIN_CONTEXT_SIZE}"));
            }
            if server.threads == Some(0) || server.image_max_tokens == Some(0) {
                return Err(format!(
                    "model {id}: threads and imageMaxTokens must be positive"
                ));
            }
            if request.max_output_tokens == 0 || request.max_output_tokens > MAX_OUTPUT_TOKENS {
                return Err(format!(
                    "model {id}: maxOutputTokens must be between 1 and {MAX_OUTPUT_TOKENS}"
                ));
            }
            if request.max_output_tokens >= server.context_size {
                return Err(format!("model {id}: maxOutputTokens must fit the context"));
            }
            if request.image_max_edge < 64 || !(0.0..=2.0).contains(&request.temperature) {
                return Err(format!("model {id}: invalid request parameters"));
            }
        }
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&ModelEntry> {
        self.models.iter().find(|entry| entry.id == id)
    }
}

pub fn registry() -> Result<&'static Registry, String> {
    static REGISTRY: OnceLock<Result<Registry, String>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| Registry::parse(REGISTRY_JSON))
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn json_with(change: impl FnOnce(&mut Value)) -> String {
        let mut value: Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        change(&mut value["models"][0]);
        value.to_string()
    }

    fn rejection(change: impl FnOnce(&mut Value)) -> String {
        Registry::parse(&json_with(change)).expect_err("registry should be rejected")
    }

    #[test]
    fn the_bundled_registry_is_valid() {
        let registry = registry().unwrap();
        assert!(!registry.models.is_empty());
        assert!(registry.find("does-not-exist").is_none());
    }

    #[test]
    fn the_bundled_registry_lists_the_default_and_the_stronger_model() {
        let registry = registry().unwrap();
        let ids: Vec<&str> = registry.models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["glm-ocr-q8", "qwen3-vl-4b-q4"]);
        let stronger = registry.find("qwen3-vl-4b-q4").unwrap();
        assert_eq!(stronger.recommended_ram_gb, 16);
        assert_eq!(stronger.server.context_size, 4096);
        assert_eq!(stronger.server.image_max_tokens, Some(1024));
        assert_eq!(stronger.request.image_max_edge, 1536);
        assert_eq!(stronger.files.model.bytes, 2_497_281_664);
        assert_eq!(stronger.files.mmproj.bytes, 453_974_304);
    }

    #[test]
    fn rejects_unknown_fields_and_bad_ids() {
        assert!(rejection(|m| m["extra"] = json!(1)).contains("unknown field"));
        assert!(rejection(|m| m["id"] = json!("Upper Case")).contains("invalid model id"));
    }

    #[test]
    fn rejects_duplicate_ids_and_file_names() {
        let mut registry: Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        let first = registry["models"][0].clone();
        registry["models"].as_array_mut().unwrap().push(first);
        let error = Registry::parse(&registry.to_string()).unwrap_err();
        assert!(error.contains("duplicate model id"));

        let mut registry: Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        let mut second = registry["models"][0].clone();
        second["id"] = json!("other");
        registry["models"].as_array_mut().unwrap().push(second);
        let error = Registry::parse(&registry.to_string()).unwrap_err();
        assert!(error.contains("used twice"));
    }

    #[test]
    fn rejects_urls_outside_pinned_hugging_face_downloads() {
        let name = Registry::parse(REGISTRY_JSON).unwrap().models[0]
            .files
            .model
            .name
            .clone();
        for url in [
            format!(
                "http://huggingface.co/a/b/resolve/{}/{name}",
                "a".repeat(40)
            ),
            format!("https://example.com/a/b/resolve/{}/{name}", "a".repeat(40)),
            format!(
                "https://huggingface.co.evil.com/a/b/resolve/{}/{name}",
                "a".repeat(40)
            ),
            format!("https://huggingface.co/a/b/resolve/main/{name}"),
            format!(
                "https://huggingface.co/a/b/resolve/{}/other.gguf",
                "a".repeat(40)
            ),
            "not a url".to_owned(),
        ] {
            let error = rejection(|m| m["files"]["model"]["url"] = json!(url));
            assert!(error.contains("url"), "{url}: {error}");
        }
    }

    #[test]
    fn rejects_bad_hashes_sizes_and_file_names() {
        assert!(rejection(|m| m["files"]["model"]["sha256"] = json!("ABC")).contains("sha256"));
        assert!(rejection(|m| m["files"]["model"]["bytes"] = json!(0)).contains("bytes"));
        for name in ["../x.gguf", "dir/x.gguf", "x.bin", ".gguf", "a b.gguf"] {
            let error = rejection(|m| m["files"]["mmproj"]["name"] = json!(name));
            assert!(error.contains("file name"), "{name}: {error}");
        }
    }

    #[test]
    fn rejects_unusable_server_and_request_parameters() {
        assert!(rejection(|m| m["server"]["contextSize"] = json!(10)).contains("contextSize"));
        assert!(rejection(|m| m["server"]["threads"] = json!(0)).contains("threads"));
        assert!(
            rejection(|m| m["request"]["maxOutputTokens"] = json!(MAX_OUTPUT_TOKENS + 1))
                .contains("maxOutputTokens")
        );
        assert!(
            rejection(|m| m["request"]["maxOutputTokens"] = json!(8192))
                .contains("maxOutputTokens")
        );
        assert!(rejection(|m| m["prompt"] = json!("  ")).contains("prompt"));
        assert!(Registry::parse("{\"models\": []}").is_err());
    }

    #[test]
    fn allows_only_https_hugging_face_hosts() {
        let allowed = |url: &str| url_allowed(&Url::parse(url).unwrap());
        assert!(allowed("https://huggingface.co/x"));
        assert!(allowed("https://cdn-lfs.hf.co/x"));
        assert!(allowed("https://us.aws.cdn.hf.co/xet-bridge-us/x"));
        assert!(!allowed("http://huggingface.co/x"));
        assert!(!allowed("https://nothf.co/x"));
        assert!(!allowed("https://hf.co.evil.com/x"));
        assert!(!allowed("https://user@huggingface.co/x"));
        assert!(!allowed("https://huggingface.co:8443/x"));
        assert!(!allowed("https://127.0.0.1/x"));
    }
}
