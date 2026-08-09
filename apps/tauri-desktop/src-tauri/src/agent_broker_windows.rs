#![cfg(target_os = "windows")]

use std::{
    ffi::{OsStr, OsString, c_void},
    fs::File,
    io::Read,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::Path,
    ptr::{null, null_mut},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE,
        GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree,
    },
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SDDL_REVISION_1,
        },
        EqualSid, GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
    },
    Storage::FileSystem::{
        CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, ReadFile,
        WriteFile,
    },
    System::{
        Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
            PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, PeekNamedPipe,
        },
        Threading::{
            GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        },
    },
};

use crate::agent_broker::{
    AgentAuditSink, AgentBrokerCore, AgentBrokerError, AgentNativeUiSurface, AgentToolExecutor,
    ClientHello, PairingState, PeerIdentity, attach_persisted_audit, complete_native_ui_action,
    execute_authorized_action, wait_for_native_authorization,
};

pub const AGENT_PIPE_NAME: &str = r"\\.\pipe\VaultMesh.AgentBroker.v1";
const PROTOCOL_VERSION: u32 = 2;
const MAX_LINE_BYTES: usize = 384 * 1024;
const MAX_PIPE_CONNECTIONS: usize = 32;
const MAX_FRAME_DURATION: Duration = Duration::from_secs(5);
const DISCONNECT_MONITOR_BACKOFF: Duration = Duration::from_millis(100);

struct ActivePipeGuard(Arc<AtomicUsize>);

impl Drop for ActivePipeGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

struct PipeDisconnectMonitor {
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    broker: Arc<Mutex<AgentBrokerCore>>,
    client_id: Uuid,
}

impl PipeDisconnectMonitor {
    fn start(pipe: HANDLE, broker: Arc<Mutex<AgentBrokerCore>>, client_id: Uuid) -> Self {
        let stopping = Arc::new(AtomicBool::new(false));
        let monitor_stopping = Arc::clone(&stopping);
        let monitor_broker = Arc::clone(&broker);
        let pipe_value = pipe as usize;
        let thread = thread::spawn(move || {
            let pipe = pipe_value as HANDLE;
            while !monitor_stopping.load(Ordering::Acquire) {
                let mut available = 0_u32;
                if unsafe {
                    PeekNamedPipe(pipe, null_mut(), 0, null_mut(), &mut available, null_mut())
                } == 0
                {
                    if let Ok(mut broker) = monitor_broker.lock() {
                        broker.disconnect(client_id);
                    }
                    break;
                }
                thread::sleep(DISCONNECT_MONITOR_BACKOFF);
            }
        });
        Self {
            stopping,
            thread: Some(thread),
            broker,
            client_id,
        }
    }
}

