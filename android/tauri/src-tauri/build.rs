fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["mobile_host_info", "mobile_connection"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("Tauri mobile build failed");
}
