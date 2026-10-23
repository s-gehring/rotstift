#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{Value, json};

use super::codex::{self, Codex, MIN_VERSION};
use super::tests::{beside, runtime, world};
use super::*;

const PREAMBLE: &str = r#"#!/bin/sh
dir=$(dirname "$0")
if [ "$1" = "--version" ]; then echo "codex-cli 0.164.0"; exit 0; fi
printf '%s\n' "$@" > "$dir/args.txt"
env > "$dir/env.txt"
ls -l > "$dir/ls.txt"
cp schema.json "$dir/schema.json" 2>/dev/null
cat page-1.png > "$dir/page.bin" 2>/dev/null
pwd > "$dir/cwd.txt"
cat > "$dir/stdin.txt"
"#;

const OK: &str = r#"echo '{"type":"thread.started","thread_id":"t"}'
echo '{"type":"turn.started"}'
echo '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"denkt"}}'
echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Antwort"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":7,"cached_input_tokens":0,"output_tokens":3}}'
"#;

const OK_SCHEMA: &str = r#"echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"{\"ok\":true}"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
"#;

const RECONNECTED: &str = r#"echo '{"type":"error","message":"Reconnecting... 1/5"}'
echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Antwort"}}'
echo '{"type":"turn.completed","usage":{}}'
"#;

fn tool(kind: &str) -> String {
    format!(
        r#"echo '{{"type":"item.started","item":{{"id":"i0","type":"{kind}"}}}}'
echo '{{"type":"item.completed","item":{{"id":"i1","type":"agent_message","text":"Antwort"}}}}'
echo '{{"type":"turn.completed","usage":{{}}}}'
"#
    )
}

fn failed(message: &str) -> String {
    format!(
        r#"echo '{{"type":"turn.started"}}'
echo '{{"type":"error","message":"{message}"}}'
echo '{{"type":"turn.failed","error":{{"message":"{message}"}}}}'
exit 1
"#
    )
}

