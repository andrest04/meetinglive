//! Top-level window listing for meeting call detection. Returns only the owning process
//! name (no extension) and the window title; never window contents.

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct TopLevelWindow {
    /// Process image name without the `.exe` extension.
    pub process_name: String,
    pub title: String,
}

/// Image name without directory and without a trailing `.exe` (any case).
pub(crate) fn process_name_from_path(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let lower = file.to_ascii_lowercase();
    if lower.ends_with(".exe") {
        file[..file.len() - 4].to_string()
    } else {
        file.to_string()
    }
}

/// Whether a window is worth reporting: visible (a minimized window is still visible),
/// owned by a real process and carrying a title.
pub(crate) fn keep_window(visible: bool, pid: u32, title: &str) -> bool {
    visible && pid != 0 && !title.is_empty()
}

#[cfg(windows)]
mod imp {
    use super::{keep_window, process_name_from_path, TopLevelWindow};
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    const IMAGE_NAME_CHARS: usize = 32_768;

    fn image_path(pid: u32) -> Option<String> {
        // SAFETY: the handle is closed before returning; the buffer outlives the call.
        unsafe {
            // A process that exited between the enumeration and now fails here: skipped.
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; IMAGE_NAME_CHARS];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            ok.then(|| String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]))
        }
    }

    unsafe extern "system" fn on_window(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        // SAFETY: lparam is the address of the Vec owned by `list`, alive for the whole call.
        let out = unsafe { &mut *(lparam.0 as *mut Vec<TopLevelWindow>) };
        let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
        if visible {
            let len = unsafe { GetWindowTextLengthW(hwnd) };
            if len > 0 {
                let mut buf = vec![0u16; len as usize + 1];
                let got = unsafe { GetWindowTextW(hwnd, &mut buf) };
                let title = String::from_utf16_lossy(&buf[..got.max(0) as usize]);
                let mut pid = 0u32;
                unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
                if keep_window(visible, pid, &title) {
                    if let Some(path) = image_path(pid) {
                        out.push(TopLevelWindow {
                            process_name: process_name_from_path(&path),
                            title,
                        });
                    }
                }
            }
        }
        true.into()
    }

    pub fn list() -> Vec<TopLevelWindow> {
        let mut out: Vec<TopLevelWindow> = Vec::new();
        // SAFETY: the callback only runs during this call and sees `out` through lparam.
        let _ = unsafe { EnumWindows(Some(on_window), LPARAM(&mut out as *mut _ as isize)) };
        out
    }
}

#[cfg(not(windows))]
mod imp {
    use super::TopLevelWindow;

    pub fn list() -> Vec<TopLevelWindow> {
        Vec::new()
    }
}

pub struct ListWindowsTask;

impl Task for ListWindowsTask {
    type Output = Vec<TopLevelWindow>;
    type JsValue = Vec<TopLevelWindow>;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(imp::list())
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Lists visible top-level windows with a title. Runs on the libuv pool, off the JS loop (S8).
#[napi]
pub fn list_top_level_windows() -> AsyncTask<ListWindowsTask> {
    AsyncTask::new(ListWindowsTask)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_directory_and_exe_extension() {
        assert_eq!(
            process_name_from_path(r"C:\Program Files\Zoom\bin\Zoom.exe"),
            "Zoom"
        );
        assert_eq!(process_name_from_path("chrome.EXE"), "chrome");
        assert_eq!(process_name_from_path("C:/x/ms-teams.exe"), "ms-teams");
    }

    #[test]
    fn keeps_names_without_exe_untouched() {
        assert_eq!(process_name_from_path(r"C:\x\tool.bin"), "tool.bin");
        assert_eq!(process_name_from_path("exe"), "exe");
    }

    #[test]
    fn skips_invisible_untitled_and_pid_zero() {
        assert!(keep_window(true, 4, "Title"));
        assert!(!keep_window(false, 4, "Title"));
        assert!(!keep_window(true, 4, ""));
        assert!(!keep_window(true, 0, "Title"));
    }
}
