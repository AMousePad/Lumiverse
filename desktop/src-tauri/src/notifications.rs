//! Durable native-notification enrollment for the hidden desktop tray host.
//!
//! The WebView's cookies are intentionally not part of this path. A per-install
//! device ID and revocable destination credential live in Tauri's app config
//! directory, which remains stable when the application bundle is rebuilt.

use std::{path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{NotificationExt, PermissionState};

const DEVICE_FILE: &str = "desktop_notification_device.json";
const ENROLLMENT_FILE: &str = "desktop_notification_enrollment.json";
const ENROLLMENT_CHANGED_EVENT: &str = "desktop-notification-enrollment-changed";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNotificationDeviceIdentity {
    device_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationEnrollment {
    device_id: String,
    destination_id: String,
    credential: String,
    server_instance_id: String,
    server_origin: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDesktopNotificationEnrollment {
    device_id: String,
    destination_id: String,
    credential: String,
    server_instance_id: String,
    server_origin: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationEnrollmentSummary {
    destination_id: String,
    server_instance_id: String,
    server_origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationDeviceState {
    device_id: String,
    enrollment: Option<DesktopNotificationEnrollmentSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationPayload {
    title: String,
    body: String,
    tag: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTransportInfo {
    server_instance_id: String,
}

#[derive(Deserialize)]
struct DesktopTicketResponse {
    ticket: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationConnection {
    websocket_url: String,
    destination_id: String,
}

fn app_config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(name))
}

fn write_private_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let contents = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(temporary, path).map_err(|error| error.to_string())
    }
    #[cfg(windows)]
    {
        // Windows rename does not replace an existing destination. Keep a
        // recoverable prior copy so a failed rotation cannot strand this
        // install without its durable identity or enrollment.
        let backup = path.with_extension("json.bak");
        if path.exists() {
            if backup.exists() {
                std::fs::remove_file(&backup).map_err(|error| error.to_string())?;
            }
            std::fs::rename(path, &backup).map_err(|error| error.to_string())?;
        }
        match std::fs::rename(&temporary, path) {
            Ok(()) => {
                if backup.exists() {
                    let _ = std::fs::remove_file(backup);
                }
                Ok(())
            }
            Err(error) => {
                if backup.exists() {
                    let _ = std::fs::rename(backup, path);
                }
                Err(error.to_string())
            }
        }
    }
}

fn load_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Option<T> {
    std::fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .or_else(|| {
            let backup = path.with_extension("json.bak");
            std::fs::read(backup)
                .ok()
                .and_then(|contents| serde_json::from_slice(&contents).ok())
        })
}

fn device_identity(app: &AppHandle) -> Result<DesktopNotificationDeviceIdentity, String> {
    let path = app_config_file(app, DEVICE_FILE)?;
    if let Some(identity) = load_json::<DesktopNotificationDeviceIdentity>(&path) {
        if valid_device_id(&identity.device_id) {
            return Ok(identity);
        }
    }

    let identity = DesktopNotificationDeviceIdentity {
        device_id: uuid::Uuid::new_v4().simple().to_string(),
    };
    write_private_json(&path, &identity)?;
    Ok(identity)
}

fn load_enrollment(app: &AppHandle) -> Result<Option<DesktopNotificationEnrollment>, String> {
    let path = app_config_file(app, ENROLLMENT_FILE)?;
    Ok(load_json(&path))
}

fn valid_device_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn permission_name(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Prompt | PermissionState::PromptWithRationale => "default",
    }
}

fn normalized_base_url(value: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = value
        .parse()
        .map_err(|_| "Invalid notification server URL")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Notification server URL must be an HTTP(S) origin".into());
    }
    let host = parsed.host_str().unwrap_or_default();
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if parsed.scheme() != "https" && !loopback {
        return Err("Remote desktop notification servers must use HTTPS".into());
    }
    let origin = parsed.origin().ascii_serialization();
    origin
        .parse()
        .map_err(|_| "Invalid notification server origin".into())
}

#[tauri::command]
pub fn desktop_notification_device(
    app: AppHandle,
) -> Result<DesktopNotificationDeviceState, String> {
    let identity = device_identity(&app)?;
    let enrollment = load_enrollment(&app)?.map(|value| DesktopNotificationEnrollmentSummary {
        destination_id: value.destination_id,
        server_instance_id: value.server_instance_id,
        server_origin: value.server_origin,
    });
    Ok(DesktopNotificationDeviceState {
        device_id: identity.device_id,
        enrollment,
    })
}

#[tauri::command]
pub fn desktop_notification_permission(app: AppHandle, request: bool) -> Result<String, String> {
    let notifications = app.notification();
    let mut state = notifications
        .permission_state()
        .map_err(|error| error.to_string())?;
    if request
        && matches!(
            state,
            PermissionState::Prompt | PermissionState::PromptWithRationale
        )
    {
        state = notifications
            .request_permission()
            .map_err(|error| error.to_string())?;
    }
    Ok(permission_name(state).into())
}

#[tauri::command]
pub fn save_desktop_notification_enrollment(
    app: AppHandle,
    enrollment: SaveDesktopNotificationEnrollment,
) -> Result<(), String> {
    let identity = device_identity(&app)?;
    if enrollment.device_id != identity.device_id || !valid_device_id(&enrollment.device_id) {
        return Err("Desktop notification device identity does not match this install".into());
    }
    if !valid_identifier(&enrollment.destination_id)
        || !valid_identifier(&enrollment.server_instance_id)
        || !enrollment.credential.starts_with("lvd_")
        || enrollment.credential.len() > 160
    {
        return Err("Invalid desktop notification enrollment".into());
    }
    let server_origin = normalized_base_url(&enrollment.server_origin)?
        .origin()
        .ascii_serialization();

    let stored = DesktopNotificationEnrollment {
        device_id: enrollment.device_id,
        destination_id: enrollment.destination_id,
        credential: enrollment.credential,
        server_instance_id: enrollment.server_instance_id,
        server_origin,
    };
    let path = app_config_file(&app, ENROLLMENT_FILE)?;
    write_private_json(&path, &stored)?;
    app.emit_to(
        "main",
        ENROLLMENT_CHANGED_EVENT,
        DesktopNotificationEnrollmentSummary {
            destination_id: stored.destination_id,
            server_instance_id: stored.server_instance_id,
            server_origin: stored.server_origin,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_desktop_notification_enrollment(
    app: AppHandle,
    destination_id: Option<String>,
) -> Result<bool, String> {
    let Some(enrollment) = load_enrollment(&app)? else {
        return Ok(false);
    };
    if destination_id
        .as_deref()
        .is_some_and(|id| id != enrollment.destination_id)
    {
        return Ok(false);
    }
    let path = app_config_file(&app, ENROLLMENT_FILE)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    app.emit_to("main", ENROLLMENT_CHANGED_EVENT, serde_json::Value::Null)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

/// Exchange the private on-disk credential for a short-lived, notification-only
/// WebSocket ticket. The credential never enters the bundled tray JavaScript.
#[tauri::command]
pub async fn desktop_notification_connection(
    app: AppHandle,
    base_url: String,
) -> Result<DesktopNotificationConnection, String> {
    let enrollment = load_enrollment(&app)?.ok_or("Desktop notifications are not enrolled")?;
    let base = normalized_base_url(&base_url)?;
    if base.origin().ascii_serialization() != enrollment.server_origin {
        return Err("Desktop notification enrollment belongs to a different server origin".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;

    let info_url = base
        .join("/api/desktop-notifications/v1/info")
        .map_err(|error| error.to_string())?;
    let info_response = client
        .get(info_url)
        .send()
        .await
        .map_err(|error| format!("Could not reach notification server: {error}"))?;
    if !info_response.status().is_success() {
        return Err(format!(
            "Notification server identity check failed ({})",
            info_response.status()
        ));
    }
    let info: DesktopTransportInfo = info_response
        .json()
        .await
        .map_err(|error| format!("Invalid notification server identity: {error}"))?;
    if info.server_instance_id != enrollment.server_instance_id {
        return Err(
            "Desktop notification enrollment belongs to a different server instance".into(),
        );
    }

    let ticket_url = base
        .join("/api/desktop-notifications/v1/ticket")
        .map_err(|error| error.to_string())?;
    let ticket_response = client
        .post(ticket_url)
        .bearer_auth(&enrollment.credential)
        .send()
        .await
        .map_err(|error| format!("Could not request notification ticket: {error}"))?;
    if !ticket_response.status().is_success() {
        return Err(
            if ticket_response.status() == reqwest::StatusCode::UNAUTHORIZED {
                "Desktop notification enrollment is no longer valid".into()
            } else {
                format!(
                    "Notification ticket request failed ({})",
                    ticket_response.status()
                )
            },
        );
    }
    let ticket: DesktopTicketResponse = ticket_response
        .json()
        .await
        .map_err(|error| format!("Invalid notification ticket response: {error}"))?;

    let mut websocket_url = base;
    websocket_url
        .set_scheme(if websocket_url.scheme() == "https" {
            "wss"
        } else {
            "ws"
        })
        .map_err(|_| "Could not build notification WebSocket URL")?;
    websocket_url.set_path("/api/ws");
    websocket_url.set_query(None);
    websocket_url
        .query_pairs_mut()
        .append_pair("notificationTicket", &ticket.ticket);

    Ok(DesktopNotificationConnection {
        websocket_url: websocket_url.into(),
        destination_id: enrollment.destination_id,
    })
}

#[tauri::command]
pub fn show_desktop_notification(
    app: AppHandle,
    payload: DesktopNotificationPayload,
) -> Result<(), String> {
    let title = payload.title.trim();
    let body = payload.body.trim();
    if title.is_empty() || title.chars().count() > 100 || body.chars().count() > 500 {
        return Err("Invalid desktop notification payload".into());
    }
    if payload.tag.as_deref().is_some_and(|tag| tag.len() > 160) {
        return Err("Invalid desktop notification tag".into());
    }

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}
