fn recipe(
    session: &ManagedWebSession,
    name: &str,
    kind: AgentWebRecipeKind,
) -> Result<AgentWebRecipePolicy, &'static str> {
    session
        .recipes
        .iter()
        .find(|recipe| recipe.name == name && recipe.kind == kind)
        .cloned()
        .ok_or("web-policy-denied")
}

fn ensure_current_recipe_path(
    session: &ManagedWebSession,
    recipe: &AgentWebRecipePolicy,
) -> Result<(), &'static str> {
    let current = session.window.url().map_err(|_| "web-navigation-failed")?;
    let expected = approved_url(&session.origins[0], &recipe.path, &session.origins)?;
    if current.origin() == expected.origin() && current.path() == expected.path() {
        Ok(())
    } else {
        Err("web-navigation-mismatch")
    }
}

fn approved_url(origin: &str, path: &str, origins: &[String]) -> Result<Url, &'static str> {
    let base = Url::parse(origin).map_err(|_| "web-policy-invalid")?;
    let url = base.join(path).map_err(|_| "web-policy-invalid")?;
    if url.scheme() != "https"
        || url.query().is_some()
        || url.fragment().is_some()
        || !origin_allowed(&url, origins)
    {
        return Err("web-policy-denied");
    }
    Ok(url)
}

fn origin_allowed(url: &Url, origins: &[String]) -> bool {
    url.scheme() == "https"
        && origins.iter().any(|origin| {
            Url::parse(origin)
                .ok()
                .is_some_and(|allowed| allowed.origin() == url.origin())
        })
}

fn protected_kind_name(kind: AgentManagedWebProtectedKind) -> &'static str {
    match kind {
        AgentManagedWebProtectedKind::Totp => "totp",
        AgentManagedWebProtectedKind::EmailOtp => "email-otp",
        AgentManagedWebProtectedKind::RecoveryCode => "recovery-code",
    }
}

fn recipe_kind(kind: AgentManagedWebProtectedKind) -> AgentWebRecipeKind {
    match kind {
        AgentManagedWebProtectedKind::Totp => AgentWebRecipeKind::Totp,
        AgentManagedWebProtectedKind::EmailOtp => AgentWebRecipeKind::EmailOtp,
        AgentManagedWebProtectedKind::RecoveryCode => AgentWebRecipeKind::RecoveryCode,
    }
}

fn run_script_callback(
    window: &WebviewWindow,
    script: Zeroizing<String>,
    cancellation: &AtomicBool,
) -> Result<Value, &'static str> {
    let (sender, receiver) = sync_channel(1);
    window
        .eval_with_callback(script.as_str(), move |serialized| {
            let _ = sender.try_send(serialized);
        })
        .map_err(|_| "web-script-failed")?;
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            return Err("web-operation-timeout");
        }
        match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(serialized) => return decode_evaluation_result(&serialized),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("web-session-unavailable"),
        }
    }
}

fn login_script(
    recipe: &AgentWebRecipePolicy,
    username: &str,
    password: &str,
) -> Result<Zeroizing<String>, &'static str> {
    let values = [
        recipe.username_selector.as_deref(),
        recipe.password_selector.as_deref(),
        recipe.submit_selector.as_deref(),
    ];
    if values.iter().any(|value| value.is_none()) {
        return Err("web-policy-invalid");
    }
    Ok(Zeroizing::new(format!(
        r#"(()=>{{try{{const userSel={};const passSel={};const submitSel={};const username={};const password={};const user=document.querySelector(userSel);const pass=document.querySelector(passSel);const submit=document.querySelector(submitSel);if(!user||!pass||!submit)return{{status:'unavailable'}};const set=(el,value)=>{{const owner=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(owner,'value')?.set;if(!setter)return false;setter.call(el,value);el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return true;}};if(!set(user,username)||!set(pass,password))return{{status:'unavailable'}};submit.click();return{{status:'submitted'}};}}catch(_){{return{{status:'script-error'}};}}}})()"#,
        js(&values[0])?,
        js(&values[1])?,
        js(&values[2])?,
        js(&Some(username))?,
        js(&Some(password))?,
    )))
}

