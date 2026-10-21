use serde::Serialize;
use serde_json::{Map, Value, json};

use super::{ErrorClass, Step};

pub const VERSION: &str = "2023-06-01";
pub const MODELS_PAGE_SIZE: u32 = 1000;
pub const MODELS_MAX_PAGES: usize = 5;

const UNSUPPORTED_KEYWORDS: [&str; 7] = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub display_name: String,
}

pub fn default_max_tokens(step: Step) -> u32 {
    match step {
        Step::Transcriber | Step::Corrector => 4096,
        Step::Reviewer => 512,
    }
}

fn clean_schema(schema: &mut Map<String, Value>) {
    for keyword in UNSUPPORTED_KEYWORDS {
        schema.remove(keyword);
    }
    if schema
        .get("minItems")
        .and_then(Value::as_u64)
        .is_some_and(|min| min > 1)
    {
        schema.remove("minItems");
    }
    schema.remove("maxItems");
    if schema.get("type").and_then(Value::as_str) == Some("object") {
        schema.insert("additionalProperties".to_owned(), Value::Bool(false));
    }
    for keyword in ["properties", "$defs"] {
        if let Some(Value::Object(children)) = schema.get_mut(keyword) {
            children
                .values_mut()
                .filter_map(Value::as_object_mut)
                .for_each(clean_schema);
        }
    }
    if let Some(Value::Object(items)) = schema.get_mut("items") {
        clean_schema(items);
    }
    for keyword in ["anyOf", "allOf"] {
        if let Some(Value::Array(branches)) = schema.get_mut(keyword) {
            branches
                .iter_mut()
                .filter_map(Value::as_object_mut)
                .for_each(clean_schema);
        }
    }
}

fn image_block(url: &str) -> Result<Value, ErrorClass> {
    let (media_type, data) = url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or(ErrorClass::InvalidRequest)?;
    Ok(json!({
        "type": "image",
        "source": { "type": "base64", "media_type": media_type, "data": data },
    }))
}

