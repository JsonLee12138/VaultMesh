fn main() {
    println!("cargo:rerun-if-changed=../../../.env");
    load_build_environment();
    tauri_build::build()
}

fn load_build_environment() {
    const ALLOWED: &[&str] = &[
        "VAULTMESH_GOOGLE_OAUTH_CLIENT_ID",
        "VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET",
        "VAULTMESH_MICROSOFT_OAUTH_CLIENT_ID",
        "VAULTMESH_MICROSOFT_OAUTH_TENANT",
        "VAULTMESH_BROWSER_EXTENSION_ID",
    ];
    for key in ALLOWED {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let Ok(contents) = std::fs::read_to_string("../../../.env") else {
        return;
    };
    for line in contents.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        if !ALLOWED.contains(&key) || std::env::var_os(key).is_some() {
            continue;
        }
        let value = value.trim().trim_matches(['\'', '"']);
        if !value.is_empty() && !value.contains(['\r', '\n']) {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}
