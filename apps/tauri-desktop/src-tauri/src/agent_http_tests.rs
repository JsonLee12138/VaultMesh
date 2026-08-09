use super::*;
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, TcpListener},
    sync::{Arc, mpsc},
    thread,
};
use vaultmesh_ffi::AgentRiskTier;

fn operation() -> AgentHttpOperationPolicy {
    AgentHttpOperationPolicy {
        name: "read_status".into(),
        method: "GET".into(),
        path: "/v1/status".into(),
        request_fields: vec!["scope".into()],
        response_fields: vec!["status".into(), "items".into(), "token".into()],
        request_mode: AgentHttpBodyMode::Json,
        response_mode: AgentHttpBodyMode::Json,
        risk: AgentRiskTier::R1,
    }
}

#[test]
fn named_operation_rejects_agent_selected_fields_and_paths() {
    assert!(validate_input(&operation(), &json!({ "scope": "safe" })).is_ok());
    assert_eq!(
        validate_input(
            &operation(),
            &json!({ "scope": "safe", "url": "https://evil.test" })
        )
        .unwrap_err()
        .code,
        "http-request-schema-invalid"
    );
}

#[test]
fn account_bound_target_accepts_http_and_all_literal_address_classes() {
    for origin in [
        "http://127.0.0.1:8080",
        "https://10.0.0.1:8443",
        "http://169.254.169.254",
        "https://100.64.0.1",
        "http://192.168.1.1",
        "https://[::1]:8443",
        "http://[fe80::1]",
        "https://[fc00::1]",
    ] {
        assert!(
            resolve_bound_target(origin, "/v1/status").is_ok(),
            "{origin}"
        );
    }
    assert_eq!(
        resolve_bound_target("ftp://127.0.0.1", "/v1/status")
            .unwrap_err()
            .code,
        "http-policy-invalid"
    );
}

#[test]
fn response_is_reconstructed_bounded_and_secret_canary_safe() {
    let safe = build_safe_response(
        200,
        json!({ "status": "ready", "items": [1, 2, 3], "ignored": "private" }),
        &operation().response_fields,
        &["status".into(), "items".into()],
        256,
        2,
        &["token-canary".into()],
    )
    .unwrap();
    assert_eq!(safe["fields"]["status"], "ready");
    assert_eq!(safe["fields"]["items"], json!([1, 2]));
    assert!(safe["fields"].get("ignored").is_none());
    assert_eq!(safe["truncated"], true);
    assert_eq!(
        build_safe_response(
            200,
            json!({ "token": STANDARD.encode("token-canary") }),
            &operation().response_fields,
            &["token".into()],
            256,
            2,
            &["token-canary".into()],
        )
        .unwrap_err()
        .code,
        "http-response-secret-detected"
    );
}

