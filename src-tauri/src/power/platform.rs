use super::Backend;

pub struct System;

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_char, c_void};

    use super::{Backend, System};

    type CfStringRef = *const c_void;

    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const IOPM_ASSERTION_LEVEL_ON: u32 = 255;
    const IO_RETURN_SUCCESS: i32 = 0;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> CfStringRef;
        fn CFRelease(object: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: CfStringRef,
            level: u32,
            name: CfStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    pub struct Assertion(u32);

    impl Drop for Assertion {
        fn drop(&mut self) {
            unsafe { IOPMAssertionRelease(self.0) };
        }
    }

    fn cf_string(text: &'static std::ffi::CStr) -> CfStringRef {
        unsafe {
            CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), CF_STRING_ENCODING_UTF8)
        }
    }

    impl Backend for System {
        type Lock = Assertion;

        fn acquire(&self) -> Result<Assertion, String> {
            let kind = cf_string(c"PreventUserIdleSystemSleep");
            let name = cf_string(c"Rotstift korrigiert");
            let mut id = 0_u32;
            let status = if kind.is_null() || name.is_null() {
                -1
            } else {
                unsafe { IOPMAssertionCreateWithName(kind, IOPM_ASSERTION_LEVEL_ON, name, &mut id) }
            };
            for string in [kind, name] {
                if !string.is_null() {
                    unsafe { CFRelease(string) };
                }
            }
            if status == IO_RETURN_SUCCESS {
                Ok(Assertion(id))
            } else {
                Err(format!("IOPMAssertionCreateWithName returned {status}"))
            }
        }
    }
}

#[cfg(any(windows, target_os = "linux"))]
mod holder {
    use std::sync::mpsc::{self, Sender};
    use std::thread::{self, JoinHandle};

    pub struct Holder {
        stop: Option<Sender<()>>,
        thread: Option<JoinHandle<()>>,
    }

    impl Holder {
        pub fn spawn<R>(
            acquire: impl FnOnce() -> Result<R, String> + Send + 'static,
            release: impl FnOnce(R) + Send + 'static,
        ) -> Result<Self, String>
        where
            R: 'static,
        {
            let (stop, wait) = mpsc::channel::<()>();
            let (ready, started) = mpsc::channel::<Result<(), String>>();
            let thread = thread::Builder::new()
                .name("power-hold".into())
                .spawn(move || match acquire() {
                    Ok(resource) => {
                        let _ = ready.send(Ok(()));
                        let _ = wait.recv();
                        release(resource);
                    }
                    Err(reason) => {
                        let _ = ready.send(Err(reason));
                    }
                })
                .map_err(|error| error.to_string())?;
            match started.recv() {
                Ok(Ok(())) => Ok(Self {
                    stop: Some(stop),
                    thread: Some(thread),
                }),
                Ok(Err(reason)) => {
                    let _ = thread.join();
                    Err(reason)
                }
                Err(_) => Err("power-hold thread stopped".to_owned()),
            }
        }
    }

    impl Drop for Holder {
        fn drop(&mut self) {
            drop(self.stop.take());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::System::Power::{
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
    };

    use super::holder::Holder;
    use super::{Backend, System};

    impl Backend for System {
        type Lock = Holder;

        fn acquire(&self) -> Result<Holder, String> {
            Holder::spawn(
                || {
                    let previous =
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                    if previous == 0 {
                        Err("SetThreadExecutionState failed".to_owned())
                    } else {
                        Ok(())
                    }
                },
                |()| {
                    unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                },
            )
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::io;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command, Stdio};

    use super::holder::Holder;
    use super::{Backend, System};

    fn spawn_inhibitor() -> io::Result<Child> {
        let parent = unsafe { libc::getpid() };
        let mut command = Command::new("systemd-inhibit");
        command
            .args([
                "--what=sleep:idle",
                "--who=Rotstift",
                "--why=Korrektur läuft",
                "--mode=block",
                "sleep",
                "infinity",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
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

    impl Backend for System {
        type Lock = Holder;

        fn acquire(&self) -> Result<Holder, String> {
            Holder::spawn(
                || {
                    let mut child = spawn_inhibitor().map_err(|error| error.to_string())?;
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    match child.try_wait() {
                        Ok(None) => Ok(child),
                        Ok(Some(status)) => Err(format!("systemd-inhibit exited with {status}")),
                        Err(error) => Err(error.to_string()),
                    }
                },
                |mut child| {
                    let _ = child.kill();
                    let _ = child.wait();
                },
            )
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod imp {
    use super::{Backend, System};

    impl Backend for System {
        type Lock = ();

        fn acquire(&self) -> Result<(), String> {
            Err("unsupported platform".to_owned())
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    fn assertions() -> String {
        let output = std::process::Command::new("pmset")
            .args(["-g", "assertions"])
            .output()
            .expect("pmset must run");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    #[test]
    fn the_assertion_is_listed_by_pmset_while_held_and_gone_after_release() {
        let lock = System.acquire().expect("assertion must be created");
        let held = assertions();
        assert!(held.contains("Rotstift korrigiert"), "{held}");
        assert!(held.contains("PreventUserIdleSystemSleep"), "{held}");
        drop(lock);
        let released = assertions();
        assert!(!released.contains("Rotstift korrigiert"), "{released}");
    }
}
