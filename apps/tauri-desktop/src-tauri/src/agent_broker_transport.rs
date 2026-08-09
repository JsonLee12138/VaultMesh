use super::agent_broker_execution::wait_for_native_authorization;
use super::*;

#[cfg(unix)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentIpcHello {
    protocol_version: u32,
    request_id: Uuid,
    #[serde(rename = "kind")]
    _kind: AgentIpcHelloKind,
    client: ClientHello,
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AgentIpcHelloKind {
    Hello,
}

#[cfg(unix)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentIpcSessionRequest {
    protocol_version: u32,
    request_id: Uuid,
    #[serde(rename = "kind")]
    _kind: AgentIpcSessionKind,
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AgentIpcSessionKind {
    Session,
}

#[cfg(unix)]
pub struct AgentBrokerUnixListener {
    endpoint: PathBuf,
    stopping: Arc<AtomicBool>,
    wake_writer: UnixStream,
    thread: Mutex<Option<JoinHandle<()>>>,
}

#[cfg(unix)]
struct ConnectionDisconnectMonitor {
    stopping: Arc<AtomicBool>,
    wake_writer: UnixStream,
    thread: Option<JoinHandle<()>>,
    broker: Arc<Mutex<AgentBrokerCore>>,
    client_id: Uuid,
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum UnixMonitorEvent {
    PeerReadable,
    PeerDisconnected,
    Wake,
}

#[cfg(unix)]
pub(super) fn signal_unix_monitor(stream: &UnixStream) {
    let mut stream = stream;
    loop {
        match stream.write(&[1]) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::BrokenPipe
                ) =>
            {
                break;
            }
            Err(_) => break,
        }
    }
}

#[cfg(unix)]
fn drain_unix_monitor(stream: &UnixStream) {
    let mut stream = stream;
    let mut bytes = [0_u8; 64];
    loop {
        match stream.read(&mut bytes) {
            Ok(0) => break,
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(_) => break,
        }
    }
}

#[cfg(unix)]
pub(super) fn wait_for_unix_monitor_event(
    peer: &UnixStream,
    wake_reader: &UnixStream,
    peer_read_armed: bool,
) -> std::io::Result<UnixMonitorEvent> {
    let mut descriptors = [
        libc::pollfd {
            fd: peer.as_raw_fd(),
            events: if peer_read_armed {
                libc::POLLIN | libc::POLLHUP | libc::POLLERR
            } else {
                libc::POLLHUP | libc::POLLERR
            },
            revents: 0,
        },
        libc::pollfd {
            fd: wake_reader.as_raw_fd(),
            events: libc::POLLIN | libc::POLLHUP | libc::POLLERR,
            revents: 0,
        },
    ];
    loop {
        let result = unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, -1) };
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        break;
    }
    if descriptors[1].revents != 0 {
        drain_unix_monitor(wake_reader);
        return Ok(UnixMonitorEvent::Wake);
    }
    if descriptors[0].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Ok(UnixMonitorEvent::PeerDisconnected);
    }
    if descriptors[0].revents & libc::POLLIN != 0 {
        let mut byte = 0_u8;
        let count = unsafe {
            libc::recv(
                peer.as_raw_fd(),
                (&mut byte as *mut u8).cast(),
                1,
                libc::MSG_PEEK | libc::MSG_DONTWAIT,
            )
        };
        if count == 0 {
            return Ok(UnixMonitorEvent::PeerDisconnected);
        }
        if count > 0 {
            return Ok(UnixMonitorEvent::PeerReadable);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::WouldBlock {
            return Err(error);
        }
    }
    Ok(UnixMonitorEvent::Wake)
}

#[cfg(unix)]
impl ConnectionDisconnectMonitor {
    fn start(
        stream: &UnixStream,
        broker: Arc<Mutex<AgentBrokerCore>>,
        client_id: Uuid,
    ) -> std::io::Result<Self> {
        let monitor_stream = stream.try_clone()?;
        let (wake_reader, wake_writer) = UnixStream::pair()?;
        wake_reader.set_nonblocking(true)?;
        wake_writer.set_nonblocking(true)?;
        let stopping = Arc::new(AtomicBool::new(false));
        let monitor_stopping = Arc::clone(&stopping);
        let monitor_broker = Arc::clone(&broker);
        let thread = thread::spawn(move || {
            let mut peer_read_armed = true;
            while !monitor_stopping.load(Ordering::Acquire) {
                match wait_for_unix_monitor_event(&monitor_stream, &wake_reader, peer_read_armed) {
                    Ok(UnixMonitorEvent::PeerReadable) => {
                        // A second level-triggered POLLIN would return immediately
                        // for the same frame. The request owner rearms this monitor
                        // after it consumes the complete frame.
                        peer_read_armed = false;
                    }
                    Ok(UnixMonitorEvent::Wake) => {
                        peer_read_armed = true;
                    }
                    Ok(UnixMonitorEvent::PeerDisconnected) | Err(_) => {
                        if let Ok(mut broker) = monitor_broker.lock() {
                            broker.disconnect(client_id);
                        }
                        break;
                    }
                }
            }
        });
        Ok(Self {
            stopping,
            wake_writer,
            thread: Some(thread),
            broker,
            client_id,
        })
    }