#[test]
fn direct_json_response_is_recursively_bounded_and_redacts_sensitive_keys() {
    let safe = build_safe_response(
        200,
        json!({
            "project": { "id": 42, "access_token": "remote-secret" },
            "items": [{ "name": "one", "password": "hidden" }, { "name": "two" }]
        }),
        &["*".into()],
        &["*".into()],
        1_024,
        1,
        &["local-token-canary".into()],
    )
    .unwrap();
    assert_eq!(safe["fields"]["project"]["id"], 42);
    assert_eq!(safe["fields"]["project"]["access_token"], "[REDACTED]");
    assert_eq!(safe["fields"]["items"][0]["password"], "[REDACTED]");
    assert_eq!(safe["fields"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(safe["truncated"], true);
}

#[test]
fn der_spki_parser_rejects_malformed_certificates() {
    assert!(certificate_spki(&[]).is_none());
    assert!(certificate_spki(&[0x30, 0x80]).is_none());
    assert!(certificate_spki(&[0x30, 0x01, 0x00]).is_none());
}

#[test]
fn cancelled_request_never_starts() {
    let cancellation = Arc::new(AtomicBool::new(true));
    let plan = AgentHttpRequestPlan {
        origin: "https://example.com".into(),
        operation: operation(),
        input: json!({}),
        authentication: AgentHttpAuthentication::Bearer(Zeroizing::new("canary".into())),
        tls_spki_sha256: vec![],
        allowed_output_fields: vec![],
        max_output_bytes: 256,
        max_output_items: 1,
        discard_response_body: false,
    };
    assert_eq!(
        execute_agent_request(plan, &cancellation).unwrap_err().code,
        "session-cancelled"
    );
}

fn local_tls_server(
    response: &'static str,
) -> (u16, Vec<u8>, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    local_tls_server_with_delay(response, Duration::ZERO)
}

fn local_tls_server_with_delay(
    response: &'static str,
    response_delay: Duration,
) -> (u16, Vec<u8>, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let certificate_der = cert.der().to_vec();
    let server = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(
                certificate_der.clone(),
            )],
            rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(
                signing_key.serialize_der(),
            )),
        )
        .unwrap();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let connection = rustls::ServerConnection::new(Arc::new(server)).unwrap();
        let mut tls = rustls::StreamOwned::new(connection, stream);
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let count = tls.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            if complete_http_request(&request) {
                break;
            }
        }
        let _ = sender.send(String::from_utf8(request).unwrap());
        thread::sleep(response_delay);
        let _ = tls.write_all(response.as_bytes());
        let _ = tls.flush();
    });
    (port, certificate_der, receiver, worker)
}

fn local_http_server(
    response: &'static str,
) -> (u16, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            if complete_http_request(&request) {
                break;
            }
        }
        let _ = sender.send(String::from_utf8(request).unwrap());
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    });
    (port, receiver, worker)
}

fn complete_http_request(request: &[u8]) -> bool {
    let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
    let content_length = headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    request.len() >= header_end.saturating_add(4).saturating_add(content_length)
}

fn live_plan(port: u16, pin: String) -> AgentHttpRequestPlan {
    AgentHttpRequestPlan {
        origin: format!("https://127.0.0.1:{port}"),
        operation: operation(),
        input: json!({ "scope": "safe" }),
        authentication: AgentHttpAuthentication::Bearer(Zeroizing::new("http-token-canary".into())),
        tls_spki_sha256: vec![pin],
        allowed_output_fields: vec!["status".into()],
        max_output_bytes: 4_096,
        max_output_items: 10,
        discard_response_body: false,
    }
}

#[test]
fn live_self_signed_tls_request_needs_neither_root_nor_pin() {
    let body = r#"{"status":"ready","ignored":"not-returned"}"#;
    let response = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
    let (port, _certificate, request, worker) = local_tls_server(response);
    let mut plan = live_plan(port, String::new());
    plan.tls_spki_sha256.clear();
    let result =
        tauri::async_runtime::block_on(execute_agent_request_async_with_root(plan, None)).unwrap();
    let request = request.recv_timeout(Duration::from_secs(1)).unwrap();
    worker.join().unwrap();
    assert!(request.starts_with("GET /v1/status?scope=safe HTTP/1.1\r\n"));
    assert!(request.contains("\r\nauthorization: Bearer http-token-canary\r\n"));
    assert_eq!(result["status"], 200);
    assert_eq!(result["fields"]["status"], "ready");
    assert!(result["fields"].get("ignored").is_none());
    assert!(!result.to_string().contains("http-token-canary"));
}