fn extract_script(recipe: &AgentWebRecipePolicy) -> Result<Zeroizing<String>, &'static str> {
    let fields = serde_json::to_string(
        &recipe
            .fields
            .iter()
            .map(|field| {
                json!({
                    "name": field.name,
                    "selector": field.selector,
                    "source": match field.source { AgentWebFieldSource::Text => "text", AgentWebFieldSource::Href => "href" }
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|_| "web-policy-invalid")?;
    Ok(Zeroizing::new(format!(
        r#"(()=>{{try{{const fields={fields};const out={{}};for(const field of fields){{const el=document.querySelector(field.selector);if(!el)return{{status:'missing'}};if(el instanceof HTMLInputElement&&(el.type==='password'||el.type==='hidden'))return{{status:'forbidden-node'}};let value=field.source==='href'?(el.href||''):(el.textContent||'');out[field.name]=String(value).trim().slice(0,4096);}}return{{status:'ok',fields:out}};}}catch(_){{return{{status:'script-error'}};}}}})()"#
    )))
}

fn ready_script() -> Zeroizing<String> {
    Zeroizing::new(
        r#"(()=>{try{return{status:document.readyState==='complete'?'ready':'pending'};}catch(_){return{status:'script-error'};}})()"#.to_owned(),
    )
}

fn recipe_result_script(recipe: &AgentWebRecipePolicy) -> Result<Zeroizing<String>, &'static str> {
    let success = recipe
        .success_selector
        .as_deref()
        .ok_or("web-policy-invalid")?;
    Ok(Zeroizing::new(format!(
        r#"(()=>{{try{{const success=document.querySelector({});if(success)return{{status:'success'}};const failureSel={};if(failureSel&&document.querySelector(failureSel))return{{status:'rejected'}};return{{status:'pending'}};}}catch(_){{return{{status:'script-error'}};}}}})()"#,
        js(&Some(success))?,
        js(&recipe.failure_selector.as_deref())?,
    )))
}

fn action_script(
    recipe: &AgentWebRecipePolicy,
    input: &Map<String, Value>,
) -> Result<Zeroizing<String>, &'static str> {
    let mappings = serde_json::to_string(
        &recipe
            .inputs
            .iter()
            .map(|field| json!({ "name": field.name, "selector": field.selector }))
            .collect::<Vec<_>>(),
    )
    .map_err(|_| "web-policy-invalid")?;
    Ok(Zeroizing::new(format!(
        r#"(()=>{{try{{const input={};const mappings={mappings};for(const field of mappings){{const el=document.querySelector(field.selector);if(!el)return{{status:'missing'}};const value=input[field.name]??'';const owner=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(owner,'value')?.set;if(!setter)return{{status:'missing'}};setter.call(el,value);el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));}}const target=document.querySelector({});if(!target)return{{status:'missing'}};target.click();return{{status:'submitted'}};}}catch(_){{return{{status:'script-error'}};}}}})()"#,
        serde_json::to_string(input).map_err(|_| "invalid-parameters")?,
        js(&recipe.selector.as_deref())?,
    )))
}

fn protected_fill_script(
    recipe: &AgentWebRecipePolicy,
    value: &str,
) -> Result<Zeroizing<String>, &'static str> {
    Ok(Zeroizing::new(format!(
        r#"(()=>{{try{{const field=document.querySelector({});const submit=document.querySelector({});if(!field||!submit)return{{status:'missing'}};const owner=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(owner,'value')?.set;if(!setter)return{{status:'missing'}};setter.call(field,{});field.dispatchEvent(new Event('input',{{bubbles:true}}));field.dispatchEvent(new Event('change',{{bubbles:true}}));submit.click();return{{status:'submitted'}};}}catch(_){{return{{status:'script-error'}};}}}})()"#,
        js(&recipe.selector.as_deref())?,
        js(&recipe.submit_selector.as_deref())?,
        js(&Some(value))?,
    )))
}

fn click_script(recipe: &AgentWebRecipePolicy) -> Result<Zeroizing<String>, &'static str> {
    Ok(Zeroizing::new(format!(
        "(()=>{{try{{const target=document.querySelector({});if(!target)return{{status:'missing'}};target.click();return{{status:'clicked'}};}}catch(_){{return{{status:'script-error'}};}}}})()",
        js(&recipe.selector.as_deref())?
    )))
}