    fn frame_consumed(&self) {
        signal_unix_monitor(&self.wake_writer);
    }
}

#[cfg(unix)]
impl Drop for ConnectionDisconnectMonitor {
    fn drop(&mut self) {
        if let Ok(mut broker) = self.broker.lock() {
            broker.disconnect(self.client_id);
        }
        self.stopping.store(true, Ordering::Release);
        signal_unix_monitor(&self.wake_writer);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(unix)]
fn wait_for_unix_listener_event(
    listener: &UnixListener,
    wake_reader: &UnixStream,
) -> std::io::Result<bool> {
    let mut descriptors = [
        libc::pollfd {
            fd: listener.as_raw_fd(),
            events: libc::POLLIN | libc::POLLHUP | libc::POLLERR,
            revents: 0,
        },
        libc::pollfd {
            fd: wake_reader.as_raw_fd(),
            events: libc::POLLIN | libc::POLLHUP | libc::POLLERR,
            revents: 0,
        },
    ];
    loop {
        let result = unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, -1) };
        if result >= 0 {
            break;
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
    if descriptors[1].revents != 0 {
        drain_unix_monitor(wake_reader);
        return Ok(false);
    }
    if descriptors[0].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Err(std::io::Error::other("Agent listener unavailable"));
    }
    Ok(descriptors[0].revents & libc::POLLIN != 0)
}

