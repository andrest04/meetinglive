//! Process queries for app grouping (spec 3.4.5) and the liveness check of process capture.

use napi_derive::napi;
use windows::core::{PCWSTR, PWSTR};
use windows::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_TIMEOUT};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
    PROCESS_BASIC_INFORMATION, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE,
};

#[napi(object)]
pub struct ProcessDetails {
    pub process_id: u32,
    pub parent_process_id: u32,
    pub exe_path: Option<String>,
    pub process_name: String,
    /// Milliseconds since the Unix epoch, UTC.
    pub start_time_utc_ms: Option<f64>,
}

#[napi(object)]
pub struct VersionDetails {
    pub file_description: Option<String>,
    pub product_name: Option<String>,
}

/// ERROR_INVALID_PARAMETER as an HRESULT: what OpenProcess returns for a pid that is gone.
const NO_SUCH_PID: i32 = 0x8007_0057_u32 as i32;

/// Characters of room for an executable path: the longest a Windows path can be (S7).
const IMAGE_NAME_CHARS: usize = 32_768;

/// The path the call wrote: `len` characters of `buf`, never past its end.
fn image_name(buf: &[u16], len: u32) -> String {
    String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())])
}

/// True while the process exists and has not exited. An unreadable process counts as alive.
pub fn is_alive(pid: u32) -> bool {
    unsafe {
        match OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            Ok(handle) => {
                let alive = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
                let _ = CloseHandle(handle);
                alive
            }
            Err(e) => alive_when_unopenable(e.code().0),
        }
    }
}

/// A process that cannot be opened is gone only when Windows says the pid does not exist;
/// a protected process that refuses access still counts as alive.
fn alive_when_unopenable(code: i32) -> bool {
    code != NO_SUCH_PID
}

fn filetime_to_unix_ms(ft: FILETIME) -> Option<f64> {
    let ticks = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    if ticks == 0 {
        return None;
    }
    // 100 ns ticks since 1601 to ms since 1970.
    Some(ticks as f64 / 10_000.0 - 11_644_473_600_000.0)
}

fn name_from_path(path: &str) -> Option<String> {
    let file = path.rsplit(['\\', '/']).next()?;
    let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
    (!stem.is_empty()).then(|| stem.to_string())
}

fn snapshot_name(pid: u32) -> Option<String> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = None;
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == pid {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let file = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    found = name_from_path(&file);
                    break;
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        found
    }
}

fn parent_of(handle: HANDLE) -> u32 {
    let mut info = PROCESS_BASIC_INFORMATION::default();
    let mut returned = 0u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            ProcessBasicInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of_val(&info) as u32,
            &mut returned,
        )
    };
    if status.is_ok() {
        info.InheritedFromUniqueProcessId as u32
    } else {
        0
    }
}

fn details_for(pid: u32) -> Option<ProcessDetails> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            // Protected process: fall back to the name by pid, as the C# provider does.
            let name = snapshot_name(pid)?;
            return Some(ProcessDetails {
                process_id: pid,
                parent_process_id: 0,
                exe_path: None,
                process_name: name,
                start_time_utc_ms: None,
            });
        };
        let mut buf = vec![0u16; IMAGE_NAME_CHARS];
        let mut len = buf.len() as u32;
        let exe_path = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .ok()
        .map(|_| image_name(&buf, len));
        let parent = parent_of(handle);
        let (mut created, mut exited, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        let start =
            if GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).is_ok() {
                filetime_to_unix_ms(created)
            } else {
                None
            };
        let _ = CloseHandle(handle);
        let name = exe_path
            .as_deref()
            .and_then(name_from_path)
            .or_else(|| snapshot_name(pid))?;
        Some(ProcessDetails {
            process_id: pid,
            parent_process_id: parent,
            exe_path,
            process_name: name,
            start_time_utc_ms: start,
        })
    }
}

