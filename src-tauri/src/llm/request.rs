use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::runtime::LlmError;

pub const MAX_OUTPUT_TOKENS: u32 = 4096;
const DEFAULT_OUTPUT_TOKENS: u32 = 2048;
const MAX_REPEAT_PENALTY: f32 = 2.0;
pub const MAX_IMAGE_URL_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMAGES: usize = 8;
const IMAGE_PREFIXES: [&str; 3] = [
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
];

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ChatRequest {
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repeat_penalty: Option<f32>,
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logprobs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    #[serde(default, skip_deserializing)]
    stream: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ResponseFormat {
    JsonSchema { json_schema: JsonSchema },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct JsonSchema {
    name: String,
    schema: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Message {
    role: Role,
    content: Content,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Parts(Vec<Part>),
}

impl<'de> Deserialize<'de> for Content {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match Value::deserialize(deserializer)? {
            Value::String(text) => Ok(Self::Text(text)),
            parts @ Value::Array(_) => serde_json::from_value(parts)
                .map(Self::Parts)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom(
                "content must be a string or a list of parts",
            )),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Part {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ImageUrl {
    url: String,
}

fn invalid(message: impl Into<String>) -> LlmError {
    LlmError::InvalidRequest(message.into())
}

fn check_image(url: &str) -> Result<(), LlmError> {
    let payload = IMAGE_PREFIXES
        .iter()
        .find_map(|prefix| url.strip_prefix(prefix))
        .ok_or_else(|| invalid("images must be PNG, JPEG or WebP data URLs"))?;
    if url.len() > MAX_IMAGE_URL_BYTES {
        return Err(invalid(format!(
            "image data URL exceeds {MAX_IMAGE_URL_BYTES} bytes"
        )));
    }
    let base64 = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=');
    if payload.is_empty() || !payload.bytes().all(base64) {
        return Err(invalid("image data is not base64"));
    }
    Ok(())
}

impl ChatRequest {
    pub fn has_images(&self) -> bool {
        self.messages.iter().any(|message| match &message.content {
            Content::Parts(parts) => parts
                .iter()
                .any(|part| matches!(part, Part::ImageUrl { .. })),
            Content::Text(_) => false,
        })
    }

    pub fn parse(value: Value) -> Result<Self, LlmError> {
        let mut request: Self =
            serde_json::from_value(value).map_err(|e| invalid(e.to_string()))?;
        if request.messages.is_empty() {
            return Err(invalid("messages must not be empty"));
        }
        let images: Vec<&str> = request
            .messages
            .iter()
            .filter_map(|message| match &message.content {
                Content::Parts(parts) => Some(parts),
                Content::Text(_) => None,
            })
            .flatten()
            .filter_map(|part| match part {
                Part::ImageUrl { image_url } => Some(image_url.url.as_str()),
                Part::Text { .. } => None,
            })
            .collect();
        if images.len() > MAX_IMAGES {
            return Err(invalid(format!("at most {MAX_IMAGES} images per request")));
        }
        images.into_iter().try_for_each(check_image)?;
        if let Some(penalty) = request.repeat_penalty
            && !(1.0..=MAX_REPEAT_PENALTY).contains(&penalty)
        {
            return Err(invalid(format!(
                "repeat_penalty must be between 1 and {MAX_REPEAT_PENALTY}"
            )));
        }
        match request.max_tokens {
            Some(0) => return Err(invalid("max_tokens must be positive")),
            Some(tokens) if tokens > MAX_OUTPUT_TOKENS => {
                return Err(invalid(format!(
                    "max_tokens must not exceed {MAX_OUTPUT_TOKENS}"
                )));
            }
            Some(_) => {}
            None => request.max_tokens = Some(DEFAULT_OUTPUT_TOKENS),
        }
        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";

    fn vision(url: &str) -> Value {
        json!({
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "image_url", "image_url": { "url": url } },
                    { "type": "text", "text": "Transkribiere." },
                ],
            }],
        })
    }

    fn rejection(value: Value) -> String {
        match ChatRequest::parse(value) {
            Err(LlmError::InvalidRequest(message)) => message,
            other => panic!("expected an invalid request, got {other:?}"),
        }
    }

    #[test]
    fn forwards_allowed_fields_without_streaming_and_with_a_token_limit() {
        let request = ChatRequest::parse(json!({
            "messages": [{ "role": "user", "content": "Hallo" }],
            "temperature": 0.0,
            "seed": 7,
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({
                "messages": [{ "role": "user", "content": "Hallo" }],
                "temperature": 0.0,
                "seed": 7,
                "max_tokens": DEFAULT_OUTPUT_TOKENS,
                "stream": false,
            })
        );
    }

    #[test]
    fn forwards_a_repeat_penalty_within_bounds() {
        let mut request = vision(PNG);
        request["repeat_penalty"] = json!(1.5);
        let body = serde_json::to_value(ChatRequest::parse(request).unwrap()).unwrap();
        assert_eq!(body["repeat_penalty"], json!(1.5));
        let body = serde_json::to_value(ChatRequest::parse(vision(PNG)).unwrap()).unwrap();
        assert!(body.get("repeat_penalty").is_none());
        for penalty in [0.5, 2.5, -1.0] {
            let mut request = vision(PNG);
            request["repeat_penalty"] = json!(penalty);
            assert!(rejection(request).contains("repeat_penalty"), "{penalty}");
        }
    }

    #[test]
    fn forwards_logprobs_only_when_requested() {
        let mut request = vision(PNG);
        request["logprobs"] = json!(true);
        let body = serde_json::to_value(ChatRequest::parse(request).unwrap()).unwrap();
        assert_eq!(body["logprobs"], json!(true));
        let body = serde_json::to_value(ChatRequest::parse(vision(PNG)).unwrap()).unwrap();
        assert!(body.get("logprobs").is_none());
        for field in ["top_logprobs", "n_probs"] {
            let mut request = vision(PNG);
            request[field] = json!(5);
            assert!(rejection(request).contains("unknown field"), "{field}");
        }
        let mut request = vision(PNG);
        request["logprobs"] = json!(5);
        assert!(rejection(request).contains("invalid type"));
    }

    #[test]
    fn forwards_a_json_schema_and_nothing_else_as_response_format() {
        let schema = json!({ "type": "object", "properties": { "ok": { "type": "boolean" } } });
        let mut request = vision(PNG);
        request["response_format"] = json!({ "type": "json_schema", "json_schema": { "name": "antwort", "schema": schema } });
        let body = serde_json::to_value(ChatRequest::parse(request).unwrap()).unwrap();
        assert_eq!(body["response_format"]["type"], "json_schema");
        assert_eq!(body["response_format"]["json_schema"]["schema"], schema);
        let body = serde_json::to_value(ChatRequest::parse(vision(PNG)).unwrap()).unwrap();
        assert!(body.get("response_format").is_none());
        for format in [
            json!({ "type": "json_object" }),
            json!({ "type": "json_schema", "json_schema": { "name": "a", "schema": "x" } }),
            json!({ "type": "json_schema", "json_schema": { "name": "a", "schema": {}, "url": "x" } }),
        ] {
            let mut request = vision(PNG);
            request["response_format"] = format.clone();
            assert!(ChatRequest::parse(request).is_err(), "{format}");
        }
    }

    #[test]
    fn accepts_inline_images() {
        let request = ChatRequest::parse(vision(PNG)).unwrap();
        let body = serde_json::to_value(request).unwrap();
        assert_eq!(body["messages"][0]["content"][0]["image_url"]["url"], PNG);
    }

    #[test]
    fn rejects_images_the_server_would_fetch_itself() {
        for url in [
            "https://example.com/scan.png",
            "http://127.0.0.1/scan.png",
            "file:///etc/passwd",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png,raw",
        ] {
            assert!(rejection(vision(url)).contains("data URLs"), "{url}");
        }
        assert!(rejection(vision("data:image/png;base64,a b")).contains("base64"));
    }

    #[test]
    fn rejects_oversized_images() {
        let url = format!("{PNG}{}", "A".repeat(MAX_IMAGE_URL_BYTES));
        assert!(rejection(vision(&url)).contains("exceeds"));
    }

    #[test]
    fn rejects_fields_outside_the_allowlist() {
        let mut request = vision(PNG);
        request["stream"] = json!(true);
        assert!(rejection(request).contains("unknown field"));
        let mut request = vision(PNG);
        request["messages"][0]["content"][0]["image_url"]["detail"] = json!("high");
        assert!(rejection(request).contains("unknown field"));
        assert!(!rejection(json!({ "messages": [{ "role": "tool", "content": "x" }] })).is_empty());
    }

    #[test]
    fn limits_output_tokens() {
        let mut request = vision(PNG);
        request["max_tokens"] = json!(MAX_OUTPUT_TOKENS + 1);
        assert!(rejection(request).contains("max_tokens"));
        assert!(rejection(json!({ "messages": [] })).contains("empty"));
    }
}
