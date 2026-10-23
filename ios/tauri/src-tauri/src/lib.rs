mod client;

use std::sync::Mutex;
use tauri::{Manager, State, Url, WebviewWindow};

#[derive(Default)]
struct ConnectionState {
    server: Mutex<Option<Url>>,
    connect: tokio::sync::Mutex<()>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInfo {
    server: Option<String>,
    #[serde(default)]
    allow_insecure_http: bool,
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|path| path.join("connection.json")).map_err(|error| error.to_string())
}

fn saved_connection(app: &tauri::AppHandle) -> Option<ConnectionInfo> {
    std::fs::read(settings_path(app).ok()?).ok()
        .and_then(|bytes| serde_json::from_slice::<ConnectionInfo>(&bytes).ok())
        .and_then(|saved| {
            let server = client::normalize_server(saved.server.as_deref()?, saved.allow_insecure_http).ok()?;
            Some(ConnectionInfo { allow_insecure_http: server.scheme() == "http" && saved.allow_insecure_http,
                server: Some(server.as_str().into()) })
        })
}

fn require_connection_page(window: &WebviewWindow) -> Result<(), String> {
    if client::is_connection_page(&window.url().map_err(|error| error.to_string())?) { Ok(()) }
    else { Err("Only the packaged connection screen can change servers.".into()) }
}

#[tauri::command]
fn mobile_connection_info(window: WebviewWindow, app: tauri::AppHandle) -> Result<ConnectionInfo, String> {
    require_connection_page(&window)?;
    Ok(saved_connection(&app).unwrap_or(ConnectionInfo { server: None, allow_insecure_http: false }))
}

#[tauri::command]
async fn mobile_connect(window: WebviewWindow, app: tauri::AppHandle, state: State<'_, ConnectionState>, server: String, restore: Option<bool>, allow_insecure_http: Option<bool>) -> Result<(), String> {
    require_connection_page(&window)?;
    let _connection = state.connect.lock().await;
    require_connection_page(&window)?;
    let server = client::normalize_server(&server, allow_insecure_http == Some(true))?;
    // Only the address already accepted and saved by this app may skip its
    // network probe. New addresses still have to identify a Lumiverse server.
    let restoring = restore == Some(true) && saved_connection(&app).and_then(|saved| saved.server).as_deref() == Some(server.as_str());
    let cached = tauri_plugin_lumiverse_ios::cache_available(&app).await;
    if !restoring || !cached { tauri_plugin_lumiverse_ios::probe_server(&app, server.as_str()).await?; }
    // The saved address is separate from the server's cookies and account data.
    let path = settings_path(&app)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|error| error.to_string())?;
    let pending = path.with_extension("pending");
    let bytes = serde_json::to_vec(&ConnectionInfo { server: Some(server.as_str().into()),
        allow_insecure_http: server.scheme() == "http" && allow_insecure_http == Some(true) }).unwrap();
    std::fs::write(&pending, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(pending, path).map_err(|error| error.to_string())?;
    *state.server.lock().unwrap() = Some(server.clone());
    if cached && tauri_plugin_lumiverse_ios::load_cached(&app, server.as_str()).await { return Ok(()); }
    if restoring && cached { tauri_plugin_lumiverse_ios::probe_server(&app, server.as_str()).await?; }
    window.navigate(server).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // A packaged diagnostic page avoids changing the saved server or cookies.
    #[cfg(debug_assertions)]
    if std::env::args().any(|arg| arg == "--lumiverse-frame-pacing-probe") {
        context.config_mut().app.windows[0].url = tauri::WebviewUrl::App("frame-pacing.html".into());
    }
    tauri::Builder::default()
        .manage(ConnectionState::default())
        .plugin(tauri_plugin_lumiverse_ios::init())
        .invoke_handler(tauri::generate_handler![mobile_connection_info, mobile_connect])
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("connection-policy").on_navigation(|webview, url| {
            let state = webview.state::<ConnectionState>();
            let server = state.server.lock().unwrap();
            client::navigation_allowed(url, server.as_ref())
        }).build())
        .run(context)
        .expect("Failed to run Lumiverse iOS client");
}
