use std::collections::HashSet;
use std::sync::OnceLock;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::llm::MAX_OUTPUT_TOKENS;

const REGISTRY_JSON: &str = include_str!("../../models.json");
const MIN_CONTEXT_SIZE: u32 = 1024;
pub const DEFAULT_MODEL_ID: &str = "glm-ocr-q8";
pub const DEFAULT_CORRECTOR_ID: &str = "gemma-4-e2b-q4";
const TEXT_PLACEHOLDER: &str = "{text}";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Transcriber,
    Corrector,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineMode {
    Plain,
    Numbered,
}

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
    pub mmproj: Option<ModelFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<ModelFile>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerParams {
    pub context_size: u32,
    pub image_max_tokens: Option<u32>,
    pub threads: Option<u32>,
    pub gpu_layers: Option<u32>,
    pub cpu_repack: bool,
    pub reasoning: Reasoning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reasoning {
    Auto,
    Off,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestParams {
    pub max_output_tokens: u32,
    pub temperature: f32,
    pub image_max_edge: Option<u32>,
    pub uncertain_below: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelEntry {
    pub id: String,
    pub role: Role,
    pub display_name: String,
    pub license: String,
    pub recommended_ram_gb: u32,
    pub files: ModelFiles,
    pub server: ServerParams,
    pub request: RequestParams,
    pub line_mode: Option<LineMode>,
    pub system: Option<String>,
    pub prompt: String,
}

impl ModelEntry {
    pub fn total_bytes(&self) -> u64 {
        self.file_list().iter().map(|file| file.bytes).sum()
    }

    pub fn file_list(&self) -> Vec<&ModelFile> {
        self.required_files()
            .into_iter()
            .chain(self.files.draft.as_ref())
            .collect()
    }

    pub fn required_files(&self) -> Vec<&ModelFile> {
        std::iter::once(&self.files.model)
            .chain(self.files.mmproj.as_ref())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomTemplates {
    pub transcriber: String,
    pub corrector: String,
}

impl CustomTemplates {
    pub fn for_role(&self, role: Role) -> &str {
        match role {
            Role::Transcriber => &self.transcriber,
            Role::Corrector => &self.corrector,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub custom_templates: CustomTemplates,
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

pub(super) fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(super) fn is_plain_gguf_name(name: &str) -> bool {
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

struct Shape {
    required: &'static [&'static str],
    nullable: &'static [&'static str],
    optional: &'static [&'static str],
    forbidden: &'static [&'static str],
}

const TRANSCRIBER_SHAPE: Shape = Shape {
    required: &["files.mmproj", "request.imageMaxEdge"],
    nullable: &[
        "server.threads",
        "server.gpuLayers",
        "server.imageMaxTokens",
        "request.uncertainBelow",
    ],
    optional: &[],
    forbidden: &["lineMode", "system", "files.draft"],
};

const CORRECTOR_SHAPE: Shape = Shape {
    required: &["lineMode"],
    nullable: &["server.threads", "server.gpuLayers"],
    optional: &["system", "files.draft"],
    forbidden: &[
        "files.mmproj",
        "server.imageMaxTokens",
        "request.imageMaxEdge",
        "request.uncertainBelow",
    ],
};

fn lookup<'a>(entry: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(entry, |value, key| value.as_object()?.get(key))
}

fn validate_shape(entry: &Value) -> Result<(), String> {
    let id = entry["id"].as_str().unwrap_or("?");
    let (role, shape) = match entry["role"].as_str() {
        Some("transcriber") => ("transcriber", &TRANSCRIBER_SHAPE),
        Some("corrector") => ("corrector", &CORRECTOR_SHAPE),
        _ => return Ok(()),
    };
    for path in shape.required.iter().chain(shape.nullable) {
        if lookup(entry, path).is_none() {
            return Err(format!("model {id}: a {role} needs {path}"));
        }
    }
    for path in shape.required.iter().chain(shape.optional) {
        if lookup(entry, path).is_some_and(Value::is_null) {
            return Err(format!("model {id}: {path} must not be null"));
        }
    }
    if let Some(path) = shape
        .forbidden
        .iter()
        .find(|path| lookup(entry, path).is_some())
    {
        return Err(format!("model {id}: a {role} takes no {path}"));
    }
    Ok(())
}

fn validate_role(entry: &ModelEntry) -> Result<(), String> {
    let id = &entry.id;
    match entry.role {
        Role::Transcriber => {
            if entry.files.mmproj.is_none() || entry.request.image_max_edge.is_none() {
                return Err(format!(
                    "model {id}: a transcriber needs mmproj and imageMaxEdge"
                ));
            }
            if entry.line_mode.is_some() || entry.system.is_some() || entry.files.draft.is_some() {
                return Err(format!(
                    "model {id}: lineMode, system and draft belong to correctors"
                ));
            }
        }
        Role::Corrector => {
            if entry.files.mmproj.is_some()
                || entry.server.image_max_tokens.is_some()
                || entry.request.image_max_edge.is_some()
            {
                return Err(format!("model {id}: a corrector takes no image settings"));
            }
            if entry.line_mode.is_none() || !entry.prompt.contains(TEXT_PLACEHOLDER) {
                return Err(format!(
                    "model {id}: a corrector needs lineMode and {TEXT_PLACEHOLDER} in the prompt"
                ));
            }
            if entry
                .system
                .as_ref()
                .is_some_and(|system| system.trim().is_empty())
            {
                return Err(format!("model {id}: system must not be empty"));
            }
        }
    }
    Ok(())
}

impl Registry {
    pub fn parse(json: &str) -> Result<Self, String> {
        let value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if let Some(entries) = value.get("models").and_then(Value::as_array) {
            entries.iter().try_for_each(validate_shape)?;
        }
        let registry: Self = serde_json::from_value(value).map_err(|e| e.to_string())?;
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
            if let Some(mmproj) = &entry.files.mmproj {
                validate_file(id, "mmproj", mmproj)?;
            }
            if let Some(draft) = &entry.files.draft {
                validate_file(id, "draft", draft)?;
            }
            validate_role(entry)?;
            for file in entry.file_list() {
                if !names.insert(file.name.as_str()) {
                    return Err(format!("file name {} is used twice", file.name));
                }
            }
            if entry.display_name.trim().is_empty() {
                return Err(format!("model {id}: display name is required"));
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
            if request.image_max_edge.is_some_and(|edge| edge < 64)
                || !(0.0..=2.0).contains(&request.temperature)
                || request
                    .uncertain_below
                    .is_some_and(|threshold| !(threshold > 0.0 && threshold < 1.0))
            {
                return Err(format!("model {id}: invalid request parameters"));
            }
        }
        for (default, role) in [
            (DEFAULT_MODEL_ID, Role::Transcriber),
            (DEFAULT_CORRECTOR_ID, Role::Corrector),
        ] {
            if self.find(default).is_none_or(|entry| entry.role != role) {
                return Err(format!("registry lacks the default model {default}"));
            }
        }
        for role in [Role::Transcriber, Role::Corrector] {
            let id = self.custom_templates.for_role(role);
            if self.find(id).is_none_or(|entry| entry.role != role) {
                return Err(format!("custom template {id} is not a {role:?} entry"));
            }
        }
        Ok(())
    }

    pub fn template(&self, role: Role) -> &ModelEntry {
        let id = self.custom_templates.for_role(role);
        self.models
            .iter()
            .find(|entry| entry.id == id)
            .expect("validated template")
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
    use serde_json::json;

    fn json_with(index: usize, change: impl FnOnce(&mut Value)) -> String {
        let mut value: Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        change(&mut value["models"][index]);
        value.to_string()
    }

    fn rejection(change: impl FnOnce(&mut Value)) -> String {
        Registry::parse(&json_with(0, change)).expect_err("registry should be rejected")
    }

    fn corrector_index() -> usize {
        registry()
            .unwrap()
            .models
            .iter()
            .position(|entry| entry.id == DEFAULT_CORRECTOR_ID)
            .unwrap()
    }

    fn corrector_rejection(change: impl FnOnce(&mut Value)) -> String {
        Registry::parse(&json_with(corrector_index(), change))
            .expect_err("registry should be rejected")
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
        assert_eq!(
            ids,
            [
                "glm-ocr-q8",
                "qwen3-vl-4b-q4",
                "lightonocr-3-08b-q8",
                "gemma-4-e2b-q4",
                "gemma-4-e4b-q4",
                "gemma-4-26b-a4b-q4"
            ]
        );
        let stronger = registry.find("qwen3-vl-4b-q4").unwrap();
        assert_eq!(stronger.recommended_ram_gb, 16);
        assert_eq!(stronger.server.context_size, 4096);
        assert_eq!(stronger.server.image_max_tokens, Some(1024));
        assert_eq!(stronger.request.image_max_edge, Some(1536));
        assert_eq!(stronger.request.uncertain_below, Some(0.9));
        let default = registry.find(DEFAULT_MODEL_ID).unwrap();
        assert_eq!(default.request.uncertain_below, Some(0.95));
        assert_eq!(stronger.files.model.bytes, 2_497_281_664);
        assert_eq!(stronger.files.mmproj.as_ref().unwrap().bytes, 453_974_304);
    }

    #[test]
    fn the_bundled_corrector_follows_the_evaluation() {
        let corrector = registry().unwrap().find(DEFAULT_CORRECTOR_ID).unwrap();
        assert_eq!(corrector.role, Role::Corrector);
        assert_eq!(corrector.files.mmproj, None);
        assert_eq!(corrector.required_files().len(), 1);
        assert_eq!(corrector.total_bytes(), 2_841_481_184 + 59_235_872);
        assert_eq!(corrector.server.context_size, 4096);
        assert!(!corrector.server.cpu_repack);
        assert_eq!(corrector.server.reasoning, Reasoning::Off);
        assert_eq!(corrector.line_mode, Some(LineMode::Numbered));
        assert_eq!(corrector.prompt, TEXT_PLACEHOLDER);
        assert!(
            corrector
                .system
                .as_ref()
                .unwrap()
                .contains("Fach: {subject}.")
        );
        let transcriber = registry().unwrap().find(DEFAULT_MODEL_ID).unwrap();
        assert_eq!(transcriber.role, Role::Transcriber);
        assert!(transcriber.server.cpu_repack);
        assert_eq!(transcriber.server.reasoning, Reasoning::Auto);
    }

    #[test]
    fn every_gemma_corrector_brings_its_head_from_the_same_commit() {
        let registry = registry().unwrap();
        for id in ["gemma-4-e2b-q4", "gemma-4-e4b-q4", "gemma-4-26b-a4b-q4"] {
            let entry = registry.find(id).unwrap();
            let draft = entry.files.draft.as_ref().unwrap();
            assert!(draft.name.starts_with("mtp-"), "{id}");
            let commit = |url: &str| url.rsplit('/').nth(1).unwrap().to_owned();
            assert_eq!(commit(&draft.url), commit(&entry.files.model.url), "{id}");
            assert_eq!(entry.required_files(), [&entry.files.model]);
            assert_eq!(entry.file_list(), [&entry.files.model, draft]);
            assert_eq!(entry.total_bytes(), entry.files.model.bytes + draft.bytes);
        }
        for entry in &registry.models {
            if entry.role == Role::Transcriber {
                assert_eq!(entry.files.draft, None, "{}", entry.id);
            }
        }
    }

    #[test]
    fn only_a_corrector_takes_a_pinned_head() {
        let draft = registry()
            .unwrap()
            .find(DEFAULT_CORRECTOR_ID)
            .unwrap()
            .files
            .draft
            .clone();
        let error = rejection(|m| m["files"]["draft"] = json!(draft));
        assert!(error.contains("takes no files.draft"), "{error}");
        let error = corrector_rejection(|m| m["files"]["draft"] = Value::Null);
        assert!(error.contains("files.draft must not be null"), "{error}");
        let error = corrector_rejection(|m| {
            m["files"]["draft"]["url"] = json!(format!(
                "https://huggingface.co/a/b/resolve/main/{}",
                draft.as_ref().unwrap().name
            ));
        });
        assert!(error.contains("draft: url must be pinned"), "{error}");
        let json = json_with(corrector_index(), |m| {
            m["files"].as_object_mut().unwrap().remove("draft");
        });
        let without = Registry::parse(&json).unwrap();
        assert_eq!(
            without.find(DEFAULT_CORRECTOR_ID).unwrap().files.draft,
            None
        );
    }

    #[test]
    fn requires_the_default_model() {
        let error = rejection(|m| m["id"] = json!("renamed"));
        assert!(error.contains("default model"), "{error}");
        let error = rejection(|m| m["role"] = json!("corrector"));
        assert!(error.contains("a corrector"), "{error}");
    }

    #[test]
    fn requires_a_default_corrector_with_the_corrector_role() {
        let error = corrector_rejection(|m| m["id"] = json!("renamed"));
        assert!(error.contains("default model"), "{error}");
    }

    #[test]
    fn rejects_unknown_roles_and_a_missing_cpu_repack() {
        assert!(rejection(|m| m["role"] = json!("painter")).contains("unknown variant"));
        let error = rejection(|m| {
            m["server"].as_object_mut().unwrap().remove("cpuRepack");
        });
        assert!(error.contains("cpuRepack"), "{error}");
    }

    #[test]
    fn rejects_unknown_or_missing_reasoning_modes() {
        let error = rejection(|m| m["server"]["reasoning"] = json!("on"));
        assert!(error.contains("unknown variant"), "{error}");
        let error = rejection(|m| {
            m["server"].as_object_mut().unwrap().remove("reasoning");
        });
        assert!(error.contains("reasoning"), "{error}");
    }

    #[test]
    fn a_transcriber_needs_its_projector_and_image_size() {
        let error = rejection(|m| {
            m["files"].as_object_mut().unwrap().remove("mmproj");
        });
        assert!(error.contains("needs files.mmproj"), "{error}");
        let error = rejection(|m| {
            m["request"].as_object_mut().unwrap().remove("imageMaxEdge");
        });
        assert!(error.contains("needs request.imageMaxEdge"), "{error}");
        let error = rejection(|m| {
            m["server"]
                .as_object_mut()
                .unwrap()
                .remove("imageMaxTokens");
        });
        assert!(error.contains("needs server.imageMaxTokens"), "{error}");
        let error = rejection(|m| {
            m["server"].as_object_mut().unwrap().remove("threads");
        });
        assert!(error.contains("needs server.threads"), "{error}");
        let error = rejection(|m| {
            m["request"]
                .as_object_mut()
                .unwrap()
                .remove("uncertainBelow");
        });
        assert!(error.contains("needs request.uncertainBelow"), "{error}");
        let error = rejection(|m| m["files"]["mmproj"] = Value::Null);
        assert!(error.contains("files.mmproj must not be null"), "{error}");
        let error = rejection(|m| m["lineMode"] = json!("numbered"));
        assert!(error.contains("takes no lineMode"), "{error}");
        let error = rejection(|m| m["system"] = Value::Null);
        assert!(error.contains("takes no system"), "{error}");
    }

    #[test]
    fn a_corrector_takes_no_image_settings_and_needs_the_text_placeholder() {
        let mmproj = registry().unwrap().models[0].files.mmproj.clone();
        let error = corrector_rejection(|m| m["files"]["mmproj"] = json!(mmproj));
        assert!(error.contains("takes no files.mmproj"), "{error}");
        let error = corrector_rejection(|m| m["files"]["mmproj"] = Value::Null);
        assert!(error.contains("takes no files.mmproj"), "{error}");
        let error = corrector_rejection(|m| m["server"]["imageMaxTokens"] = Value::Null);
        assert!(error.contains("takes no server.imageMaxTokens"), "{error}");
        let error = corrector_rejection(|m| m["request"]["imageMaxEdge"] = json!(1024));
        assert!(error.contains("takes no request.imageMaxEdge"), "{error}");
        let error = corrector_rejection(|m| m["request"]["uncertainBelow"] = json!(0.95));
        assert!(error.contains("takes no request.uncertainBelow"), "{error}");
        let error = corrector_rejection(|m| m["system"] = Value::Null);
        assert!(error.contains("system must not be null"), "{error}");
        let error = corrector_rejection(|m| {
            m["server"].as_object_mut().unwrap().remove("gpuLayers");
        });
        assert!(error.contains("needs server.gpuLayers"), "{error}");
        let error = corrector_rejection(|m| m["prompt"] = json!("Korrigiere."));
        assert!(error.contains("{text}"), "{error}");
        let error = corrector_rejection(|m| {
            m.as_object_mut().unwrap().remove("lineMode");
        });
        assert!(error.contains("needs lineMode"), "{error}");
        let error = corrector_rejection(|m| m["lineMode"] = Value::Null);
        assert!(error.contains("lineMode must not be null"), "{error}");
        let error = corrector_rejection(|m| m["lineMode"] = json!("diff"));
        assert!(error.contains("unknown variant"), "{error}");
        let error = corrector_rejection(|m| m["system"] = json!(" "));
        assert!(error.contains("system"), "{error}");
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
        for threshold in [json!(0.0), json!(1.0), json!(1.5), json!(-0.1)] {
            assert!(
                rejection(|m| m["request"]["uncertainBelow"] = threshold.clone())
                    .contains("request"),
                "{threshold}"
            );
        }
        assert!(Registry::parse("{\"models\": []}").is_err());
    }

    #[test]
    fn a_transcriber_may_send_the_image_without_a_prompt() {
        let registry = Registry::parse(&json_with(0, |m| m["prompt"] = json!(""))).unwrap();
        assert_eq!(registry.models[0].prompt, "");
        assert!(corrector_rejection(|m| m["prompt"] = json!("")).contains("prompt"));
    }

    #[test]
    fn a_transcriber_may_switch_the_reading_threshold_off() {
        let json = json_with(0, |m| m["request"]["uncertainBelow"] = Value::Null);
        let registry = Registry::parse(&json).unwrap();
        assert_eq!(registry.models[0].request.uncertain_below, None);
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