fn fake_codex(name: &str, body: &str) -> PathBuf {
    let dir = world().join(format!("codex-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("codex");
    std::fs::write(&path, format!("{PREAMBLE}{body}")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn request(body: Value) -> Prompt {
    Prompt::from_body(&body, "gpt-5").unwrap()
}

fn text_request() -> Value {
    json!({
        "messages": [
            { "role": "system", "content": "Korrigiere den Text." },
            { "role": "user", "content": "Ein selbst geschriebener Satz mit [Person 1]." },
        ],
        "max_tokens": 200,
    })
}

fn schema_request() -> Value {
    json!({
        "messages": [{ "role": "user", "content": "Antworte mit {\"ok\": true}." }],
        "response_format": { "type": "json_schema", "json_schema": {
            "name": "antwort",
            "schema": {
                "type": "object",
                "properties": { "ok": { "type": "boolean" } },
                "required": ["ok"],
                "additionalProperties": false,
            },
        } },
    })
}

fn image_request() -> Value {
    json!({
        "messages": [{ "role": "user", "content": [
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,QUJD" } },
            { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,REVG" } },
            { "type": "text", "text": "Lies die Seite." },
        ] }],
    })
}

async fn run(cli: &Path, prompt: &Prompt) -> Result<Value, ErrorClass> {
    chat(&runtime(Duration::from_secs(10)), &Codex, cli, prompt)
        .await
        .0
}

fn strings(args: Vec<OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.into_string().unwrap())
        .collect()
}

#[test]
fn the_codex_arguments_shield_the_cli_and_carry_no_student_data() {
    let args = strings(codex::arguments(&request(text_request()), &[]));
    assert_eq!(
        args,
        [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox",
            "read-only",
            "--json",
            "--model",
            "gpt-5",
            "-c",
            "features.shell_tool=false",
            "-c",
            "web_search=\"disabled\"",
            "-c",
            "features.apps=false",
            "-c",
            "features.plugins=false",
            "-c",
            "features.hooks=false",
            "-c",
            "features.memories=false",
            "-c",
            "features.multi_agent=false",
            "-c",
            "mcp_servers={}",
            "-c",
            "history.persistence=\"none\"",
            "-c",
            "project_doc_max_bytes=0",
            "-",
        ]
    );
    for forbidden in ["--yolo", "--dangerously-bypass-approvals-and-sandbox"] {
        assert!(!args.iter().any(|arg| arg == forbidden));
    }

    let prompt = request(schema_request());
    let args = strings(codex::arguments(&prompt, &[]));
    assert_eq!(
        args[args.len() - 3..],
        ["--output-schema", "schema.json", "-"]
    );

    let images = codex::images(&request(image_request())).unwrap();
    let args = strings(codex::arguments(&request(image_request()), &images));
    assert_eq!(
        args[args.len() - 2..],
        ["--image=page-1.png,page-2.jpg", "-"]
    );
}

#[test]
fn schemas_follow_the_strict_rules() {
    let form = json!({
        "type": "object",
        "properties": { "textform": { "enum": ["Brief", "keine"] } },
        "required": ["textform"],
        "additionalProperties": false,
    });
    assert_eq!(
        codex::strict_schema(&form)["properties"]["textform"],
        json!({ "enum": ["Brief", "keine"], "type": "string" })
    );

    let question = json!({
        "type": "object",
        "properties": {
            "erfuellt": { "type": "boolean" },
            "zitat": { "type": "string", "maxLength": 60 },
        },
        "required": ["erfuellt", "zitat"],
        "additionalProperties": false,
    });
    let strict = codex::strict_schema(&question);
    assert!(strict["properties"]["zitat"].get("maxLength").is_none());
    assert_eq!(strict["required"], json!(["erfuellt", "zitat"]));

    let detector = json!({
        "type": "object",
        "properties": {
            "kennungen": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "zitat": { "type": "string", "maxLength": 48 },
                    "kategorie": { "type": "string", "enum": ["Person", "Ort"] },
                },
                "required": ["zitat", "kategorie"],
            } },
        },
        "required": ["kennungen"],
    });
    let strict = codex::strict_schema(&detector);
    assert_eq!(strict["additionalProperties"], false);
    let item = &strict["properties"]["kennungen"]["items"];
    assert_eq!(item["additionalProperties"], false);
    assert_eq!(item["required"].as_array().unwrap().len(), 2);
    assert!(item["properties"]["zitat"].get("maxLength").is_none());
    assert_eq!(
        item["properties"]["kategorie"]["enum"],
        json!(["Person", "Ort"])
    );
}

#[test]
fn images_are_decoded_and_only_known_types_pass() {
    let images = codex::images(&request(image_request())).unwrap();
    assert_eq!(
        images,
        [
            ("page-1.png".to_owned(), b"ABC".to_vec()),
            ("page-2.jpg".to_owned(), b"DEF".to_vec()),
        ]
    );
    let svg = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/svg+xml;base64,QUJD" } },
    ] }] });
    assert_eq!(
        codex::images(&request(svg)).unwrap_err(),
        ErrorClass::InvalidRequest
    );
    let broken = json!({ "messages": [{ "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,Q=JD" } },
    ] }] });
    assert_eq!(
        codex::images(&request(broken)).unwrap_err(),
        ErrorClass::InvalidRequest
    );
}

#[test]
fn the_version_must_come_from_codex_and_reach_the_minimum() {
    assert_eq!(
        Codex.version("codex-cli 0.164.0\n").as_deref(),
        Some("0.164.0")
    );
    assert!(Codex.version("0.164.0").is_none());
    assert!(Codex.version("codex-cli 0.164").is_none());
    assert!(Codex.version("codex-cli 0.164.0-alpha.1").is_none());
    assert_eq!(MIN_VERSION, (0, 140, 0));
    assert!(Codex.outdated("0.139.9"));
    assert!(!Codex.outdated("0.140.0"));
    assert!(!Codex.outdated("1.0.0"));
}

#[tokio::test]
async fn an_old_codex_is_refused_when_it_is_chosen() {
    let cli = fake_codex("old", "");
    let script = std::fs::read_to_string(&cli)
        .unwrap()
        .replace("0.164.0", "0.139.0");
    std::fs::write(&cli, script).unwrap();
    assert_eq!(
        inspect(&runtime(Duration::from_secs(10)), &Codex, &cli)
            .await
            .unwrap_err(),
        ErrorClass::CliOutdated
    );
    let fresh = fake_codex("fresh", "");
    let info = inspect(&runtime(Duration::from_secs(10)), &Codex, &fresh)
        .await
        .unwrap();
    assert_eq!(info.version, "0.164.0");
}

#[tokio::test]
async fn a_text_step_sends_the_prompt_only_over_stdin() {
    let cli = fake_codex("text", OK);
    let answer = run(&cli, &request(text_request())).await.unwrap();
    assert_eq!(answer["choices"][0]["message"]["content"], "Antwort");
    assert_eq!(answer["usage"]["prompt_tokens"], 7);
    assert_eq!(answer["usage"]["completion_tokens"], 3);
    let stdin = beside(&cli, "stdin.txt");
    assert!(stdin.contains("<anweisungen>\nKorrigiere den Text.\n</anweisungen>"));
    assert!(stdin.contains("Ein selbst geschriebener Satz mit [Person 1]."));
    assert!(!beside(&cli, "args.txt").contains("Person"));
    assert!(!beside(&cli, "args.txt").contains("--output-schema"));

    let env = beside(&cli, "env.txt");
    for secret in [
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    ] {
        assert!(!env.contains(secret), "{secret}");
    }
    let cwd = PathBuf::from(beside(&cli, "cwd.txt").trim());
    assert!(!cwd.exists());
}