#[test]
fn live_plain_http_request_uses_the_exact_loopback_account_origin() {
    let body = r#"{"status":"ready"}"#;
    let response = Box::leak(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_boxed_str(),
    );
    let (port, request, worker) = local_http_server(response);
    let mut plan = live_plan(port, String::new());
    plan.origin = format!("http://127.0.0.1:{port}");
    plan.tls_spki_sha256.clear();
    let result = tauri::async_runtime::block_on(execute_agent_request_async_with_root(plan, None))
        .expect("account-bound HTTP request");
    let request = request.recv_timeout(Duration::from_secs(1)).unwrap();
    worker.join().unwrap();
    assert!(request.starts_with("GET /v1/status?scope=safe HTTP/1.1\r\n"));
    assert!(request.contains("\r\nauthorization: Bearer http-token-canary\r\n"));
    assert_eq!(result["fields"]["status"], "ready");
}

#[test]
fn status_mode_discards_non_json_error_body() {
    let body = "credential denied";
    let response = Box::leak(
            format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
    let (port, certificate, _, worker) = local_tls_server(response);
    let spki = certificate_spki(&certificate).unwrap();
    let pin = format!("sha256:{:x}", Sha256::digest(spki));
    let root = reqwest::Certificate::from_der(&certificate).unwrap();
    let mut plan = live_plan(port, pin);
    plan.operation.request_fields.clear();
    plan.operation.response_fields.clear();
    plan.input = json!({});
    plan.discard_response_body = true;
    let result =
        tauri::async_runtime::block_on(execute_agent_request_async_with_root(plan, Some(root)))
            .expect("bounded rejection status");
    worker.join().unwrap();
    assert_eq!(result["status"], 401);
    assert_eq!(result["fields"], json!({}));
    assert!(!result.to_string().contains(body));
}

#[test]
fn live_tls_request_rejects_redirect_and_pin_substitution() {
    let redirect = "HTTP/1.1 302 Found\r\nLocation: https://evil.example.test/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let (port, certificate, _, worker) = local_tls_server(redirect);
    let spki = certificate_spki(&certificate).unwrap();
    let pin = format!("sha256:{:x}", Sha256::digest(spki));
    let root = reqwest::Certificate::from_der(&certificate).unwrap();
    assert_eq!(
        tauri::async_runtime::block_on(execute_agent_request_async_with_root(
            live_plan(port, pin),
            Some(root),
        ))
        .unwrap_err()
        .code,
        "http-redirect-denied"
    );
    worker.join().unwrap();

    let body = r#"{"status":"ready"}"#;
    let response = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
    let (port, certificate, _, worker) = local_tls_server(response);
    let root = reqwest::Certificate::from_der(&certificate).unwrap();
    assert_eq!(
        tauri::async_runtime::block_on(execute_agent_request_async_with_root(
            live_plan(port, format!("sha256:{}", "0".repeat(64))),
            Some(root),
        ))
        .unwrap_err()
        .code,
        "http-tls-pin-mismatch"
    );
    worker.join().unwrap();
}

#[test]
fn active_tls_request_is_aborted_when_session_is_cancelled() {
    let body = r#"{"status":"too-late"}"#;
    let response = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
    let (port, certificate, request, server) =
        local_tls_server_with_delay(response, Duration::from_millis(500));
    let spki = certificate_spki(&certificate).unwrap();
    let pin = format!("sha256:{:x}", Sha256::digest(spki));
    let root = reqwest::Certificate::from_der(&certificate).unwrap();
    let cancellation = Arc::new(AtomicBool::new(false));
    let task_cancellation = Arc::clone(&cancellation);
    let task = thread::spawn(move || {
        execute_agent_request_with_root(live_plan(port, pin), &task_cancellation, Some(root))
    });
    // The shared Tauri test runtime can be busy when the full workspace runs in
    // parallel; wait for the request to become active before measuring the
    // cancellation latency itself.
    request.recv_timeout(Duration::from_secs(5)).unwrap();
    let cancelled_at = std::time::Instant::now();
    cancellation.store(true, Ordering::Release);
    assert_eq!(task.join().unwrap().unwrap_err().code, "session-cancelled");
    assert!(cancelled_at.elapsed() < Duration::from_millis(300));
    server.join().unwrap();
}