fn text_of(content: &Value) -> Result<String, ErrorClass> {
    match content {
        Value::String(text) => Ok(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .map(|part| match part.get("text").and_then(Value::as_str) {
                Some(text) if part.get("type") == Some(&json!("text")) => Ok(text),
                _ => Err(ErrorClass::InvalidRequest),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|texts| texts.join("\n\n")),
        _ => Err(ErrorClass::InvalidRequest),
    }
}

fn content_blocks(content: &Value) -> Result<Value, ErrorClass> {
    let Value::Array(parts) = content else {
        return Ok(content.clone());
    };
    parts
        .iter()
        .map(|part| match part.get("type").and_then(Value::as_str) {
            Some("text") => Ok(json!({ "type": "text", "text": part.get("text") })),
            Some("image_url") => image_block(
                part.pointer("/image_url/url")
                    .and_then(Value::as_str)
                    .ok_or(ErrorClass::InvalidRequest)?,
            ),
            _ => Err(ErrorClass::InvalidRequest),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

pub fn request(body: &Value) -> Result<Value, ErrorClass> {
    let source = body.as_object().ok_or(ErrorClass::InvalidRequest)?;
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in source
        .get("messages")
        .and_then(Value::as_array)
        .ok_or(ErrorClass::InvalidRequest)?
    {
        let content = message.get("content").ok_or(ErrorClass::InvalidRequest)?;
        match message.get("role").and_then(Value::as_str) {
            Some("system") => system.push(text_of(content)?),
            Some(role @ ("user" | "assistant")) => {
                messages.push(json!({ "role": role, "content": content_blocks(content)? }));
            }
            _ => return Err(ErrorClass::InvalidRequest),
        }
    }
    let mut out = Map::new();
    for field in ["model", "max_tokens"] {
        out.insert(
            field.to_owned(),
            source
                .get(field)
                .cloned()
                .ok_or(ErrorClass::InvalidRequest)?,
        );
    }
    out.insert("messages".to_owned(), Value::Array(messages));
    if !system.is_empty() {
        out.insert("system".to_owned(), Value::String(system.join("\n\n")));
    }
    if let Some(stop) = source.get("stop") {
        out.insert("stop_sequences".to_owned(), stop.clone());
    }
    if let Some(format) = source.get("response_format") {
        let mut schema = format
            .pointer("/json_schema/schema")
            .and_then(Value::as_object)
            .cloned()
            .ok_or(ErrorClass::InvalidRequest)?;
        clean_schema(&mut schema);
        out.insert(
            "output_config".to_owned(),
            json!({ "format": { "type": "json_schema", "schema": schema } }),
        );
    }
    Ok(Value::Object(out))
}

pub fn response(value: &Value) -> Result<Value, ErrorClass> {
    let blocks = value
        .get("content")
        .and_then(Value::as_array)
        .ok_or(ErrorClass::InvalidResponse)?;
    let text: String = blocks
        .iter()
        .filter(|block| block.get("type") == Some(&json!("text")))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect();
    let finish = match value.get("stop_reason").and_then(Value::as_str) {
        Some("max_tokens" | "model_context_window_exceeded") => "length",
        Some("refusal") => "content_filter",
        _ => "stop",
    };
    let tokens = |field: &str| {
        value
            .pointer(&format!("/usage/{field}"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let (input, output) = (tokens("input_tokens"), tokens("output_tokens"));
    Ok(json!({
        "choices": [{
            "index": 0,
            "finish_reason": finish,
            "message": { "role": "assistant", "content": text },
        }],
        "usage": {
            "prompt_tokens": input,
            "completion_tokens": output,
            "total_tokens": input + output,
        },
    }))
}

pub struct ModelsPage {
    pub models: Vec<RemoteModel>,
    pub next: Option<String>,
}

pub fn models_page(value: &Value) -> Result<ModelsPage, ErrorClass> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or(ErrorClass::InvalidResponse)?;
    let models = data
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            let display_name = entry
                .get("display_name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(RemoteModel {
                id: id.to_owned(),
                display_name: display_name.to_owned(),
            })
        })
        .collect();
    let more = value.get("has_more") == Some(&json!(true));
    let next = more
        .then(|| value.get("last_id").and_then(Value::as_str))
        .flatten()
        .map(str::to_owned);
    Ok(ModelsPage { models, next })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_system_text_images_and_stop() {
        let body = json!({
            "model": "m",
            "max_tokens": 50,
            "stop": ["###"],
            "messages": [
                { "role": "system", "content": "Sei streng." },
                { "role": "user", "content": [
                    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,AAAA" } },
                    { "type": "text", "text": "Lies." },
                ] },
            ],
        });
        assert_eq!(
            request(&body).unwrap(),
            json!({
                "model": "m",
                "max_tokens": 50,
                "system": "Sei streng.",
                "stop_sequences": ["###"],
                "messages": [{ "role": "user", "content": [
                    { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "AAAA" } },
                    { "type": "text", "text": "Lies." },
                ] }],
            })
        );
    }

    #[test]
    fn leaves_out_sampling_parameters() {
        let body = json!({
            "model": "m",
            "max_tokens": 5,
            "temperature": 0,
            "messages": [{ "role": "user", "content": "x" }],
        });
        assert!(request(&body).unwrap().get("temperature").is_none());
    }

    #[test]
    fn json_schema_becomes_output_config_without_unsupported_keywords() {
        let body = json!({
            "model": "m",
            "max_tokens": 5,
            "messages": [{ "role": "user", "content": "x" }],
            "response_format": { "type": "json_schema", "json_schema": {
                "name": "antwort",
                "schema": {
                    "type": "object",
                    "properties": {
                        "score": { "type": "integer", "minimum": 0, "maximum": 3 },
                        "minimum": { "type": "string", "maxLength": 10 },
                        "list": { "type": "array", "minItems": 2, "items": {
                            "type": "object",
                            "properties": { "a": { "type": "number", "multipleOf": 2 } },
                            "required": ["a"],
                        } },
                    },
                    "required": ["score", "minimum", "list"],
                    "additionalProperties": false,
                },
            } },
        });
        assert_eq!(
            request(&body).unwrap()["output_config"],
            json!({ "format": { "type": "json_schema", "schema": {
                "type": "object",
                "properties": {
                    "score": { "type": "integer" },
                    "minimum": { "type": "string" },
                    "list": { "type": "array", "items": {
                        "type": "object",
                        "properties": { "a": { "type": "number" } },
                        "required": ["a"],
                        "additionalProperties": false,
                    } },
                },
                "required": ["score", "minimum", "list"],
                "additionalProperties": false,
            } } })
        );
    }

    #[test]
    fn rejects_parts_it_cannot_translate() {
        let bad_image = json!({ "model": "m", "max_tokens": 5, "messages": [
            { "role": "user", "content": [
                { "type": "image_url", "image_url": { "url": "https://x.example/a.png" } },
            ] },
        ] });
        assert_eq!(request(&bad_image).unwrap_err(), ErrorClass::InvalidRequest);
        let tool = json!({ "model": "m", "max_tokens": 5, "messages": [
            { "role": "tool", "content": "x" },
        ] });
        assert_eq!(request(&tool).unwrap_err(), ErrorClass::InvalidRequest);
    }

    #[test]
    fn answers_come_back_in_the_chat_completions_shape() {
        let answer = json!({
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "content": [
                { "type": "thinking", "thinking": "..." },
                { "type": "text", "text": "{\"ok\":" },
                { "type": "text", "text": " true}" },
            ],
            "stop_reason": "max_tokens",
            "usage": { "input_tokens": 12, "output_tokens": 3 },
        });
        assert_eq!(
            response(&answer).unwrap(),
            json!({
                "choices": [{
                    "index": 0,
                    "finish_reason": "length",
                    "message": { "role": "assistant", "content": "{\"ok\": true}" },
                }],
                "usage": { "prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15 },
            })
        );
        assert_eq!(
            response(&json!({ "content": "x" })).unwrap_err(),
            ErrorClass::InvalidResponse
        );
    }

    #[test]
    fn model_pages_carry_the_cursor_only_while_more_follow() {
        let page = models_page(&json!({
            "data": [
                { "id": "a-1", "display_name": "A One", "type": "model" },
                { "id": "b-2", "type": "model" },
                { "display_name": "no id" },
            ],
            "has_more": true,
            "last_id": "b-2",
        }))
        .unwrap();
        assert_eq!(
            page.models,
            vec![
                RemoteModel {
                    id: "a-1".into(),
                    display_name: "A One".into()
                },
                RemoteModel {
                    id: "b-2".into(),
                    display_name: "b-2".into()
                },
            ]
        );
        assert_eq!(page.next.as_deref(), Some("b-2"));
        let last = models_page(&json!({ "data": [], "has_more": false, "last_id": "x" })).unwrap();
        assert!(last.next.is_none());
    }
}
