#![cfg(unix)]

use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::claude::{self, Claude, SYSTEM_PROMPT};
use super::locate::candidates;
use super::runner::{self, Limits, Run, RunError};
use super::*;
use crate::cloud::keys::fake::MemoryStore;
use crate::cloud::send::{Policy, Sender};
use crate::cloud::{CloudError, CloudState, Keys, Step};

const PREAMBLE: &str = r#"#!/bin/sh
dir=$(dirname "$0")
if [ "$1" = "--version" ]; then echo "2.1.299 (Claude Code)"; exit 0; fi
if [ -e "$dir/busy" ]; then echo overlap >> "$dir/overlap.txt"; fi
touch "$dir/busy"
echo run >> "$dir/runs.txt"
printf '%s\n' "$@" > "$dir/args.txt"
env > "$dir/env.txt"
pwd > "$dir/cwd.txt"
cat > "$dir/stdin.txt"
rm -f "$dir/busy"
"#;

const OK: &str = r#"echo '{"type":"system","subtype":"init"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"Antwort","stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":2}}'
"#;

const OK_SCHEMA: &str = r#"echo '{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"ok":true},"usage":{}}'
"#;

const SLOW_OK: &str = r#"sleep 0.3
echo '{"type":"result","subtype":"success","is_error":false,"result":"Antwort","usage":{}}'
"#;

const LOGGED_OUT: &str = r#"echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":null,"result":"Not logged in · Please run /login"}'
exit 1
"#;

const QUOTA: &str = r#"echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"You have hit your limit · resets 5pm"}'
exit 1
"#;

const RATE_LIMITED: &str = r#"echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"API Error: 429 rate_limit_error"}'
exit 1
"#;

const UNKNOWN_MODEL: &str = r#"echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":404,"result":"There is an issue with the selected model"}'
exit 1
"#;

const BROKEN: &str = r#"echo '{"type":"result", kaputt'
"#;

const OUTDATED: &str = r#"echo "error: unknown option '--safe-mode'" >&2
exit 1
"#;

const HANG: &str = r#"sleep 60 &
echo $! > "$dir/grandchild.txt"
sleep 60
"#;

const HUGE: &str = r#"head -c 5000000 /dev/zero | tr '\0' 'x'
"#;

fn world() -> &'static Path {
    static WORLD: OnceLock<PathBuf> = OnceLock::new();
    WORLD.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("rotstift-cli-world-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("home")).unwrap();
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        dir
    })
}

fn fake_parent(name: &str) -> Option<OsString> {
    match name {
        "HOME" => Some(world().join("home").into()),
        "PATH" => Some(format!("{}:/usr/bin:/bin", world().join("bin").display()).into()),
        "LANG" => Some("de_DE.UTF-8".into()),
        "HTTPS_PROXY" => Some("http://proxy.schule.example:3128".into()),
        "ANTHROPIC_API_KEY" => Some("sk-ant-secret".into()),
        "ANTHROPIC_BASE_URL" => Some("https://elsewhere.example".into()),
        "CLAUDECODE" => Some("1".into()),
        "CLAUDE_CODE_ENTRYPOINT" => Some("claude-desktop".into()),
        _ => None,
    }
}

fn runtime(timeout: Duration) -> Runtime {
    Runtime {
        limits: Limits {
            timeout,
            ..CHAT_LIMITS
        },
        parent: fake_parent,
        login_path: false,
    }
}