#[cfg(unix)]
impl AgentBrokerUnixListener {
    pub fn start(
        endpoint: PathBuf,
        broker: Arc<Mutex<AgentBrokerCore>>,
        audit_sink: AgentAuditSink,
        executor: AgentToolExecutor,
        on_native_ui: Arc<dyn Fn(AgentNativeUiSurface) + Send + Sync>,
    ) -> std::io::Result<Self> {
        prepare_socket_endpoint(&endpoint)?;
        let listener = UnixListener::bind(&endpoint)?;
        fs::set_permissions(&endpoint, fs::Permissions::from_mode(0o600))?;
        listener.set_nonblocking(true)?;
        let (wake_reader, wake_writer) = UnixStream::pair()?;
        wake_reader.set_nonblocking(true)?;
        wake_writer.set_nonblocking(true)?;
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stopping = Arc::clone(&stopping);
        let active_connections = Arc::new(AtomicUsize::new(0));
        let thread = thread::spawn(move || {
            while !worker_stopping.load(Ordering::Acquire) {
                match wait_for_unix_listener_event(&listener, &wake_reader) {
                    Ok(true) => {}
                    Ok(false) if worker_stopping.load(Ordering::Acquire) => break,
                    Ok(false) => continue,
                    Err(_) => break,
                }
                match listener.accept() {
                    Ok((stream, _)) => {
                        if active_connections
                            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                                (active < MAX_CONNECTIONS).then_some(active + 1)
                            })
                            .is_err()
                        {
                            drop(stream);
                            continue;
                        }
                        let connection_guard =
                            ActiveConnectionGuard(Arc::clone(&active_connections));
                        let broker = Arc::clone(&broker);
                        let audit_sink = Arc::clone(&audit_sink);
                        let executor = Arc::clone(&executor);
                        let on_native_ui = Arc::clone(&on_native_ui);
                        let connection_stopping = Arc::clone(&worker_stopping);
                        thread::spawn(move || {
                            let _connection_guard = connection_guard;
                            let _ = serve_connection(
                                stream,
                                broker,
                                audit_sink,
                                executor,
                                on_native_ui,
                                connection_stopping,
                            );
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            endpoint,
            stopping,
            wake_writer,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        signal_unix_monitor(&self.wake_writer);
        if let Ok(mut thread) = self.thread.lock()
            && let Some(thread) = thread.take()
        {
            let _ = thread.join();
        }
        let _ = fs::remove_file(&self.endpoint);
    }
}

#[cfg(unix)]
impl Drop for AgentBrokerUnixListener {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(unix)]
pub(super) fn configure_unix_connection(stream: &UnixStream) -> std::io::Result<()> {
    // A nonblocking listener can yield a nonblocking accepted socket on BSD/macOS.
    // The frame reader relies on SO_RCVTIMEO for bounded shutdown checks, so make
    // the accepted connection mode explicit instead of inheriting platform state.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_millis(200)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))
}

#[cfg(unix)]
fn serve_connection(
    mut stream: UnixStream,
    broker: Arc<Mutex<AgentBrokerCore>>,
    audit_sink: AgentAuditSink,
    executor: AgentToolExecutor,
    on_native_ui: Arc<dyn Fn(AgentNativeUiSurface) + Send + Sync>,
    stopping: Arc<AtomicBool>,
) -> std::io::Result<()> {
    configure_unix_connection(&stream)?;
    let peer = trusted_peer_identity(&stream)?;
    let mut frame_reader = AgentFrameReader::default();
    let hello_line = frame_reader.read(&mut stream, &stopping)?;
    let hello: AgentIpcHello = serde_json::from_slice(&hello_line)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid hello"))?;
    if hello.protocol_version != PROTOCOL_VERSION {
        return write_json_line(
            &mut stream,
            &json!({ "ok": false, "requestId": hello.request_id, "error": AgentBrokerError::new("update-required", "The Agent protocol version is not supported.", false) }),
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
    let _disconnect_monitor =
        ConnectionDisconnectMonitor::start(&stream, Arc::clone(&broker), client_id)?;
    write_json_line(
        &mut stream,
        &json!({ "ok": true, "requestId": hello.request_id, "result": { "client": client, "session": Value::Null } }),
    )?;
    if pairing_pending {
        on_native_ui(AgentNativeUiSurface::Pairing);
    }
    loop {
        let line = frame_reader.read(&mut stream, &stopping)?;
        _disconnect_monitor.frame_consumed();
        let mut value: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                write_json_line(
                    &mut stream,
                    &json!({ "ok": false, "requestId": Value::Null, "error": AgentBrokerError::new("invalid-request", "The Agent request is invalid.", false) }),
                )?;
                continue;
            }
        };
        let mut audit = None;
        let mut action = None;
        let mut response = if value.get("kind").and_then(Value::as_str) == Some("session") {
            match serde_json::from_value::<AgentIpcSessionRequest>(value.clone()) {
                Ok(request) if request.protocol_version == PROTOCOL_VERSION => {
                    match broker
                        .lock()
                        .ok()
                        .and_then(|mut broker| broker.session(client_id, unix_millis()).ok())
                    {
                        Some(session) => {
                            json!({ "ok": true, "requestId": request.request_id, "result": session })
                        }
                        None => {
                            json!({ "ok": false, "requestId": request.request_id, "error": AgentBrokerError::new("unknown-client", "The Agent client is not connected.", false) })
                        }
                    }
                }
                _ => {
                    json!({ "ok": false, "requestId": value.get("requestId"), "error": AgentBrokerError::new("invalid-request", "The Agent request is invalid.", false) })
                }
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
                .unwrap_or_else(|_| json!({ "ok": false, "requestId": value.get("requestId"), "error": AgentBrokerError::internal() }))
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
        write_json_line(&mut stream, &response)?;
    }
}

#[cfg(unix)]
#[derive(Default)]
struct AgentFrameReader {
    pending: Vec<u8>,
}

#[cfg(unix)]
impl AgentFrameReader {
    fn read(&mut self, stream: &mut UnixStream, stopping: &AtomicBool) -> std::io::Result<Vec<u8>> {
        let mut started = None;
        loop {
            if let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
                let mut frame = self.pending.drain(..=newline).collect::<Vec<_>>();
                frame.pop();
                return Ok(frame);
            }
            if self.pending.len() > MAX_IPC_LINE_BYTES {
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
            let mut chunk = [0_u8; 8 * 1024];
            match stream.read(&mut chunk) {
                Ok(0) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "Agent IPC connection closed",
                    ));
                }
                Ok(read) => {
                    let started = started.get_or_insert_with(Instant::now);
                    if started.elapsed() > MAX_FRAME_DURATION {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "Agent IPC frame deadline exceeded",
                        ));
                    }
                    self.pending.extend_from_slice(&chunk[..read]);
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    if started
                        .is_some_and(|started: Instant| started.elapsed() > MAX_FRAME_DURATION)
                    {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "Agent IPC frame deadline exceeded",
                        ));
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(unix)]
fn prepare_socket_endpoint(endpoint: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    if endpoint.as_os_str().as_encoded_bytes().len() > 103 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Agent broker endpoint exceeds the macOS Unix socket limit",
        ));
    }
    let parent = endpoint.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Agent endpoint has no parent",
        )
    })?;
    fs::create_dir_all(parent)?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    match fs::symlink_metadata(endpoint) {
        Ok(metadata) if metadata.file_type().is_socket() => fs::remove_file(endpoint),
        Ok(_) => Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Agent endpoint is not a socket",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(all(unix, test))]
pub(super) fn read_line(
    stream: &mut UnixStream,
    stopping: &AtomicBool,
) -> std::io::Result<Vec<u8>> {
    read_line_with_deadline(stream, stopping, MAX_FRAME_DURATION)
}

#[cfg(all(unix, test))]
pub(super) fn read_line_with_deadline(
    stream: &mut UnixStream,
    stopping: &AtomicBool,
    frame_duration: std::time::Duration,
) -> std::io::Result<Vec<u8>> {
    let mut line = Vec::new();
    let mut byte = [0_u8; 1];
    let mut started = None;
    loop {
        if stopping.load(Ordering::Acquire) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Agent broker is stopping",
            ));
        }
        match stream.read_exact(&mut byte) {
            Ok(()) => {
                let started = started.get_or_insert_with(Instant::now);
                if started.elapsed() > frame_duration {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Agent IPC frame deadline exceeded",
                    ));
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if started.is_some_and(|started: Instant| started.elapsed() > frame_duration) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Agent IPC frame deadline exceeded",
                    ));
                }
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    // Defense in depth: a future caller that forgets to restore
                    // blocking mode must not turn an idle socket into a hot loop.
                    thread::sleep(Duration::from_millis(10));
                }
                continue;
            }
            Err(error) => return Err(error),
        }
        if byte[0] == b'\n' {
            return Ok(line);
        }
        line.push(byte[0]);
        if line.len() > MAX_IPC_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Agent IPC line too large",
            ));
        }
    }
}

