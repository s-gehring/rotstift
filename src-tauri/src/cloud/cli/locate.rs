use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tokio::sync::OnceCell;

use super::{Adapter, CliInfo, Runtime, executable, inspect};

static LOGIN_PATH: OnceCell<Option<OsString>> = OnceCell::const_new();

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(unix)]
async fn read_login_path() -> Option<OsString> {
    use super::runner::{self, Limits, Run};
    const MARKER: &str = "__ROTSTIFT_PATH__";
    const SHELL_LIMITS: Limits = Limits {
        timeout: std::time::Duration::from_secs(5),
        max_stdout: 64 * 1024,
        max_stderr: 16 * 1024,
    };
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|shell| shell.is_absolute() && executable(shell))
        .unwrap_or_else(|| {
            PathBuf::from(if cfg!(target_os = "macos") {
                "/bin/zsh"
            } else {
                "/bin/sh"
            })
        });
    let env: Vec<(OsString, OsString)> = ["HOME", "USER", "LOGNAME", "LANG", "TMPDIR"]
        .iter()
        .filter_map(|name| std::env::var_os(name).map(|value| (OsString::from(name), value)))
        .collect();
    let script = format!("printf '%s%s' '{MARKER}' \"$PATH\"");
    let output = runner::run(Run {
        program: &shell,
        args: &["-l".into(), "-i".into(), "-c".into(), script.into()],
        env: &env,
        stdin: &[],
        limits: SHELL_LIMITS,
    })
    .await
    .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout.rsplit_once(MARKER)?.1.trim();
    (!path.is_empty()).then(|| OsString::from(path))
}

#[cfg(not(unix))]
async fn read_login_path() -> Option<OsString> {
    std::env::var_os("PATH")
}

pub async fn login_path() -> Option<OsString> {
    LOGIN_PATH.get_or_init(read_login_path).await.clone()
}

fn common_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        for tail in [".local/bin", ".npm-global/bin", ".bun/bin", ".volta/bin"] {
            dirs.push(home.join(tail));
        }
    }
    #[cfg(unix)]
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    dirs
}

pub fn candidates(
    adapter: &dyn Adapter,
    search_path: Option<&OsString>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = search_path
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    if let Some(home) = home {
        dirs.extend(adapter.search_dirs(home));
    }
    dirs.extend(common_dirs(home));
    let mut found: Vec<PathBuf> = Vec::new();
    for dir in dirs.into_iter().filter(|dir| dir.is_absolute()) {
        for name in adapter.binary_names() {
            let path = dir.join(name);
            if !found.contains(&path) && executable(&path) {
                found.push(path);
            }
        }
    }
    found
}

pub async fn find(runtime: &Runtime, adapter: &dyn Adapter) -> Option<CliInfo> {
    let search_path = if runtime.login_path {
        login_path().await
    } else {
        (runtime.parent)("PATH")
    };
    let home = (runtime.parent)("HOME").map(PathBuf::from).or_else(home);
    for path in candidates(adapter, search_path.as_ref(), home.as_deref()) {
        if let Ok(info) = inspect(runtime, adapter, &path).await {
            return Some(info);
        }
    }
    None
}