fn fake_cli(name: &str, body: &str) -> PathBuf {
    let dir = world().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("claude");
    std::fs::write(&path, format!("{PREAMBLE}{body}")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn beside(cli: &Path, file: &str) -> String {
    std::fs::read_to_string(cli.with_file_name(file)).unwrap_or_default()
}

async fn gone(pid: i32) -> bool {
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    false
}

fn state(name: &str, cli: Runtime) -> CloudState {
    let dir = world().join(format!("state-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    let mut state = CloudState::with_sender(
        dir,
        Keys::with_store(Arc::new(MemoryStore::default())),
        Sender::new(Policy::default()),
    );
    state.cli = cli;
    state
}

async fn choose(
    cloud: &CloudState,
    step: Step,
    cli: &Path,
    protection: Option<bool>,
    protection_confirmed: bool,
) -> Result<crate::cloud::commands::CloudView, CloudError> {
    cloud
        .use_choice(
            step,
            crate::cloud::commands::Selection {
                template: "claude-code",
                base_url: "cli://claude",
                model: "sonnet",
                key: None,
                cli_path: cli.to_str(),
            },
            true,
            protection,
            protection_confirmed,
        )
        .await
}

fn text_request() -> Value {
    json!({
        "messages": [
            { "role": "system", "content": "Korrigiere den Text." },
            { "role": "user", "content": "Ein selbst geschriebener Satz mit [Person 1]." },
        ],
        "temperature": 0,
        "max_tokens": 200,
    })
}

fn image_request() -> Value {
    json!({
        "messages": [{ "role": "user", "content": [
            { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,QUJD" } },
            { "type": "text", "text": "Lies die Seite." },
        ] }],
        "max_tokens": 200,
    })
}

fn class(result: Result<Value, CloudError>) -> ErrorClass {
    result.unwrap_err().class()
}

#[test]
fn the_claude_arguments_shield_the_cli_and_carry_no_student_data() {
    let mut prompt = Prompt::from_body(&text_request(), "sonnet").unwrap();
    let args: Vec<String> = claude::arguments(&prompt)
        .into_iter()
        .map(|arg| arg.into_string().unwrap())
        .collect();
    assert_eq!(
        args,
        [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--model",
            "sonnet",
            "--system-prompt",
            SYSTEM_PROMPT,
            "--tools",
            "",
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--safe-mode",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--max-turns",
            "1",
        ]
    );
    assert!(!args.iter().any(|arg| arg.contains("Person")));

    prompt.schema = Some(json!({ "type": "object" }));
    let args = claude::arguments(&prompt);
    assert_eq!(args[args.len() - 3], "2");
    assert_eq!(args[args.len() - 2], "--json-schema");
    assert_eq!(args[args.len() - 1], r#"{"type":"object"}"#);
}

#[test]
fn the_message_puts_images_first_and_flattens_the_conversation() {
    let prompt = Prompt::from_body(&image_request(), "sonnet").unwrap();
    assert_eq!(
        claude::message(&prompt),
        json!({
            "type": "user",
            "message": { "role": "user", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "QUJD" } },
                { "type": "text", "text": "Lies die Seite." },
            ] },
            "parent_tool_use_id": null,
        })
    );

    let repair = json!({ "messages": [
        { "role": "system", "content": "Sei streng." },
        { "role": "user", "content": "1: Text" },
        { "role": "assistant", "content": "1: Txt" },
        { "role": "user", "content": "Zeile 1 fehlt." },
    ] });
    assert_eq!(
        Prompt::from_body(&repair, "sonnet").unwrap().text(),
        "<anweisungen>\nSei streng.\n</anweisungen>\n\n1: Text\n\n<bisherige_antwort>\n1: Txt\n</bisherige_antwort>\n\nZeile 1 fehlt."
    );
    let ends_with_answer = json!({ "messages": [{ "role": "assistant", "content": "x" }] });
    assert_eq!(
        Prompt::from_body(&ends_with_answer, "sonnet").unwrap_err(),
        ErrorClass::InvalidRequest
    );
}

#[test]
fn model_names_cannot_become_flags() {
    assert!(valid_model("sonnet"));
    assert!(valid_model("claude-sonnet-5-5[1m]"));
    assert!(!valid_model("--dangerously-skip-permissions"));
    assert!(!valid_model("sonnet opus"));
    assert!(!valid_model(""));
}

#[test]
fn the_environment_drops_keys_and_outer_sessions() {
    let env = environment(Path::new("/opt/cli/claude"), None, fake_parent);
    let get = |name: &str| {
        env.iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.to_string_lossy().into_owned())
    };
    assert!(get("HOME").is_some());
    assert_eq!(
        get("HTTPS_PROXY").unwrap(),
        "http://proxy.schule.example:3128"
    );
    assert!(get("PATH").unwrap().starts_with("/opt/cli:"));
    for dropped in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
    ] {
        assert!(get(dropped).is_none(), "{dropped}");
    }
}