#[napi]
pub fn get_process_details(pid: u32) -> Option<ProcessDetails> {
    details_for(pid)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn version_string(data: &[u8], lang: &str, key: &str) -> Option<String> {
    let query = wide(&format!("\\StringFileInfo\\{lang}\\{key}"));
    let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut len = 0u32;
    if !VerQueryValueW(
        data.as_ptr() as *const _,
        PCWSTR(query.as_ptr()),
        &mut ptr,
        &mut len,
    )
    .as_bool()
        || ptr.is_null()
        || len == 0
    {
        return None;
    }
    let slice = std::slice::from_raw_parts(ptr as *const u16, len as usize);
    let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
    Some(String::from_utf16_lossy(&slice[..end]))
}

#[napi]
pub fn get_version_details(path: String) -> Option<VersionDetails> {
    unsafe {
        let wpath = wide(&path);
        let size = GetFileVersionInfoSizeW(PCWSTR(wpath.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(
            PCWSTR(wpath.as_ptr()),
            None,
            size,
            data.as_mut_ptr() as *mut _,
        )
        .ok()?;
        let query = wide("\\VarFileInfo\\Translation");
        let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let mut langs: Vec<String> = Vec::new();
        if VerQueryValueW(
            data.as_ptr() as *const _,
            PCWSTR(query.as_ptr()),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            && !ptr.is_null()
        {
            let pairs = std::slice::from_raw_parts(ptr as *const u16, (len / 2) as usize);
            for pair in pairs.as_chunks::<2>().0 {
                langs.push(format!("{:04x}{:04x}", pair[0], pair[1]));
            }
        }
        langs.push("040904b0".to_string());
        langs.push("040904e4".to_string());
        for lang in &langs {
            let description = version_string(&data, lang, "FileDescription");
            let product = version_string(&data, lang, "ProductName");
            if description.is_some() || product.is_some() {
                return Some(VersionDetails {
                    file_description: description,
                    product_name: product,
                });
            }
        }
        Some(VersionDetails {
            file_description: None,
            product_name: None,
        })
    }
}

#[repr(C)]
struct OsVersionInfo {
    size: u32,
    major: u32,
    minor: u32,
    build: u32,
    platform: u32,
    csd: [u16; 128],
}

#[link(name = "ntdll")]
extern "system" {
    fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
}

/// Windows build number from `RtlGetVersion` (not subject to manifest compatibility lies).
#[napi]
pub fn windows_build() -> u32 {
    let mut info = OsVersionInfo {
        size: std::mem::size_of::<OsVersionInfo>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        csd: [0; 128],
    };
    unsafe {
        if RtlGetVersion(&mut info) == 0 {
            info.build
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_current_process_is_alive() {
        assert!(is_alive(std::process::id()));
    }

    #[test]
    fn a_child_that_was_killed_is_no_longer_alive() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > nul"])
            .spawn()
            .expect("spawn a child");
        let pid = child.id();
        assert!(is_alive(pid));
        child.kill().expect("kill the child");
        child.wait().expect("reap the child");
        assert!(!is_alive(pid));
    }

    #[test]
    fn an_unopenable_process_counts_as_alive_unless_the_pid_does_not_exist() {
        assert!(alive_when_unopenable(0x8007_0005_u32 as i32)); // access denied
        assert!(!alive_when_unopenable(NO_SUCH_PID));
    }

    #[test]
    fn a_path_longer_than_1024_characters_is_read_whole() {
        const { assert!(IMAGE_NAME_CHARS > 1024) };
        let long = "C:\\".to_string() + &"a".repeat(2000) + ".exe";
        let mut buf = vec![0u16; IMAGE_NAME_CHARS];
        let wide: Vec<u16> = long.encode_utf16().collect();
        buf[..wide.len()].copy_from_slice(&wide);
        assert_eq!(image_name(&buf, wide.len() as u32), long);
        // A length past the buffer cannot slice out of range.
        assert_eq!(image_name(&[104, 105], 10), "hi");
    }
}