#[tokio::test]
async fn a_schema_goes_into_a_file_in_the_work_folder() {
    let cli = fake_codex("schema", OK_SCHEMA);
    let answer = run(&cli, &request(schema_request())).await.unwrap();
    assert_eq!(answer["choices"][0]["message"]["content"], "{\"ok\":true}");
    let schema: Value = serde_json::from_str(&beside(&cli, "schema.json")).unwrap();
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["required"], json!(["ok"]));
    let listing = beside(&cli, "ls.txt");
    assert!(listing.contains("-rw-------"));
    assert!(listing.contains("schema.json"));
    assert!(!beside(&cli, "stdin.txt").contains("additionalProperties"));
}

#[tokio::test]
async fn pages_become_private_files_that_vanish_with_the_folder() {
    let cli = fake_codex("images", OK);
    run(&cli, &request(image_request())).await.unwrap();
    assert_eq!(beside(&cli, "page.bin"), "ABC");
    let listing = beside(&cli, "ls.txt");
    assert!(listing.contains("-rw-------"));
    assert!(listing.contains("page-1.png"));
    assert!(listing.contains("page-2.jpg"));
    assert!(beside(&cli, "args.txt").contains("--image=page-1.png,page-2.jpg\n"));
    assert!(!beside(&cli, "stdin.txt").contains("QUJD"));
    assert!(!PathBuf::from(beside(&cli, "cwd.txt").trim()).exists());
}

#[tokio::test]
async fn reconnect_notices_do_not_fail_a_finished_answer() {
    let cli = fake_codex("reconnect", RECONNECTED);
    let answer = run(&cli, &request(text_request())).await.unwrap();
    assert_eq!(answer["choices"][0]["message"]["content"], "Antwort");
}

#[tokio::test]
async fn any_tool_item_makes_the_request_fail_even_with_an_answer() {
    for kind in [
        "command_execution",
        "file_change",
        "mcp_tool_call",
        "web_search",
    ] {
        let cli = fake_codex(&format!("tool-{kind}"), &tool(kind));
        assert_eq!(
            run(&cli, &request(text_request())).await.unwrap_err(),
            ErrorClass::CliFailed,
            "{kind}"
        );
    }
}

#[tokio::test]
async fn codex_failures_map_to_their_classes() {
    for (name, body, expected) in [
        (
            "quota",
            failed("You’ve hit your usage limit. Try again later."),
            ErrorClass::QuotaExhausted,
        ),
        (
            "plan",
            failed("To use Codex with your ChatGPT plan, upgrade to Plus"),
            ErrorClass::QuotaExhausted,
        ),
        (
            "login",
            failed("Not logged in. Please run codex login"),
            ErrorClass::NotLoggedIn,
        ),
        (
            "unauthorized",
            failed("unexpected status 401 Unauthorized"),
            ErrorClass::NotLoggedIn,
        ),
        (
            "rate",
            failed("We’re currently experiencing high demand"),
            ErrorClass::RateLimited,
        ),
        (
            "model",
            failed("The 'gpt-x' model is not supported when using Codex with a ChatGPT account"),
            ErrorClass::NotFound,
        ),
        (
            "large",
            failed("Codex ran out of room in the model’s context window"),
            ErrorClass::TooLarge,
        ),
        (
            "network",
            failed("stream disconnected before completion"),
            ErrorClass::Network,
        ),
        (
            "unknown",
            failed("etwas ganz anderes"),
            ErrorClass::CliFailed,
        ),
        (
            "outdated",
            "echo \"error: unexpected argument '--ignore-rules' found\" >&2\nexit 2\n".to_owned(),
            ErrorClass::CliOutdated,
        ),
        ("silent", "exit 0\n".to_owned(), ErrorClass::InvalidResponse),
        (
            "crash",
            "echo kaputt >&2\nexit 3\n".to_owned(),
            ErrorClass::CliFailed,
        ),
    ] {
        let cli = fake_codex(&format!("fail-{name}"), &body);
        assert_eq!(
            run(&cli, &request(text_request())).await.unwrap_err(),
            expected,
            "{name}"
        );
    }
}