#[test]
fn the_version_must_come_from_claude_code() {
    assert_eq!(
        Claude.version("2.1.299 (Claude Code)\n").as_deref(),
        Some("2.1.299")
    );
    assert!(Claude.version("2.1.299 (Something Else)").is_none());
    assert!(Claude.version("GNU bash, version 5.2").is_none());
}

#[tokio::test]
async fn the_runner_uses_a_fresh_folder_and_removes_it() {
    let cli = fake_cli("runner-ok", OK);
    let env = environment(&cli, None, fake_parent);
    let output = runner::run(Run {
        program: &cli,
        args: &["-p".into(), "".into()],
        env: &env,
        stdin: b"hallo",
        limits: CHAT_LIMITS,
    })
    .await
    .unwrap();
    assert_eq!(output.code, Some(0));
    assert_eq!(beside(&cli, "stdin.txt"), "hallo");
    assert_eq!(beside(&cli, "args.txt"), "-p\n\n");
    let cwd = PathBuf::from(beside(&cli, "cwd.txt").trim());
    assert!(
        cwd.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("rotstift-cli-")
    );
    assert!(!cwd.exists());
    let env = beside(&cli, "env.txt");
    assert!(!env.contains("sk-ant-secret"));
    assert!(!env.contains("CLAUDECODE"));
}

#[tokio::test]
async fn a_hanging_cli_is_killed_with_its_children() {
    let cli = fake_cli("runner-hang", HANG);
    let env = environment(&cli, None, fake_parent);
    let started = Instant::now();
    let result = runner::run(Run {
        program: &cli,
        args: &[],
        env: &env,
        stdin: b"",
        limits: Limits {
            timeout: Duration::from_secs(1),
            ..CHAT_LIMITS
        },
    })
    .await;
    assert_eq!(result.unwrap_err(), RunError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(5));
    let grandchild: i32 = beside(&cli, "grandchild.txt").trim().parse().unwrap();
    assert!(gone(grandchild).await);
}

#[tokio::test]
async fn oversized_output_is_refused() {
    let cli = fake_cli("runner-huge", HUGE);
    let env = environment(&cli, None, fake_parent);
    let result = runner::run(Run {
        program: &cli,
        args: &[],
        env: &env,
        stdin: b"",
        limits: CHAT_LIMITS,
    })
    .await;
    assert_eq!(result.unwrap_err(), RunError::TooLarge);
}

#[tokio::test]
async fn a_text_step_runs_through_the_cli_with_all_locks() {
    let cli = fake_cli("chat-text", OK);
    let cloud = state("chat-text", runtime(Duration::from_secs(10)));
    let view = choose(&cloud, Step::Corrector, &cli, None, false)
        .await
        .unwrap();
    let step = &view.steps[&Step::Corrector];
    assert_eq!(step.label, "Claude-Abo");
    assert!(step.protection);
    assert_eq!(step.cli.as_ref().unwrap().version, "2.1.299");
    std::fs::remove_file(cli.with_file_name("runs.txt")).ok();

    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), false)
                .await
        ),
        ErrorClass::NotPseudonymized
    );
    assert_eq!(beside(&cli, "runs.txt"), "");

    let answer = cloud
        .chat(None, Step::Corrector, text_request(), true)
        .await
        .unwrap();
    assert_eq!(answer["choices"][0]["message"]["content"], "Antwort");
    assert_eq!(answer["choices"][0]["finish_reason"], "stop");
    assert_eq!(answer["usage"]["total_tokens"], 5);
    let stdin: Value = serde_json::from_str(beside(&cli, "stdin.txt").trim()).unwrap();
    assert_eq!(
        stdin["message"]["content"][0]["text"],
        "<anweisungen>\nKorrigiere den Text.\n</anweisungen>\n\nEin selbst geschriebener Satz mit [Person 1]."
    );
    assert!(!beside(&cli, "args.txt").contains("Person"));
    let env = beside(&cli, "env.txt");
    assert!(env.contains("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"));
    assert!(!env.contains("ANTHROPIC_API_KEY"));
    assert!(!env.contains("CLAUDECODE"));

    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, image_request(), true)
                .await
        ),
        ErrorClass::InvalidRequest
    );
    assert_eq!(beside(&cli, "runs.txt"), "run\n");
}