impl Drop for PipeDisconnectMonitor {
    fn drop(&mut self) {
        if let Ok(mut broker) = self.broker.lock() {
            broker.disconnect(self.client_id);
        }
        self.stopping.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentIpcHello {
    protocol_version: u32,
    request_id: Uuid,
    #[serde(rename = "kind")]
    _kind: HelloKind,
    client: ClientHello,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum HelloKind {
    Hello,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentIpcSessionRequest {
    protocol_version: u32,
    request_id: Uuid,
    #[serde(rename = "kind")]
    _kind: SessionKind,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum SessionKind {
    Session,
}

struct OwnedHandle(HANDLE);

unsafe impl Send for OwnedHandle {}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

struct SecurityDescriptor(*mut c_void);

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}

pub struct AgentBrokerWindowsListener {
    stopping: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl AgentBrokerWindowsListener {
    pub fn start(
        broker: Arc<Mutex<AgentBrokerCore>>,
        audit_sink: AgentAuditSink,
        executor: AgentToolExecutor,
        on_native_ui: Arc<dyn Fn(AgentNativeUiSurface) + Send + Sync>,
    ) -> std::io::Result<Self> {
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stopping = Arc::clone(&stopping);
        let active_connections = Arc::new(AtomicUsize::new(0));
        let thread = thread::spawn(move || {
            let mut first_instance = true;
            while !worker_stopping.load(Ordering::Acquire) {
                let pipe = match create_pipe(first_instance) {
                    Ok(pipe) => pipe,
                    Err(_) => break,
                };
                first_instance = false;
                let connected = unsafe { ConnectNamedPipe(pipe.0, null_mut()) };
                if connected == 0 && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED {
                    continue;
                }
                if worker_stopping.load(Ordering::Acquire) {
                    unsafe {
                        DisconnectNamedPipe(pipe.0);
                    }
                    break;
                }
                if active_connections
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                        (active < MAX_PIPE_CONNECTIONS).then_some(active + 1)
                    })
                    .is_err()
                {
                    unsafe {
                        DisconnectNamedPipe(pipe.0);
                    }
                    continue;
                }
                let connection_guard = ActivePipeGuard(Arc::clone(&active_connections));
                let broker = Arc::clone(&broker);
                let audit_sink = Arc::clone(&audit_sink);
                let executor = Arc::clone(&executor);
                let on_native_ui = Arc::clone(&on_native_ui);
                let connection_stopping = Arc::clone(&worker_stopping);
                thread::spawn(move || {
                    let _connection_guard = connection_guard;
                    let _ = serve_connection(
                        pipe,
                        broker,
                        audit_sink,
                        executor,
                        on_native_ui,
                        connection_stopping,
                    );
                });
            }
        });
        Ok(Self {
            stopping,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        wake_listener();
        if let Ok(mut thread) = self.thread.lock()
            && let Some(thread) = thread.take()
        {
            let _ = thread.join();
        }
    }
}

impl Drop for AgentBrokerWindowsListener {
    fn drop(&mut self) {
        self.stop();
    }
}

fn create_pipe(first_instance: bool) -> std::io::Result<OwnedHandle> {
    let pipe_name = wide(AGENT_PIPE_NAME);
    let (mut security, _descriptor) = current_user_security()?;
    let open_mode = PIPE_ACCESS_DUPLEX
        | if first_instance {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
    let pipe_mode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
    let handle = unsafe {
        CreateNamedPipeW(
            pipe_name.as_ptr(),
            open_mode,
            pipe_mode,
            PIPE_UNLIMITED_INSTANCES,
            MAX_LINE_BYTES as u32,
            MAX_LINE_BYTES as u32,
            1_000,
            &mut security,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(OwnedHandle(handle))
    }
}

fn current_user_security() -> std::io::Result<(SECURITY_ATTRIBUTES, SecurityDescriptor)> {
    let sid = current_user_sid_string()?;
    let sddl = wide(&format!("D:P(A;;GA;;;{sid})"));
    let mut descriptor = null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if converted == 0 || descriptor.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let owner = SecurityDescriptor(descriptor);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: owner.0,
        bInheritHandle: 0,
    };
    Ok((attributes, owner))
}

fn serve_connection(
    pipe: OwnedHandle,
    broker: Arc<Mutex<AgentBrokerCore>>,
    audit_sink: AgentAuditSink,
    executor: AgentToolExecutor,
    on_native_ui: Arc<dyn Fn(AgentNativeUiSurface) + Send + Sync>,
    stopping: Arc<AtomicBool>,
) -> std::io::Result<()> {
    let peer = trusted_peer_identity(pipe.0)?;
    let mut frame_reader = AgentFrameReader::default();
    let hello_line = frame_reader.read(pipe.0, &stopping)?;
    let hello: AgentIpcHello = serde_json::from_slice(&hello_line)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid hello"))?;
    if hello.protocol_version != PROTOCOL_VERSION {
        return write_json_line(
            pipe.0,
            &json!({ "ok": false, "requestId": hello.request_id, "error": AgentBrokerError { code: "update-required", message: "The Agent protocol version is not supported.", retryable: false, native_action_required: None, confirmation_ref: None, details: None } }),
        );
    }
    let client = broker
        .lock()
        .map_err(|_| std::io::Error::other("broker lock unavailable"))?
        .register_client(peer, hello.client, unix_millis())
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "client rejected")
        })?;
    let client_id = Uuid::parse_str(&client.client_id)
        .map_err(|_| std::io::Error::other("invalid broker client id"))?;
    let pairing_pending = client.pairing_state == PairingState::Pending;
    let _disconnect_monitor = PipeDisconnectMonitor::start(pipe.0, Arc::clone(&broker), client_id);
    write_json_line(
        pipe.0,
        &json!({ "ok": true, "requestId": hello.request_id, "result": { "client": client, "session": Value::Null } }),
    )?;
    if pairing_pending {
        on_native_ui(AgentNativeUiSurface::Pairing);
    }
    loop {
        let line = match frame_reader.read(pipe.0, &stopping) {
            Ok(line) => line,
            Err(error) => {
                unsafe {
                    DisconnectNamedPipe(pipe.0);
                }
                return Err(error);
            }
        };
        let mut value: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                write_json_line(
                    pipe.0,
                    &safe_error(
                        Value::Null,
                        "invalid-request",
                        "The Agent request is invalid.",
                    ),
                )?;
                continue;
            }
        };
        let mut audit = None;
        let mut action = None;
        let mut response = if value.get("kind").and_then(Value::as_str) == Some("session") {
            match serde_json::from_value::<AgentIpcSessionRequest>(value.clone()) {
                Ok(request) if request.protocol_version == PROTOCOL_VERSION => broker
                    .lock()
                    .ok()
                    .and_then(|mut broker| broker.session(client_id, unix_millis()).ok())
                    .map(|session| json!({ "ok": true, "requestId": request.request_id, "result": session }))
                    .unwrap_or_else(|| safe_error(json!(request.request_id), "unknown-client", "The Agent client is not connected.")),
                _ => safe_error(value.get("requestId").cloned().unwrap_or(Value::Null), "invalid-request", "The Agent request is invalid."),
            }
        } else {
            broker
                .lock()
                .map(|mut broker| {
                    let (response, next_audit, next_action) =
                        broker.authorize_json_for_dispatch(client_id, &line, unix_millis());
                    audit = next_audit;
                    action = next_action;
                    response
                })
                .unwrap_or_else(|_| {
                    safe_error(
                        value.get("requestId").cloned().unwrap_or(Value::Null),
                        "broker-unavailable",
                        "VaultMesh Agent broker is unavailable.",
                    )
                })
        };
        wait_for_native_authorization(
            &mut response,
            &mut audit,
            &mut action,
            &mut value,
            &broker,
            client_id,
            on_native_ui.as_ref(),
            &unix_millis,
        );
        execute_authorized_action(&mut response, &mut audit, action, &executor);
        attach_persisted_audit(&mut response, audit, &audit_sink);
        complete_native_ui_action(&mut response, on_native_ui.as_ref());
        write_json_line(pipe.0, &response)?;
    }
}

fn trusted_peer_identity(pipe: HANDLE) -> std::io::Result<PeerIdentity> {
    let mut process_id = 0_u32;
    if unsafe { GetNamedPipeClientProcessId(pipe, &mut process_id) } == 0 || process_id == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let process =
        OwnedHandle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) });
    if process.0.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let current_user = token_user(unsafe { GetCurrentProcess() })?;
    let peer_user = token_user(process.0)?;
    let current_sid = token_sid(&current_user);
    let peer_sid = token_sid(&peer_user);
    if unsafe { EqualSid(current_sid, peer_sid) } == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Agent peer user mismatch",
        ));
    }
    let mut path = vec![0_u16; 32_768];
    let mut path_length = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(process.0, 0, path.as_mut_ptr(), &mut path_length) } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    path.truncate(path_length as usize);
    let executable = OsString::from_wide(&path).to_string_lossy().into_owned();
    let binary_identity = executable_sha256(Path::new(&executable))?;
    Ok(PeerIdentity {
        user_id: sid_to_string(current_sid)?,
        process_id,
        executable,
        binary_identity,
    })
}

