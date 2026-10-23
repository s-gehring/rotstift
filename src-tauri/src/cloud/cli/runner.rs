use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};

const EXIT_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub timeout: Duration,
    pub max_stdout: usize,
    pub max_stderr: usize,
}

#[derive(Debug)]
pub struct RunOutput {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunError {
    Spawn,
    Timeout,
    TooLarge,
    Io,
}

pub struct Run<'a> {
    pub program: &'a Path,
    pub args: &'a [OsString],
    pub env: &'a [(OsString, OsString)],
    pub stdin: &'a [u8],
    pub files: &'a [(String, Vec<u8>)],
    pub limits: Limits,
}

struct WorkDir(PathBuf);

impl WorkDir {
    fn create() -> io::Result<Self> {
        let mut bytes = [0u8; 12];
        getrandom::fill(&mut bytes).map_err(|_| io::Error::other("no randomness"))?;
        let name: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("rotstift-cli-{name}"));
        #[cfg_attr(not(unix), allow(unused_mut))]
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path)?;
        Ok(Self(path))
    }
}

impl WorkDir {
    fn put(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(self.0.join(name))?.write_all(bytes)
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Running {
    child: Child,
    tree: tree::Tree,
    reaped: bool,
}

impl Running {
    fn kill_tree(&mut self) {
        if !self.reaped {
            self.tree.kill();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.kill_tree();
    }
}

async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    cap: usize,
    fail_on_overflow: bool,
) -> Result<Vec<u8>, RunError> {
    let mut kept = Vec::new();
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = reader.read(&mut buffer).await.map_err(|_| RunError::Io)?;
        if read == 0 {
            return Ok(kept);
        }
        let room = cap.saturating_sub(kept.len());
        if read > room && fail_on_overflow {
            return Err(RunError::TooLarge);
        }
        kept.extend_from_slice(&buffer[..read.min(room)]);
    }
}

pub async fn run(run: Run<'_>) -> Result<RunOutput, RunError> {
    let work = WorkDir::create().map_err(|_| RunError::Io)?;
    for (name, bytes) in run.files {
        work.put(name, bytes).map_err(|_| RunError::Io)?;
    }
    let mut command = Command::new(run.program);
    command
        .args(run.args)
        .env_clear()
        .envs(run.env.iter().map(|(key, value)| (key, value)))
        .current_dir(&work.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    tree::prepare(&mut command);
    let child = command.spawn().map_err(|_| RunError::Spawn)?;
    let tree = tree::Tree::adopt(&child).map_err(|_| RunError::Spawn)?;
    let mut running = Running {
        child,
        tree,
        reaped: false,
    };
    let (Some(mut stdin), Some(stdout), Some(stderr)) = (
        running.child.stdin.take(),
        running.child.stdout.take(),
        running.child.stderr.take(),
    ) else {
        return Err(RunError::Io);
    };
    let input = run.stdin;
    let limits = run.limits;
    let finished = tokio::time::timeout(limits.timeout, async {
        let write = async {
            let _ = stdin.write_all(input).await;
            drop(stdin);
            Ok::<(), RunError>(())
        };
        let ((), out, err) = tokio::try_join!(
            write,
            read_capped(stdout, limits.max_stdout, true),
            read_capped(stderr, limits.max_stderr, false),
        )?;
        let status = match tokio::time::timeout(EXIT_GRACE, running.child.wait()).await {
            Ok(status) => status,
            Err(_) => {
                running.kill_tree();
                running.child.wait().await
            }
        }
        .map_err(|_| RunError::Io)?;
        running.reaped = true;
        Ok(RunOutput {
            code: status.code(),
            stdout: out,
            stderr: err,
        })
    })
    .await;
    let output = finished.map_err(|_| RunError::Timeout)?;
    drop(running);
    drop(work);
    output
}

#[cfg(unix)]
mod tree {
    use std::io;

    use tokio::process::{Child, Command};

    pub struct Tree(Option<libc::pid_t>);

    pub fn prepare(command: &mut Command) {
        command.process_group(0);
    }

    impl Tree {
        pub fn adopt(child: &Child) -> io::Result<Self> {
            let pid = child
                .id()
                .ok_or_else(|| io::Error::other("child has no pid"))?;
            Ok(Self(Some(pid as libc::pid_t)))
        }

        pub fn kill(&mut self) {
            if let Some(group) = self.0.take() {
                unsafe {
                    libc::killpg(group, libc::SIGKILL);
                }
            }
        }
    }
}

#[cfg(windows)]
mod tree {
    use std::io;

    use tokio::process::{Child, Command};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };

    pub struct Tree(HANDLE);

    unsafe impl Send for Tree {}
    unsafe impl Sync for Tree {}

    pub fn prepare(command: &mut Command) {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    impl Tree {
        pub fn adopt(child: &Child) -> io::Result<Self> {
            let process = child
                .raw_handle()
                .ok_or_else(|| io::Error::other("child has no handle"))?;
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let tree = Self(job);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if configured == 0 || AssignProcessToJobObject(job, process as HANDLE) == 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(tree)
            }
        }

        pub fn kill(&mut self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