#[tokio::test]
async fn the_recognition_needs_protection_off_and_then_sends_the_page() {
    let cli = fake_cli("chat-image", OK);
    let cloud = state("chat-image", runtime(Duration::from_secs(10)));
    assert_eq!(
        choose(&cloud, Step::Transcriber, &cli, None, false)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ProtectionActive
    );
    assert_eq!(
        choose(&cloud, Step::Transcriber, &cli, Some(false), false)
            .await
            .unwrap_err()
            .class(),
        ErrorClass::ProtectionConsentMissing
    );
    choose(&cloud, Step::Transcriber, &cli, Some(false), true)
        .await
        .unwrap();
    cloud
        .chat(None, Step::Transcriber, image_request(), false)
        .await
        .unwrap();
    let stdin: Value = serde_json::from_str(beside(&cli, "stdin.txt").trim()).unwrap();
    assert_eq!(stdin["message"]["content"][0]["type"], "image");

    cloud
        .set_protection(Step::Transcriber, true, false)
        .await
        .unwrap();
    std::fs::remove_file(cli.with_file_name("runs.txt")).unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Transcriber, image_request(), true)
                .await
        ),
        ErrorClass::ProtectionActive
    );
    assert_eq!(beside(&cli, "runs.txt"), "");
}

#[tokio::test]
async fn nothing_runs_without_consent_or_after_clearing() {
    let cli = fake_cli("chat-consent", OK);
    let cloud = state("chat-consent", runtime(Duration::from_secs(10)));
    let unconfirmed = cloud
        .use_choice(
            Step::Corrector,
            crate::cloud::commands::Selection {
                template: "claude-code",
                base_url: "cli://claude",
                model: "sonnet",
                key: None,
                cli_path: cli.to_str(),
            },
            false,
            None,
            false,
        )
        .await;
    assert_eq!(unconfirmed.unwrap_err().class(), ErrorClass::ConsentMissing);
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );
    choose(&cloud, Step::Corrector, &cli, None, false)
        .await
        .unwrap();
    cloud.clear(Step::Corrector).await.unwrap();
    assert_eq!(
        class(
            cloud
                .chat(None, Step::Corrector, text_request(), true)
                .await
        ),
        ErrorClass::NotConfigured
    );
    assert_eq!(beside(&cli, "runs.txt"), "");
}