fn passkey_capture_script(
    recipe: &AgentWebRecipePolicy,
    operation: &str,
    completion_key: &str,
) -> Result<Zeroizing<String>, &'static str> {
    let selector = recipe.selector.as_deref().ok_or("web-policy-invalid")?;
    let script = format!(
        r#"(async()=>{{try{{const selector={selector};const operation={operation};const key={key};const target=document.querySelector(selector);if(!target)return{{status:'missing'}};const credentials=navigator.credentials;if(!credentials||typeof credentials[operation]!=='function')return{{status:'unavailable'}};const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(credentials),operation);const original=credentials[operation].bind(credentials);const b64=(value)=>{{const bytes=value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;if(!bytes)throw new TypeError('binary');let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}};const credential=(value)=>({{type:value.type||'public-key',id:b64(value.id),transports:Array.isArray(value.transports)?value.transports.slice(0,16):[]}});const serialize=(options)=>{{const p=options&&options.publicKey;if(!p)throw new TypeError('publicKey');const extensions={{remoteDesktopClientOverride:{{origin:location.origin,sameOriginWithAncestors:true}},credProps:Boolean(p.extensions&&p.extensions.credProps)}};if(p.extensions&&p.extensions.appid)extensions.appid=String(p.extensions.appid);if(p.extensions&&p.extensions.largeBlob)extensions.largeBlob={{support:String(p.extensions.largeBlob.support||'')}};if(operation==='create')return{{rp:{{id:String((p.rp&&p.rp.id)||location.hostname),name:String((p.rp&&p.rp.name)||location.hostname)}},user:{{id:b64(p.user.id),name:String(p.user.name),displayName:p.user.displayName==null?null:String(p.user.displayName)}},challenge:b64(p.challenge),pubKeyCredParams:Array.from(p.pubKeyCredParams||[]).slice(0,64).map(v=>({{type:String(v.type),alg:Number(v.alg)}})),excludeCredentials:Array.from(p.excludeCredentials||[]).slice(0,200).map(credential),authenticatorSelection:p.authenticatorSelection||null,extensions}};return{{challenge:b64(p.challenge),rpId:String(p.rpId||location.hostname),allowCredentials:Array.from(p.allowCredentials||[]).slice(0,200).map(credential),userVerification:String(p.userVerification||'preferred'),extensions}};}};return await new Promise((done)=>{{let settled=false;let timer;const slot=Symbol.for(key);const state={{resolve:null,reject:null,cancel:null}};Object.defineProperty(window,slot,{{value:state,configurable:true,enumerable:false}});const restore=()=>{{try{{if(descriptor)Object.defineProperty(credentials,operation,descriptor);else delete credentials[operation];}}catch(_){{}}}};state.cancel=()=>{{clearTimeout(timer);restore();if(state.reject)state.reject(new DOMException('Passkey request cancelled','NotAllowedError'));delete window[slot];if(!settled){{settled=true;done({{status:'cancelled'}});}}}};timer=setTimeout(state.cancel,10000);const hook=(options)=>{{if(settled)return original(options);settled=true;clearTimeout(timer);restore();const promise=new Promise((resolve,reject)=>{{state.resolve=resolve;state.reject=reject;}});try{{done({{status:'captured',requestDetailsJson:JSON.stringify(serialize(options))}});}}catch(_){{state.cancel();done({{status:'invalid'}});}}return promise;}};try{{Object.defineProperty(credentials,operation,{{value:hook,configurable:true}});target.click();}}catch(_){{state.cancel();done({{status:'script-error'}});}}}});}}catch(_){{return{{status:'script-error'}};}}}})()"#,
        selector = serde_json::to_string(selector).map_err(|_| "web-policy-invalid")?,
        operation = serde_json::to_string(operation).map_err(|_| "web-policy-invalid")?,
        key = serde_json::to_string(completion_key).map_err(|_| "web-policy-invalid")?,
    );
    Ok(Zeroizing::new(script))
}

