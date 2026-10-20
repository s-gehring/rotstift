use std::path::Path;

fn main() {
    let stamp = Path::new("binaries").join("runtime.json");
    println!("cargo:rerun-if-changed={}", stamp.display());
    let target = std::env::var("TARGET").expect("cargo sets TARGET for build scripts");
    let stamp_json = std::fs::read_to_string(&stamp)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let fetched = stamp_json
        .as_ref()
        .and_then(|stamp| stamp["target"].as_str().map(str::to_owned));
    let version = stamp_json
        .as_ref()
        .and_then(|stamp| stamp["version"].as_str())
        .unwrap_or("unknown");
    println!("cargo:rustc-env=ROTSTIFT_RUNTIME_VERSION={version}");
    if fetched.as_deref() != Some(target.as_str()) {
        panic!(
            "src-tauri/binaries holds the llama.cpp runtime for {}, not {target}. Run `pnpm fetch:runtime --target {target}`.",
            fetched.as_deref().unwrap_or("no target")
        );
    }
    tauri_build::build()
}
