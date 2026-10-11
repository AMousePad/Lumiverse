//! Native adapter behind `ctx.systemAudio` (the Spindle `system_audio` permission).
//!
//! What crosses IPC, and what does not:
//! - **Out of native code:** analysis frames only (a level, a peak and 64 log-spaced bands), as raw little-endian
//!   `f32`s over a Tauri channel. Samples, device names and file paths never leave the capture thread.
//! - **Into native code:** "start at N fps" and "stop". Nothing the page sends can choose a device or a format.
//!
//! The guarantee that listening is never silent lives here, not in the page. Extension code shares the frontend's
//! JavaScript realm, so the web layer's per-start prompt is a courtesy it cannot enforce against a forged call. Native
//! code therefore requires the owner to switch the feature on in the tray (off by default), and the tray shows
//! whenever a session is running. Sessions also end on lock, suspend, owner stop, and when the page reloads, closes
//! or stops listening.
//!
//! Only the primary `frontend` window may start or stop a session; only the bundled tray host may flip the switch.
//! The floating-widget windows get no grant at all.

mod analyzer;
#[cfg(target_os = "macos")]
mod coreaudio;
mod engine;
#[cfg(any(target_os = "linux", test))]
mod pipe;
#[cfg(target_os = "linux")]
mod pulse;
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod wasapi;

#[cfg(target_os = "macos")]
use coreaudio as platform;
#[cfg(target_os = "linux")]
use pulse as platform;
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
use unsupported as platform;
#[cfg(target_os = "windows")]
use wasapi as platform;

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use analyzer::{Frame, KIND_FRAME, KIND_HOST_DISABLED, KIND_SOURCE_LOST};
use serde::Serialize;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, Runtime, State, WebviewWindow,
};

const FRONTEND: &str = "frontend";
const TRAY: &str = "main";
const STATE_EVENT: &str = "desktop-system-audio-state";
const MAX_FPS: u32 = 30;

type Events = Channel<InvokeResponseBody>;

struct Session {
    id: u64,
    capture: platform::Capture,
    events: Events,
}

struct Inner {
    enabled: bool,
    session: Option<Session>,
}

pub struct SystemAudioState {
    inner: Mutex<Inner>,
    next_id: AtomicU64,
    /// True while the frontend window is hidden or minimised; capture threads read it to skip all analysis.
    paused: Arc<AtomicBool>,
}

impl Default for SystemAudioState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                enabled: false,
                session: None,
            }),
            next_id: AtomicU64::new(0),
            paused: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// This build can hear the device's output at all.
    supported: bool,
    /// The owner has switched the feature on in the tray.
    enabled: bool,
    /// A session is running right now.
    active: bool,
}

fn status_of(inner: &Inner) -> Status {
    Status {
        supported: platform::supported(),
        enabled: inner.enabled,
        active: inner.session.is_some(),
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>, status: &Status) {
    for label in [TRAY, FRONTEND] {
        let _ = app.emit_to(label, STATE_EVENT, status.clone());
    }
}

fn lock(state: &SystemAudioState) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
    state
        .inner
        .lock()
        .map_err(|_| "System audio state is unavailable".to_string())
}

/// Stop the running session, if any. `farewell` is told to the page first (the page ends its own side on receipt).
fn end_session(inner: &mut Inner, farewell: Option<f32>) {
    if let Some(session) = inner.session.take() {
        session.capture.stop();
        if let Some(kind) = farewell {
            let _ = session
                .events
                .send(InvokeResponseBody::Raw(Frame::default().encode(kind)));
        }
    }
}

fn require_frontend(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == FRONTEND {
        Ok(())
    } else {
        Err("Only the primary frontend can analyse system audio".into())
    }
}

/// Readable by the frontend (to answer `isAvailable()` without prompting) and by the tray.
#[tauri::command]
pub fn desktop_system_audio_status(state: State<'_, SystemAudioState>) -> Result<Status, String> {
    Ok(status_of(&*lock(&state)?))
}