struct TokenUserBuffer {
    storage: Vec<usize>,
}

impl TokenUserBuffer {
    fn as_ptr(&self) -> *const TOKEN_USER {
        self.storage.as_ptr().cast()
    }
}

fn token_user(process: HANDLE) -> std::io::Result<TokenUserBuffer> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let token = OwnedHandle(token);
    let mut required = 0_u32;
    unsafe {
        GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut required);
    }
    if required == 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(std::io::Error::last_os_error());
    }
    // TOKEN_USER contains pointers and must be aligned to pointer width. A byte
    // vector does not provide that alignment guarantee.
    let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = TokenUserBuffer {
        storage: vec![0_usize; words],
    };
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            buffer.storage.as_mut_ptr().cast(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(buffer)
}

fn token_sid(buffer: &TokenUserBuffer) -> *mut c_void {
    unsafe { (*buffer.as_ptr()).User.Sid }
}

fn current_user_sid_string() -> std::io::Result<String> {
    let buffer = token_user(unsafe { GetCurrentProcess() })?;
    sid_to_string(token_sid(&buffer))
}

fn sid_to_string(sid: *mut c_void) -> std::io::Result<String> {
    let mut value = null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut value) } == 0 || value.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let mut length = 0;
    while unsafe { *value.add(length) } != 0 {
        length += 1;
    }
    let result = String::from_utf16(unsafe { std::slice::from_raw_parts(value, length) })
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid user SID"));
    unsafe {
        LocalFree(value.cast());
    }
    result
}

