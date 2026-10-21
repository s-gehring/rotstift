use std::collections::BTreeMap;
use std::time::Instant;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::oneshot;

use super::anthropic::{self, RemoteModel};
use super::config::{Choice, Config, Consent};
use super::endpoint::{self, pinned_addresses};
use super::keys::{self, KeyStore, Keys};
use super::send::Job;
use super::templates::{self, Api, KeyNeed, TokenField};
use super::{CONSENT_VERSION, CloudError, CloudState, ErrorClass, Step};
use crate::diagnostics;
use crate::llm::ChatRequest;

const MAX_MODEL_NAME: usize = 200;
const PROBE_IMAGE: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR42u3NMQ0AAAwDoPo33arYsQQMkB6LQCAQCAQCgUAg+BIMi1X0ptsIcT0AAAAASUVORK5CYII=";
const PROBE_PROMPT: &str = "Antworte nur mit OK.";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepView {
    pub(super) template: String,
    pub(super) label: String,
    pub(super) base_url: String,
    pub(super) host: String,
    pub(super) model: String,
    pub(super) loopback: bool,
    pub(super) confirmed: bool,
    pub(super) key: Option<KeyStore>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CloudView {
    pub(super) steps: BTreeMap<Step, StepView>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn clean_key(key: Option<String>) -> Option<String> {
    key.map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= MAX_MODEL_NAME && !model.chars().any(char::is_control)
}

fn body(request: ChatRequest, model: &str, token_field: TokenField) -> Result<Value, ErrorClass> {
    let mut value = serde_json::to_value(request).map_err(|_| ErrorClass::InvalidRequest)?;
    let object = value.as_object_mut().ok_or(ErrorClass::InvalidRequest)?;
    for field in ["seed", "top_p", "logprobs", "stream"] {
        object.remove(field);
    }
    if let Some(tokens) = object.remove("max_tokens") {
        object.insert(token_field.name().to_owned(), tokens);
    }
    object.insert("model".to_owned(), Value::String(model.to_owned()));
    Ok(value)
}

fn with_default_tokens(mut request: Value, step: Step, api: Api) -> Value {
    if api == Api::Anthropic
        && let Some(object) = request.as_object_mut()
    {
        object
            .entry("max_tokens")
            .or_insert_with(|| json!(anthropic::default_max_tokens(step)));
    }
    request
}

fn probe(step: Step) -> Value {
    match step {
        Step::Transcriber => json!({
            "messages": [{ "role": "user", "content": [
                { "type": "image_url", "image_url": { "url": PROBE_IMAGE } },
                { "type": "text", "text": PROBE_PROMPT },
            ] }],
            "temperature": 0,
            "max_tokens": 64,
        }),
        Step::Corrector => json!({
            "messages": [{ "role": "user", "content": PROBE_PROMPT }],
            "temperature": 0,
            "max_tokens": 64,
        }),
        Step::Reviewer => json!({
            "messages": [{ "role": "user", "content": "Antworte mit {\"ok\": true}." }],
            "temperature": 0,
            "max_tokens": 64,
            "response_format": { "type": "json_schema", "json_schema": {
                "name": "antwort",
                "schema": {
                    "type": "object",
                    "properties": { "ok": { "type": "boolean" } },
                    "required": ["ok"],
                    "additionalProperties": false,
                },
            } },
        }),
    }
}

fn probe_answer_valid(step: Step, response: &Value) -> bool {
    let Some(content) = response
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
    else {
        return false;
    };
    step != Step::Reviewer
        || serde_json::from_str::<Value>(content)
            .ok()
            .and_then(|answer| answer.get("ok").map(Value::is_boolean))
            .unwrap_or(false)
}

impl CloudState {
    fn load(&self) -> Config {
        Config::load(&self.config_path)
    }

    async fn step_view(&self, choice: &Choice) -> Option<StepView> {
        let resolved = choice.resolve().ok()?;
        let account = keys::account(&endpoint::normalize(&choice.base_url));
        let key = self.keys.get(&account).await.map(|(_, store)| store);
        let label = match resolved.template.base_url {
            Some(_) => resolved.template.label.clone(),
            None => resolved.endpoint.host.clone(),
        };
        Some(StepView {
            template: choice.template.clone(),
            label,
            base_url: endpoint::normalize(&choice.base_url),
            host: resolved.endpoint.host.clone(),
            model: choice.model.clone(),
            loopback: resolved.endpoint.loopback,
            confirmed: resolved.confirmed(),
            key,
        })
    }

    pub async fn view(&self) -> CloudView {
        let config = self.load();
        let mut steps = BTreeMap::new();
        for (step, choice) in &config.steps {
            if let Some(view) = self.step_view(choice).await {
                steps.insert(*step, view);
            }
        }
        CloudView { steps }
    }

    async fn forget_unused(&self, config: &Config, base_url: &str) {
        if !config.uses(base_url) {
            self.keys.delete(&keys::account(base_url)).await;
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn use_step(
        &self,
        step: Step,
        template_id: &str,
        base_url: &str,
        model: &str,
        key: Option<String>,
        confirmed: bool,
    ) -> Result<CloudView, CloudError> {
        let template = templates::find(template_id).ok_or(ErrorClass::NotConfigured)?;
        let base_url = endpoint::normalize(base_url);
        let endpoint = endpoint::parse(template, &base_url)?;
        let model = model.trim();
        if !valid_model(model) {
            return Err(ErrorClass::InvalidRequest.into());
        }
        let key = clean_key(key);
        if key.is_some() && !endpoint.secure() {
            return Err(ErrorClass::Insecure.into());
        }
        let account = keys::account(&base_url);
        if template.key == KeyNeed::Required
            && key.is_none()
            && self.keys.get(&account).await.is_none()
        {
            return Err(ErrorClass::KeyMissing.into());
        }

        let _guard = self.config_lock.lock().await;
        let mut config = self.load();
        let previous = config.steps.get(&step).cloned();
        let kept = previous.as_ref().and_then(|choice| {
            let resolved = choice.resolve().ok()?;
            let same = resolved.endpoint.host == endpoint.host && resolved.confirmed();
            if same { choice.consent.clone() } else { None }
        });
        let consent = if endpoint.loopback {
            None
        } else if confirmed {
            Some(Consent {
                host: endpoint.host.clone(),
                version: CONSENT_VERSION,
                at_ms: now_ms(),
            })
        } else {
            Some(kept.ok_or(ErrorClass::ConsentMissing)?)
        };
        if let Some(key) = &key {
            self.keys.set(&account, key).await;
        }
        config.steps.insert(
            step,
            Choice {
                template: template.id.clone(),
                base_url: base_url.clone(),
                model: model.to_owned(),
                consent,
            },
        );
        config.save(&self.config_path)?;
        if confirmed && !endpoint.loopback {
            diagnostics::record(
                "cloud_consent",
                json!({ "template": template.id, "step": step.name() }),
            );
        }
        if let Some(previous) = previous {
            self.forget_unused(&config, &endpoint::normalize(&previous.base_url))
                .await;
        }
        drop(_guard);
        Ok(self.view().await)
    }

    pub async fn set_key(&self, step: Step, key: Option<String>) -> Result<CloudView, CloudError> {
        let config = self.load();
        let choice = config.steps.get(&step).ok_or(ErrorClass::NotConfigured)?;
        let resolved = choice.resolve()?;
        let key = clean_key(key).ok_or(ErrorClass::KeyMissing)?;
        if !resolved.endpoint.secure() {
            return Err(ErrorClass::Insecure.into());
        }
        self.keys
            .set(&keys::account(&endpoint::normalize(&choice.base_url)), &key)
            .await;
        Ok(self.view().await)
    }

    pub async fn clear(&self, step: Step) -> Result<CloudView, CloudError> {
        let _guard = self.config_lock.lock().await;
        let mut config = self.load();
        if let Some(removed) = config.steps.remove(&step) {
            config.save(&self.config_path)?;
            diagnostics::record(
                "cloud_revoke",
                json!({ "template": removed.template, "step": step.name() }),
            );
            self.forget_unused(&config, &endpoint::normalize(&removed.base_url))
                .await;
        }
        drop(_guard);
        Ok(self.view().await)
    }

    fn register(&self, id: String) -> Option<oneshot::Receiver<()>> {
        let mut requests = self
            .requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(index) = requests
            .cancelled_early
            .iter()
            .position(|early| *early == id)
        {
            requests.cancelled_early.remove(index);
            return None;
        }
        let (sender, receiver) = oneshot::channel();
        requests.pending.insert(id, sender);
        Some(receiver)
    }

    fn unregister(&self, id: &str) {
        self.requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        let mut requests = self
            .requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(sender) = requests.pending.remove(id) {
            return sender.send(()).is_ok();
        }
        if requests.cancelled_early.len() >= 64 {
            requests.cancelled_early.remove(0);
        }
        requests.cancelled_early.push(id.to_owned());
        false
    }

    pub async fn chat(
        &self,
        request_id: Option<String>,
        step: Step,
        request: Value,
    ) -> Result<Value, CloudError> {
        let config = self.load();
        let choice = config.steps.get(&step).ok_or(ErrorClass::NotConfigured)?;
        let resolved = choice.resolve()?;
        if !resolved.confirmed() {
            return Err(ErrorClass::ConsentMissing.into());
        }
        let request = with_default_tokens(request, step, resolved.template.api);
        let parsed = ChatRequest::parse(request).map_err(|_| ErrorClass::InvalidRequest)?;
        if parsed.has_images() && step != Step::Transcriber {
            return Err(ErrorClass::InvalidRequest.into());
        }
        let endpoint = &resolved.endpoint;
        let account = keys::account(&endpoint::normalize(&choice.base_url));
        let key = self.keys.get(&account).await.map(|(key, _)| key);
        if key.is_none() && resolved.template.key == KeyNeed::Required {
            return Err(ErrorClass::KeyMissing.into());
        }
        if key.is_some() && !endpoint.secure() {
            return Err(ErrorClass::Insecure.into());
        }
        let pinned = if endpoint.needs_pinning() {
            pinned_addresses(endpoint).await?
        } else {
            Vec::new()
        };
        let body = body(parsed, &choice.model, resolved.template.token_field)?;
        let body = match resolved.template.api {
            Api::Openai => body,
            Api::Anthropic => anthropic::request(&body)?,
        };
        let bytes = body.to_string().len();
        let started = Instant::now();
        let send = self.sender.post(endpoint, &pinned, key.as_deref(), &body);
        let outcome = match request_id {
            None => Some(send.await),
            Some(id) => match self.register(id.clone()) {
                None => None,
                Some(cancelled) => {
                    let outcome = tokio::select! {
                        outcome = send => Some(outcome),
                        _ = cancelled => None,
                    };
                    self.unregister(&id);
                    outcome
                }
            },
        };
        let (result, attempts, status) = match outcome {
            Some(outcome) => (outcome.result, outcome.attempts, outcome.status),
            None => (Err(ErrorClass::Cancelled), 0, None),
        };
        diagnostics::record(
            "cloud_request",
            json!({
                "template": resolved.template.id,
                "step": step.name(),
                "ms": started.elapsed().as_millis() as u64,
                "attempts": attempts,
                "bytes": bytes,
                "status": status,
                "outcome": match &result { Ok(_) => "ok", Err(class) => class.name() },
            }),
        );
        result.map_err(CloudError::from)
    }

    pub async fn models(
        &self,
        template_id: &str,
        base_url: &str,
        key: Option<String>,
    ) -> Result<Vec<RemoteModel>, CloudError> {
        let template = templates::find(template_id).ok_or(ErrorClass::NotConfigured)?;
        if template.api != Api::Anthropic {
            return Err(ErrorClass::InvalidRequest.into());
        }
        let base_url = endpoint::normalize(base_url);
        let endpoint = endpoint::parse(template, &base_url)?;
        let key = match clean_key(key) {
            Some(key) => key,
            None => self
                .keys
                .get(&keys::account(&base_url))
                .await
                .map(|(key, _)| key)
                .ok_or(ErrorClass::KeyMissing)?,
        };
        let started = Instant::now();
        let mut models = Vec::new();
        let mut after: Option<String> = None;
        let mut result = Ok(());
        let mut attempts = 0;
        let mut status = None;
        for _ in 0..anthropic::MODELS_MAX_PAGES {
            let outcome = self
                .sender
                .run(
                    &endpoint,
                    &[],
                    Some(&key),
                    Job::Models {
                        after: after.as_deref(),
                    },
                )
                .await;
            attempts += outcome.attempts;
            status = outcome.status;
            let page = outcome
                .result
                .and_then(|value| anthropic::models_page(&value));
            match page {
                Ok(page) => {
                    models.extend(page.models);
                    after = page.next;
                    if after.is_none() {
                        break;
                    }
                }
                Err(class) => {
                    result = Err(class);
                    break;
                }
            }
        }
        diagnostics::record(
            "cloud_models",
            json!({
                "template": template.id,
                "ms": started.elapsed().as_millis() as u64,
                "attempts": attempts,
                "status": status,
                "outcome": match &result { Ok(()) => "ok", Err(class) => class.name() },
            }),
        );
        result?;
        Ok(models)
    }

    pub async fn check(&self, step: Step) -> Result<(), CloudError> {
        let response = self.chat(None, step, probe(step)).await?;
        if probe_answer_valid(step, &response) {
            Ok(())
        } else {
            Err(ErrorClass::InvalidResponse.into())
        }
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(dir) = app.path().app_data_dir() {
        app.manage(CloudState::new(dir, Keys::system()));
    }
}

#[tauri::command]
pub async fn cloud_config(state: State<'_, CloudState>) -> Result<CloudView, CloudError> {
    Ok(state.view().await)
}

#[tauri::command]
pub async fn cloud_use(
    state: State<'_, CloudState>,
    step: Step,
    template: String,
    base_url: String,
    model: String,
    key: Option<String>,
    confirmed: bool,
) -> Result<CloudView, CloudError> {
    state
        .use_step(step, &template, &base_url, &model, key, confirmed)
        .await
}

#[tauri::command]
pub async fn cloud_set_key(
    state: State<'_, CloudState>,
    step: Step,
    key: Option<String>,
) -> Result<CloudView, CloudError> {
    state.set_key(step, key).await
}

#[tauri::command]
pub async fn cloud_clear(
    state: State<'_, CloudState>,
    step: Step,
) -> Result<CloudView, CloudError> {
    state.clear(step).await
}

#[tauri::command]
pub async fn cloud_models(
    state: State<'_, CloudState>,
    template: String,
    base_url: String,
    key: Option<String>,
) -> Result<Vec<RemoteModel>, CloudError> {
    state.models(&template, &base_url, key).await
}

#[tauri::command]
pub async fn cloud_check(state: State<'_, CloudState>, step: Step) -> Result<(), CloudError> {
    state.check(step).await
}

#[tauri::command]
pub async fn cloud_chat(
    state: State<'_, CloudState>,
    request_id: Option<String>,
    step: Step,
    request: Value,
) -> Result<Value, CloudError> {
    state.chat(request_id, step, request).await
}

#[tauri::command]
pub fn cloud_cancel(state: State<'_, CloudState>, request_id: String) -> bool {
    state.cancel(&request_id)
}