#[tokio::test]
async fn only_known_models_paths_and_programs_are_accepted() {
    let cli = fake_cli("choice-checks", OK);
    let cloud = state("choice-checks", runtime(Duration::from_secs(10)));
    let attempt = |model: &'static str, path: Option<String>, key: Option<String>| {
        let cloud = &cloud;
        async move {
            cloud
                .use_choice(
                    Step::Corrector,
                    crate::cloud::commands::Selection {
                        template: "claude-code",
                        base_url: "cli://claude",
                        model,
                        key,
                        cli_path: path.as_deref(),
                    },
                    true,
                    None,
                    false,
                )
                .await
                .unwrap_err()
                .class()
        }
    };
    let path = || Some(cli.to_string_lossy().into_owned());
    assert_eq!(
        attempt("--tools=default", path(), None).await,
        ErrorClass::InvalidRequest
    );
    assert_eq!(
        attempt("gpt-5", path(), None).await,
        ErrorClass::InvalidRequest
    );
    assert_eq!(
        attempt("sonnet", path(), Some("sk".into())).await,
        ErrorClass::InvalidRequest
    );
    assert_eq!(attempt("sonnet", None, None).await, ErrorClass::CliMissing);
    assert_eq!(
        attempt("sonnet", Some("/bin/sh".into()), None).await,
        ErrorClass::CliMissing
    );
    let relative = Some("claude".to_owned());
    assert_eq!(
        attempt("sonnet", relative, None).await,
        ErrorClass::CliMissing
    );
    let impostor = world().join("impostor").join("claude");
    std::fs::create_dir_all(impostor.parent().unwrap()).unwrap();
    std::fs::write(&impostor, "#!/bin/sh\necho 1.0\n").unwrap();
    std::fs::set_permissions(&impostor, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        attempt(
            "sonnet",
            Some(impostor.to_string_lossy().into_owned()),
            None
        )
        .await,
        ErrorClass::CliMissing
    );
    let hidden = cloud
        .use_choice(
            Step::Corrector,
            crate::cloud::commands::Selection {
                template: "codex",
                base_url: "cli://codex",
                model: "gpt-5",
                key: None,
                cli_path: None,
            },
            true,
            None,
            false,
        )
        .await;
    assert_eq!(hidden.unwrap_err().class(), ErrorClass::NotConfigured);
}

#[tokio::test]
async fn cli_failures_map_to_their_classes() {
    for (name, body, expected) in [
        ("logged-out", LOGGED_OUT, ErrorClass::NotLoggedIn),
        ("quota", QUOTA, ErrorClass::QuotaExhausted),
        ("rate", RATE_LIMITED, ErrorClass::RateLimited),
        ("model", UNKNOWN_MODEL, ErrorClass::NotFound),
        ("broken", BROKEN, ErrorClass::InvalidResponse),
        ("outdated", OUTDATED, ErrorClass::CliOutdated),
        ("hang", HANG, ErrorClass::Timeout),
    ] {
        let cli = fake_cli(&format!("fail-{name}"), body);
        let cloud = state(&format!("fail-{name}"), runtime(Duration::from_millis(800)));
        choose(&cloud, Step::Corrector, &cli, None, false)
            .await
            .unwrap();
        assert_eq!(
            class(
                cloud
                    .chat(None, Step::Corrector, text_request(), true)
                    .await
            ),
            expected,
            "{name}"
        );
        assert_eq!(
            cloud.check(Step::Corrector).await.unwrap_err().class(),
            expected,
            "{name}"
        );
    }
}

#[tokio::test]
async fn the_check_reads_a_structured_answer() {
    let cli = fake_cli("check-schema", OK_SCHEMA);
    let cloud = state("check-schema", runtime(Duration::from_secs(10)));
    choose(&cloud, Step::Reviewer, &cli, None, false)
        .await
        .unwrap();
    cloud.check(Step::Reviewer).await.unwrap();
    let args = beside(&cli, "args.txt");
    assert!(args.contains("--json-schema\n"));
}