fn passkey_completion_script(
    completion_key: &str,
    response_json: &str,
) -> Result<Zeroizing<String>, &'static str> {
    let key = serde_json::to_string(completion_key).map_err(|_| "web-policy-invalid")?;
    let response = serde_json::to_string(response_json).map_err(|_| "web-policy-invalid")?;
    Ok(Zeroizing::new(format!(
        r#"(()=>{{const slot=Symbol.for({key});const pending=window[slot];if(!pending)return;try{{const data=JSON.parse({response});const decode=(value)=>{{const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((value.length+3)%4);const raw=atob(padded);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes.buffer;}};const fields=data.response.attestationObject!==undefined?['clientDataJSON','attestationObject','authenticatorData','publicKey']:['clientDataJSON','authenticatorData','signature','userHandle'];const responseObject={{}};for(const field of fields)if(data.response[field]!=null)responseObject[field]=decode(data.response[field]);if(data.response.publicKeyAlgorithm!==undefined)responseObject.publicKeyAlgorithm=data.response.publicKeyAlgorithm;if(data.response.transports!==undefined)responseObject.getTransports=()=>data.response.transports.slice();const credential=Object.create(typeof PublicKeyCredential==='function'?PublicKeyCredential.prototype:Object.prototype);Object.defineProperties(credential,{{id:{{value:data.id,enumerable:true}},rawId:{{value:decode(data.rawId),enumerable:true}},type:{{value:'public-key',enumerable:true}},authenticatorAttachment:{{value:data.authenticatorAttachment||'platform',enumerable:true}},response:{{value:responseObject,enumerable:true}},getClientExtensionResults:{{value:()=>data.clientExtensionResults||{{}}}}}});pending.resolve(credential);}}catch(_){{pending.reject(new DOMException('VaultMesh could not complete the Passkey request','NotAllowedError'));}}finally{{delete window[slot];}}}})()"#
    )))
}

fn passkey_pending_script(completion_key: &str) -> Zeroizing<String> {
    let key = serde_json::to_string(completion_key).unwrap_or_else(|_| "\"\"".to_owned());
    Zeroizing::new(format!(
        r#"(()=>{{const pending=window[Symbol.for({key})];return{{status:pending&&typeof pending.resolve==='function'&&typeof pending.reject==='function'?'active':'missing'}};}})()"#
    ))
}

fn passkey_rejection_script(completion_key: &str) -> String {
    let key = serde_json::to_string(completion_key).unwrap_or_else(|_| "\"\"".to_owned());
    format!(
        r#"(()=>{{const slot=Symbol.for({key});const pending=window[slot];if(pending){{if(typeof pending.cancel==='function')pending.cancel();else try{{pending.reject(new DOMException('Passkey request cancelled','NotAllowedError'));}}finally{{delete window[slot];}}}}}})()"#
    )
}

fn js(value: &Option<&str>) -> Result<String, &'static str> {
    serde_json::to_string(value.unwrap_or("")).map_err(|_| "web-policy-invalid")
}

fn decode_evaluation_result(serialized: &str) -> Result<Value, &'static str> {
    if serialized.len() > 128 * 1024 {
        return Err("web-output-too-large");
    }
    serde_json::from_str(serialized).map_err(|_| "web-script-failed")
}

fn wait_for_recipe_result(
    window: &WebviewWindow,
    recipe: &AgentWebRecipePolicy,
    cancellation: &AtomicBool,
    failure_code: &'static str,
) -> Result<(), &'static str> {
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            return Err(failure_code);
        }
        match run_script_callback(window, recipe_result_script(recipe)?, cancellation) {
            Ok(value) => match value.get("status").and_then(Value::as_str) {
                Some("success") => return Ok(()),
                Some("rejected" | "script-error") => return Err(failure_code),
                Some("pending") => {}
                _ => return Err(failure_code),
            },
            Err("web-script-failed" | "web-session-unavailable") => {}
            Err(error) => return Err(error),
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_document_ready(
    window: &WebviewWindow,
    cancellation: &AtomicBool,
) -> Result<(), &'static str> {
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            return Err("web-navigation-failed");
        }
        match run_script_callback(window, ready_script(), cancellation) {
            Ok(value) if value.get("status").and_then(Value::as_str) == Some("ready") => {
                return Ok(());
            }
            Ok(value) if value.get("status").and_then(Value::as_str) == Some("pending") => {}
            Ok(_) => return Err("web-navigation-failed"),
            Err("web-script-failed" | "web-session-unavailable") => {}
            Err(error) => return Err(error),
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn validate_extracted_fields(
    session: &ManagedWebSession,
    recipe: &AgentWebRecipePolicy,
    value: Value,
) -> Result<Map<String, Value>, &'static str> {
    if value.get("status").and_then(Value::as_str) != Some("ok") {
        return Err("web-extract-failed");
    }
    let input = value
        .get("fields")
        .and_then(Value::as_object)
        .ok_or("web-extract-failed")?;
    let mut output = Map::new();
    for field in &recipe.fields {
        if !session.allowed_output_fields.contains(&field.name) {
            continue;
        }
        let value = input
            .get(&field.name)
            .and_then(Value::as_str)
            .ok_or("web-extract-failed")?;
        let sanitized = match field.source {
            AgentWebFieldSource::Text => value.to_owned(),
            AgentWebFieldSource::Href => sanitize_href(value, &session.origins)?,
        };
        if contains_canary(sanitized.as_bytes(), &session.canaries) {
            return Err("web-secret-detected");
        }
        output.insert(field.name.clone(), Value::String(sanitized));
    }
    if serde_json::to_vec(&output)
        .map_err(|_| "web-extract-failed")?
        .len()
        > session.max_output_bytes
    {
        return Err("web-output-too-large");
    }
    Ok(output)
}