/// The owner's switch. Tray host only, and off at every launch until the tray restores a saved choice.
#[tauri::command]
pub fn desktop_system_audio_set_enabled(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SystemAudioState>,
    enabled: bool,
) -> Result<(), String> {
    crate::capture::trusted_host(&window)
        .map_err(|_| "System audio controls require the bundled tray host".to_string())?;
    if enabled && !platform::supported() {
        return Err("System audio analysis is not available on this OS yet".into());
    }
    let status = {
        let mut inner = lock(&state)?;
        inner.enabled = enabled;
        if !enabled {
            end_session(&mut inner, Some(KIND_HOST_DISABLED));
        }
        status_of(&inner)
    };
    publish(&app, &status);
    Ok(())
}

/// Begin analysing at `max_fps` (1 – 30). Replaces any session an earlier page load left behind. The web layer has
/// already asked the user; this refuses unless the owner has also switched the feature on in the tray.
#[tauri::command]
pub async fn desktop_system_audio_start(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SystemAudioState>,
    events: Events,
    max_fps: u32,
) -> Result<(), String> {
    require_frontend(&window)?;
    {
        let mut inner = lock(&state)?;
        if !inner.enabled {
            return Err("System audio is turned off in the Lumiverse desktop client".into());
        }
        end_session(&mut inner, None);
    }
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    state.paused.store(
        !(window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)),
        Ordering::Relaxed,
    );

    let options = platform::Options::new(
        Duration::from_secs_f64(1.0 / f64::from(max_fps.clamp(1, MAX_FPS))),
        state.paused.clone(),
    );
    let ended = Arc::new(AtomicBool::new(false));
    let (frames, farewell, done, notify) =
        (events.clone(), events.clone(), ended.clone(), app.clone());
    let capture = tauri::async_runtime::spawn_blocking(move || {
        platform::start(
            options,
            move |frame| {
                frames
                    .send(InvokeResponseBody::Raw(frame.encode(KIND_FRAME)))
                    .is_ok()
            },
            move |exit| {
                done.store(true, Ordering::SeqCst);
                finished(&notify, id, exit, &farewell);
            },
        )
    })
    .await
    .map_err(|_| "The system audio thread failed".to_string())??;

    let status = {
        let mut inner = lock(&state)?;
        if !inner.enabled {
            // Switched off while the device was opening.
            capture.stop();
            return Err("System audio was turned off".into());
        }
        // A capture that already ended before we got here must not leave a stale "in use" behind.
        if !ended.load(Ordering::SeqCst) {
            inner.session = Some(Session {
                id,
                capture,
                events,
            });
        }
        status_of(&inner)
    };
    publish(&app, &status);
    Ok(())
}

#[tauri::command]
pub fn desktop_system_audio_stop(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SystemAudioState>,
) -> Result<(), String> {
    require_frontend(&window)?;
    let status = {
        let mut inner = lock(&state)?;
        end_session(&mut inner, None);
        status_of(&inner)
    };
    publish(&app, &status);
    Ok(())
}

/// Runs on the capture thread once the device is released. A session that ended because its owner stopped it is
/// already gone from the state, so only a loss the page does not know about is reported.
fn finished<R: Runtime>(app: &AppHandle<R>, id: u64, exit: platform::Exit, events: &Events) {
    let Some(state) = app.try_state::<SystemAudioState>() else {
        return;
    };
    let status = {
        let Ok(mut inner) = state.inner.lock() else {
            return;
        };
        if !matches!(&inner.session, Some(session) if session.id == id) {
            return;
        }
        inner.session = None;
        status_of(&inner)
    };
    if exit == platform::Exit::Lost {
        let _ = events.send(InvokeResponseBody::Raw(
            Frame::default().encode(KIND_SOURCE_LOST),
        ));
    }
    publish(app, &status);
}

/// The frontend window is hidden or minimised (`false`) or visible again (`true`). Capture threads see this on their
/// next wake-up and stop analysing; the session itself stays open.
pub fn frontend_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Some(state) = app.try_state::<SystemAudioState>() {
        state.paused.store(!visible, Ordering::Relaxed);
    }
}

/// The page that owned the session is gone (reload, navigation, window destroyed). Nothing is left to receive frames.
pub fn frontend_gone<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<SystemAudioState>() else {
        return;
    };
    let status = {
        let Ok(mut inner) = state.inner.lock() else {
            return;
        };
        if inner.session.is_none() {
            return;
        }
        end_session(&mut inner, None);
        status_of(&inner)
    };
    publish(app, &status);
}