#[tokio::test]
async fn requests_run_one_after_another_and_can_be_cancelled() {
    let cli = fake_cli("serial", SLOW_OK);
    let cloud = Arc::new(state("serial", runtime(Duration::from_secs(10))));
    choose(&cloud, Step::Corrector, &cli, None, false)
        .await
        .unwrap();
    choose(&cloud, Step::Reviewer, &cli, None, false)
        .await
        .unwrap();
    let (first, second) = tokio::join!(
        cloud.chat(None, Step::Corrector, text_request(), true),
        cloud.chat(None, Step::Reviewer, text_request(), true),
    );
    first.unwrap();
    second.unwrap();
    assert_eq!(beside(&cli, "runs.txt"), "run\nrun\n");
    assert_eq!(beside(&cli, "overlap.txt"), "");

    let hang = fake_cli("cancel", HANG);
    choose(&cloud, Step::Corrector, &hang, None, false)
        .await
        .unwrap();
    let running = {
        let cloud = cloud.clone();
        tokio::spawn(async move {
            cloud
                .chat(Some("r1".into()), Step::Corrector, text_request(), true)
                .await
        })
    };
    let grandchild = loop {
        if let Ok(pid) = beside(&hang, "grandchild.txt").trim().parse::<i32>() {
            break pid;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(cloud.cancel("r1"));
    assert_eq!(class(running.await.unwrap()), ErrorClass::Cancelled);
    assert!(gone(grandchild).await);
}

#[tokio::test]
async fn the_cli_is_found_on_the_path_and_in_its_own_folder() {
    let bin = world().join("bin");
    let script = "#!/bin/sh\necho '2.1.299 (Claude Code)'\n";
    let not_executable = bin.join("claude");
    std::fs::write(&not_executable, script).unwrap();
    std::fs::set_permissions(&not_executable, std::fs::Permissions::from_mode(0o644)).unwrap();
    let own = world().join("home").join(".claude").join("local");
    std::fs::create_dir_all(&own).unwrap();
    std::fs::write(own.join("claude"), script).unwrap();
    std::fs::set_permissions(own.join("claude"), std::fs::Permissions::from_mode(0o755)).unwrap();

    let found = locate::find(&runtime(Duration::from_secs(10)), &Claude)
        .await
        .unwrap();
    assert_eq!(
        found.path,
        own.canonicalize().unwrap().join("claude").to_string_lossy()
    );
    assert_eq!(found.version, "2.1.299");

    std::fs::set_permissions(&not_executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let found = locate::find(&runtime(Duration::from_secs(10)), &Claude)
        .await
        .unwrap();
    assert_eq!(
        found.path,
        bin.canonicalize().unwrap().join("claude").to_string_lossy()
    );
    std::fs::remove_file(&not_executable).unwrap();

    let session = world().join("session-link");
    let _ = std::fs::remove_file(&session);
    std::os::unix::fs::symlink(&own, &session).unwrap();
    let found = inspect(
        &runtime(Duration::from_secs(10)),
        &Claude,
        &session.join("claude"),
    )
    .await
    .unwrap();
    assert_eq!(
        found.path,
        own.canonicalize().unwrap().join("claude").to_string_lossy()
    );
}

fn versioned_cli(dir: &Path, version: &str) {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join("claude");
    std::fs::write(
        &path,
        format!("#!/bin/sh\necho '{version} (Claude Code)'\n"),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[tokio::test]
async fn node_managers_are_searched_and_the_newest_stable_path_wins() {
    let home = world().join("managers");
    let _ = std::fs::remove_dir_all(&home);
    let fnm = home.join(".local/share/fnm/node-versions");
    versioned_cli(&fnm.join("v20.1.0/installation/bin"), "2.1.200");
    versioned_cli(&fnm.join("v22.23.1/installation/bin"), "2.1.309");
    versioned_cli(&home.join(".nvm/versions/node/v18.0.0/bin"), "2.0.1");
    versioned_cli(&home.join(".local/bin"), "2.1.250");
    let shells = home.join(".local/state/fnm_multishells/123_456");
    std::fs::create_dir_all(shells.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(fnm.join("v20.1.0/installation"), &shells).unwrap();
    let search_path = OsString::from(shells.join("bin"));

    let found = candidates(&Claude, Some(&search_path), Some(&home));
    assert_eq!(found.first(), Some(&shells.join("bin").join("claude")));
    assert_eq!(found.len(), 5);

    let runtime = runtime(Duration::from_secs(10));
    let newest = locate::newest(&runtime, &Claude, found).await.unwrap();
    assert_eq!(newest.version, "2.1.309");
    assert_eq!(
        newest.path,
        fnm.canonicalize()
            .unwrap()
            .join("v22.23.1/installation/bin/claude")
            .to_string_lossy()
    );

    let only_shell = locate::newest(&runtime, &Claude, vec![shells.join("bin").join("claude")])
        .await
        .unwrap();
    assert!(!only_shell.path.contains("fnm_multishells"));
    assert!(only_shell.path.ends_with("v20.1.0/installation/bin/claude"));
}