fn sanitize_href(value: &str, origins: &[String]) -> Result<String, &'static str> {
    let url = Url::parse(value).map_err(|_| "web-extract-failed")?;
    if !origin_allowed(&url, origins) {
        return Err("web-origin-denied");
    }
    let mut safe = format!("{}{}", url.origin().ascii_serialization(), url.path());
    if safe.len() > 4096 {
        safe.truncate(4096);
    }
    Ok(safe)
}

fn validate_action_input(
    recipe: &AgentWebRecipePolicy,
    input: &Value,
) -> Result<Map<String, Value>, &'static str> {
    let object = input.as_object().ok_or("invalid-parameters")?;
    if object.len() != recipe.inputs.len() {
        return Err("invalid-parameters");
    }
    let mut output = Map::new();
    for field in &recipe.inputs {
        let value = object
            .get(&field.name)
            .and_then(Value::as_str)
            .filter(|value| value.len() <= field.max_length as usize)
            .ok_or("invalid-parameters")?;
        output.insert(field.name.clone(), Value::String(value.to_owned()));
    }
    Ok(output)
}

fn contains_canary(bytes: &[u8], canaries: &[String]) -> bool {
    canaries
        .iter()
        .filter(|value| !value.is_empty())
        .any(|value| {
            let encoded = STANDARD.encode(value.as_bytes());
            let hex = value
                .as_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            [value.as_bytes(), encoded.as_bytes(), hex.as_bytes()]
                .iter()
                .any(|needle| bytes.windows(needle.len()).any(|window| window == *needle))
        })
}

fn wait_for_page_load(
    receiver: &std::sync::mpsc::Receiver<Url>,
    origins: &[String],
    cancellation: &AtomicBool,
    timeout: Duration,
) -> Result<(), &'static str> {
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= timeout {
            return Err("web-operation-timeout");
        }
        match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(url) if origin_allowed(&url, origins) => return Ok(()),
            Ok(_) => return Err("web-origin-denied"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("web-session-unavailable"),
        }
    }
}

fn wait_until_url(
    window: &WebviewWindow,
    expected: &Url,
    cancellation: &AtomicBool,
) -> Result<(), &'static str> {
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            return Err("web-operation-timeout");
        }
        if let Ok(current) = window.url()
            && current.origin() == expected.origin()
            && current.path() == expected.path()
        {
            return Ok(());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_download(
    receiver: &std::sync::mpsc::Receiver<Result<PathBuf, ()>>,
    cancellation: &AtomicBool,
) -> Result<PathBuf, &'static str> {
    let started = Instant::now();
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            return Err("web-operation-timeout");
        }
        match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(Ok(path)) => return Ok(path),
            Ok(Err(())) => return Err("web-download-failed"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("web-download-failed"),
        }
    }
}

fn create_private_directory(path: &Path) -> Result<(), &'static str> {
    fs::create_dir_all(path).map_err(|_| "web-session-unavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "web-session-unavailable")?;
    }
    Ok(())
}

fn current_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(u64::MAX, |duration| duration.as_millis() as u64)
}

#[cfg(test)]
#[path = "agent_managed_web_tests.rs"]
mod tests;