#[cfg(unix)]
pub(super) fn write_json_line(stream: &mut UnixStream, value: &Value) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid response"))?;
    if bytes.len() > MAX_IPC_LINE_BYTES {
        bytes = serde_json::to_vec(&json!({
            "ok": false,
            "requestId": Value::Null,
            "error": AgentBrokerError::new("response-too-large", "The Agent response exceeds the size limit.", false)
        }))?;
    }
    bytes.push(b'\n');
    stream.write_all(&bytes)
}

#[cfg(target_os = "macos")]
fn trusted_peer_identity(stream: &UnixStream) -> std::io::Result<PeerIdentity> {
    let fd = stream.as_raw_fd();
    let mut uid = 0_u32;
    let mut gid = 0_u32;
    let user_result = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
    if user_result != 0 || uid != unsafe { libc::geteuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Agent peer user mismatch",
        ));
    }
    let mut pid = 0_i32;
    let mut pid_len = std::mem::size_of::<i32>() as libc::socklen_t;
    let pid_result = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut i32).cast(),
            &mut pid_len,
        )
    };
    if pid_result != 0 || pid <= 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Agent peer PID unavailable",
        ));
    }
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let path_length =
        unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if path_length <= 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Agent peer path unavailable",
        ));
    }
    buffer.truncate(path_length as usize);
    let executable = String::from_utf8(buffer).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Agent peer path invalid")
    })?;
    let binary_identity = executable_sha256(Path::new(&executable))?;
    Ok(PeerIdentity {
        user_id: uid.to_string(),
        process_id: pid as u32,
        executable,
        binary_identity,
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn trusted_peer_identity(stream: &UnixStream) -> std::io::Result<PeerIdentity> {
    let credential = stream.peer_cred()?;
    let process_id = credential.pid().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Agent peer PID unavailable",
        )
    })? as u32;
    let executable_path = fs::read_link(format!("/proc/{process_id}/exe"))?;
    let executable = executable_path.to_string_lossy().into_owned();
    let binary_identity = executable_sha256(&executable_path)?;
    Ok(PeerIdentity {
        user_id: credential.uid().to_string(),
        process_id,
        executable,
        binary_identity,
    })
}

#[cfg(unix)]
fn executable_sha256(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let hash = digest.finalize();
    Ok(format!("sha256:{hash:x}"))
}

#[cfg(unix)]
pub(super) fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(1, |duration| duration.as_millis() as u64)
}
