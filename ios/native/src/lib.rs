use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "ios")]
use tauri::Manager;

#[cfg(target_os = "ios")]
struct NativeHandle<R: tauri::Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_lumiverse_ios);

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::new("lumiverse-ios")
        .js_init_script(include_str!("mobile-init.js"))
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_lumiverse_ios)?;
                _app.manage(NativeHandle(handle));
            }
            Ok(())
        })
        .on_event(|_app, _event| {
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let app = _app.clone();
                let urls = urls.clone();
                tauri::async_runtime::spawn(async move {
                    for url in urls {
                        if url.scheme() == "lumiverse" && url.host_str() == Some("activity") {
                            let _ = app.state::<NativeHandle<R>>().0.run_mobile_plugin_async::<bool>(
                                "openActivityURL", std::collections::BTreeMap::from([("url", url.as_str())]),
                            ).await;
                        }
                    }
                });
            }
        })
        .build()
}

/// Internal Rust-to-Swift calls; these are not commands exposed to remote pages.
pub async fn cache_available<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> bool {
    #[cfg(target_os = "ios")]
    return _app.state::<NativeHandle<R>>().0
        .run_mobile_plugin_async::<bool>("cacheAvailable", ()).await.unwrap_or(false);
    #[cfg(not(target_os = "ios"))]
    false
}

pub async fn load_cached<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, _server: &str) -> bool {
    #[cfg(target_os = "ios")]
    return _app.state::<NativeHandle<R>>().0.run_mobile_plugin_async::<bool>(
        "loadCached", std::collections::BTreeMap::from([("server", _server)]),
    ).await.unwrap_or(false);
    #[cfg(not(target_os = "ios"))]
    false
}
