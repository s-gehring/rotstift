use std::sync::LazyLock;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyNeed {
    Required,
    Optional,
    None,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Api {
    #[default]
    Openai,
    Anthropic,
    Cli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenField {
    MaxTokens,
    MaxCompletionTokens,
}

impl TokenField {
    pub fn name(self) -> &'static str {
        match self {
            Self::MaxTokens => "max_tokens",
            Self::MaxCompletionTokens => "max_completion_tokens",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub short_label: Option<String>,
    pub base_url: Option<String>,
    pub key: KeyNeed,
    pub token_field: TokenField,
    #[serde(default)]
    pub api: Api,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub cli: Option<CliTemplate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTemplate {
    pub adapter: String,
    pub models: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TemplateFile {
    templates: Vec<Template>,
}

static TEMPLATES: LazyLock<Vec<Template>> = LazyLock::new(|| {
    serde_json::from_str::<TemplateFile>(include_str!("../../cloud-providers.json"))
        .map(|file| file.templates)
        .unwrap_or_default()
});

pub fn find(id: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|template| template.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_template_parses_and_fixed_urls_use_https() {
        assert_eq!(TEMPLATES.len(), 10);
        for template in TEMPLATES.iter() {
            assert_eq!(
                template.api == Api::Cli,
                template.cli.is_some(),
                "{}",
                template.id
            );
            let Some(url) = &template.base_url else {
                continue;
            };
            if template.api == Api::Cli {
                assert!(url.starts_with("cli://"), "{}", template.id);
                assert_eq!(template.key, KeyNeed::None, "{}", template.id);
            } else {
                assert!(url.starts_with("https://"), "{}", template.id);
                assert_eq!(template.key, KeyNeed::Required, "{}", template.id);
            }
        }
        assert!(!find("claude-code").unwrap().hidden);
        assert!(!find("codex").unwrap().hidden);
        assert!(find("server").unwrap().base_url.is_none());
        assert_eq!(find("anthropic").unwrap().api, Api::Anthropic);
        assert_eq!(find("mistral").unwrap().api, Api::Openai);
    }
}