fn executable_sha256(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

#[derive(Default)]
struct AgentFrameReader {
    pending: Vec<u8>,
}

impl AgentFrameReader {
    fn read(&mut self, pipe: HANDLE, stopping: &AtomicBool) -> std::io::Result<Vec<u8>> {
        let mut started = None;
        loop {
            if let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
                let mut frame = self.pending.drain(..=newline).collect::<Vec<_>>();
                frame.pop();
                return Ok(frame);
            }
            if self.pending.len() > MAX_LINE_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Agent IPC line too large",
                ));
            }
            if stopping.load(Ordering::Acquire) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "Agent broker is stopping",
                ));
            }
            let mut available = 0_u32;
            if unsafe { PeekNamedPipe(pipe, null_mut(), 0, null_mut(), &mut available, null_mut()) }
                == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            if available == 0 {
                if started.is_some_and(|started: Instant| started.elapsed() > MAX_FRAME_DURATION) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Agent IPC frame deadline exceeded",
                    ));
                }
                thread::sleep(Duration::from_millis(20));
                continue;
            }
            let mut chunk = [0_u8; 8 * 1024];
            let requested = available.min(chunk.len() as u32);
            let mut read = 0_u32;
            if unsafe { ReadFile(pipe, chunk.as_mut_ptr(), requested, &mut read, null_mut()) } == 0
                || read == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            let started = started.get_or_insert_with(Instant::now);
            if started.elapsed() > MAX_FRAME_DURATION {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Agent IPC frame deadline exceeded",
                ));
            }
            self.pending.extend_from_slice(&chunk[..read as usize]);
        }
    }
}

fn write_json_line(pipe: HANDLE, value: &Value) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid response"))?;
    if bytes.len() > MAX_LINE_BYTES {
        bytes = serde_json::to_vec(&safe_error(
            Value::Null,
            "response-too-large",
            "The Agent response exceeds the size limit.",
        ))?;
    }
    bytes.push(b'\n');
    let mut offset = 0;
    while offset < bytes.len() {
        let mut written = 0_u32;
        if unsafe {
            WriteFile(
                pipe,
                bytes[offset..].as_ptr(),
                (bytes.len() - offset) as u32,
                &mut written,
                null_mut(),
            )
        } == 0
            || written == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        offset += written as usize;
    }
    Ok(())
}

fn safe_error(request_id: Value, code: &'static str, message: &'static str) -> Value {
    json!({
        "ok": false,
        "requestId": request_id,
        "error": { "code": code, "message": message, "retryable": false }
    })
}

fn wake_listener() {
    let pipe_name = wide(AGENT_PIPE_NAME);
    let handle = unsafe {
        CreateFileW(
            pipe_name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    if handle != INVALID_HANDLE_VALUE {
        drop(OwnedHandle(handle));
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(1, |duration| duration.as_millis() as u64)
}
