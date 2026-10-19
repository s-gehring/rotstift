use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

const KILL_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(target_os = "macos")]
const LIBRARY_PATH_VAR: &str = "DYLD_LIBRARY_PATH";
#[cfg(target_os = "windows")]
const LIBRARY_PATH_VAR: &str = "PATH";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const LIBRARY_PATH_VAR: &str = "LD_LIBRARY_PATH";

pub fn sidecar_command(
    sidecar: &Path,
    library_dir: &Path,
    args: impl IntoIterator<Item = OsString>,
) -> Command {
    let mut command = Command::new(sidecar);
    command
        .args(args)
        .env(
            LIBRARY_PATH_VAR,
            library_search_path(library_dir, std::env::var_os(LIBRARY_PATH_VAR)),
        )
        .current_dir(library_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn library_search_path(library_dir: &Path, existing: Option<OsString>) -> OsString {
    let mut paths = vec![library_dir.to_path_buf()];
    if let Some(existing) = existing {
        paths.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(paths).unwrap_or_else(|_| library_dir.as_os_str().to_owned())
}

pub fn spawn(command: Command) -> io::Result<Child> {
    #[cfg(target_os = "linux")]
    let child = linux::spawn(command)?;
    #[cfg(not(target_os = "linux"))]
    let child = {
        let mut command = command;
        command.spawn()?
    };
    #[cfg(windows)]
    let child = {
        let mut child = child;
        if let Err(error) = windows::kill_on_app_exit(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        child
    };
    Ok(child)
}

#[cfg(target_os = "linux")]
mod linux {
    use std::io;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command};
    use std::sync::OnceLock;
    use std::sync::mpsc::{self, Sender};

    type Request = (Command, Sender<io::Result<Child>>);

    // PR_SET_PDEATHSIG fires when the spawning thread exits, so all sidecars come from one thread that never ends.
    fn spawner() -> &'static Sender<Request> {
        static SPAWNER: OnceLock<Sender<Request>> = OnceLock::new();
        SPAWNER.get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<Request>();
            std::thread::Builder::new()
                .name("sidecar-spawner".into())
                .spawn(move || {
                    for (mut command, reply) in receiver {
                        let _ = reply.send(spawn_with_parent_death_signal(&mut command));
                    }
                })
                .expect("sidecar spawner thread must start");
            sender
        })
    }

    fn spawn_with_parent_death_signal(command: &mut Command) -> io::Result<Child> {
        let parent = unsafe { libc::getpid() };
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong) == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(io::Error::from_raw_os_error(libc::ESRCH));
                }
                Ok(())
            });
        }
        command.spawn()
    }

    pub fn spawn(command: Command) -> io::Result<Child> {
        let stopped = || io::Error::other("sidecar spawner thread stopped");
        let (reply, response) = mpsc::channel();
        spawner().send((command, reply)).map_err(|_| stopped())?;
        response.recv().map_err(|_| stopped())?
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    struct Job(HANDLE);

    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    fn create_job() -> Option<Job> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            (configured != 0).then_some(Job(job))
        }
    }

    pub fn kill_on_app_exit(child: &Child) -> io::Result<()> {
        static JOB: OnceLock<Option<Job>> = OnceLock::new();
        let job = JOB
            .get_or_init(create_job)
            .as_ref()
            .ok_or_else(|| io::Error::other("cannot create a job object for the sidecar"))?;
        if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRecord {
    pid: u32,
    started_at: u64,
    exe: PathBuf,
    owner_pid: u32,
    owner_started_at: u64,
}

#[derive(Debug)]
pub struct RecordGuard(PathBuf);

impl Drop for RecordGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn refreshed(pids: &[u32]) -> System {
    let pids: Vec<Pid> = pids.iter().copied().map(Pid::from_u32).collect();
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    system
}

pub fn record(dir: &Path, child: &Child, sidecar: &Path) -> io::Result<RecordGuard> {
    let owner_pid = std::process::id();
    let system = refreshed(&[child.id(), owner_pid]);
    let process = system
        .process(Pid::from_u32(child.id()))
        .ok_or_else(|| io::Error::other("sidecar process not found"))?;
    let owner = system
        .process(Pid::from_u32(owner_pid))
        .ok_or_else(|| io::Error::other("own process not found"))?;
    let record = SidecarRecord {
        pid: child.id(),
        started_at: process.start_time(),
        exe: process.exe().unwrap_or(sidecar).to_path_buf(),
        owner_pid,
        owner_started_at: owner.start_time(),
    };
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("sidecar-{}.json", record.pid));
    std::fs::write(&path, serde_json::to_vec(&record)?)?;
    Ok(RecordGuard(path))
}

fn wait_until_gone(pid: u32, started_at: u64) {
    let deadline = Instant::now() + KILL_TIMEOUT;
    while Instant::now() < deadline
        && refreshed(&[pid])
            .process(Pid::from_u32(pid))
            .is_some_and(|p| p.start_time() == started_at && p.status() != ProcessStatus::Zombie)
    {
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn stop_orphans(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        let is_record = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("sidecar-") && name.ends_with(".json"));
        if !is_record {
            continue;
        }
        let record = std::fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<SidecarRecord>(&data).ok());
        if let Some(record) = record {
            let system = refreshed(&[record.pid, record.owner_pid]);
            let started_at = |pid: u32| system.process(Pid::from_u32(pid)).map(|p| p.start_time());
            if started_at(record.owner_pid) == Some(record.owner_started_at) {
                continue;
            }
            if let Some(process) = system.process(Pid::from_u32(record.pid))
                && process.start_time() == record.started_at
                && process.exe() == Some(record.exe.as_path())
            {
                process.kill();
                wait_until_gone(record.pid, record.started_at);
            }
        }
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn library_dir_comes_first_in_the_search_path() {
        let existing = std::env::join_paths(["/usr/lib", "/opt/lib"]).unwrap();
        let joined = library_search_path(Path::new("/app/llama"), Some(existing));
        let paths: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            paths,
            ["/app/llama", "/usr/lib", "/opt/lib"].map(PathBuf::from)
        );
    }

    #[cfg(unix)]
    fn sleeper() -> Child {
        spawn(sidecar_command(
            Path::new("/bin/sleep"),
            &std::env::temp_dir(),
            ["30".into()],
        ))
        .unwrap()
    }

    #[cfg(unix)]
    fn write_record(dir: &Path, child: &Child, owner_started_at: u64) -> PathBuf {
        let guard = record(dir, child, Path::new("/bin/sleep")).unwrap();
        let path = guard.0.clone();
        std::mem::forget(guard);
        let mut stored: SidecarRecord =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        stored.owner_started_at = owner_started_at;
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn stops_sidecars_whose_app_is_gone() {
        let dir = temp_dir("orphan");
        let mut child = sleeper();
        let path = write_record(&dir, &child, 0);
        stop_orphans(&dir);
        assert!(child.wait().is_ok_and(|status| !status.success()));
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_sidecars_of_a_running_app() {
        let dir = temp_dir("owned");
        let mut child = sleeper();
        let own_start = refreshed(&[std::process::id()])
            .process(Pid::from_u32(std::process::id()))
            .unwrap()
            .start_time();
        let path = write_record(&dir, &child, own_start);
        stop_orphans(&dir);
        assert!(matches!(child.try_wait(), Ok(None)));
        assert!(path.exists());
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn removes_its_record_when_dropped() {
        let dir = temp_dir("guard");
        let path = dir.join("sidecar-1.json");
        std::fs::write(&path, b"{}").unwrap();
        drop(RecordGuard(path.clone()));
        assert!(!path.exists());
    }
}
