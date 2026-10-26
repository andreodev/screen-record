use std::{io::{BufRead, BufReader, Write}, process::{ChildStdin, Stdio}, sync::{Mutex, atomic::{AtomicBool, Ordering}}};
use serde_json::{Value, json};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use crate::{Recorder, studio};

pub(crate) const LABEL: &str = "camera-preview";
pub(crate) const TITLE: &str = "Frame Studio — Webcam";
#[derive(Default)]
pub(crate) struct CameraPreview {
    commands: Mutex<()>, control: Mutex<Option<ChildStdin>>, running: AtomicBool,
    frame: Mutex<Option<String>>, error: Mutex<Option<String>>, device: Mutex<String>,
    position: Mutex<Option<PhysicalPosition<i32>>>, pub recording: AtomicBool,
}
pub(crate) fn show(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) { return window.show().map_err(|e| e.to_string()); }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title(TITLE).inner_size(280., 230.).min_inner_size(200., 180.).max_inner_size(640., 520.)
        .decorations(false).always_on_top(true).visible_on_all_workspaces(true).skip_taskbar(true)
        .content_protected(true).resizable(true).focused(false).accept_first_mouse(true).build().map_err(|e| e.to_string())?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if crate::benchmark::config()?.is_some_and(|c| c["mode"] == "floating-preview" && c["testUnprotected"] == true) { window.set_content_protected(false).map_err(|e| e.to_string())?; }
    #[cfg(windows)] {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
        let mut affinity = 0;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        if unsafe { GetWindowDisplayAffinity(hwnd.0 as _, &mut affinity) } == 0 || affinity != WDA_EXCLUDEFROMCAPTURE {
            let _ = window.destroy(); return Err("O Windows não conseguiu excluir a prévia da captura.".into());
        }
    }
    let saved = *app.state::<CameraPreview>().position.lock().map_err(|e| e.to_string())?;
    if let Some(position) = saved.filter(|p| window.available_monitors().is_ok_and(|monitors| monitors.iter().any(|m| p.x >= m.position().x && p.y >= m.position().y && p.x + 200 < m.position().x + m.size().width as i32 && p.y + 180 < m.position().y + m.size().height as i32))) {
        window.set_position(position).map_err(|e| e.to_string())?;
    } else if let Some(main) = app.get_webview_window("main") {
        if let (Ok(position), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
            let _ = window.set_position(PhysicalPosition::new(position.x + (24. * scale) as i32, position.y + (60. * scale) as i32));
        }
    }
    Ok(())
}
pub(crate) fn frame(app: &tauri::AppHandle, value: &Value) {
    if let Some(data) = value.as_str().filter(|s| s.len() <= 4_000_000) {
        if let Ok(mut last) = app.state::<CameraPreview>().frame.lock() { *last = Some(data.into()); }
        if let Some(window) = app.get_webview_window(LABEL) { let _ = window.emit("camera-preview-frame", data); }
    }
}
fn error(app: &tauri::AppHandle, message: &str) {
    if let Ok(mut value) = app.state::<CameraPreview>().error.lock() { *value = Some(message.into()); }
    let _ = app.emit("camera-preview-error", message);
}
pub(crate) fn stop_stream(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CameraPreview>();
    if let Some(mut pipe) = state.control.lock().map_err(|e| e.to_string())?.take() { let _ = pipe.write_all(b"stop\n"); }
    for _ in 0..300 {
        if !state.running.load(Ordering::SeqCst) { return Ok(()); }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Err("A câmera ainda está sendo liberada. Tente novamente em um instante.".into())
}
pub(crate) fn close(app: &tauri::AppHandle) {
    let state = app.state::<CameraPreview>();
    let was_recording = state.recording.swap(false, Ordering::SeqCst);
    let mut was_open = false;
    if let Some(window) = app.get_webview_window(LABEL) {
        was_open = true;
        if !app.state::<Recorder>().exit_after_operation.load(Ordering::SeqCst) {
            if let (Ok(position), Ok(mut saved)) = (window.outer_position(), state.position.lock()) { *saved = Some(position); }
            let _ = window.destroy();
        }
    }
    if let Ok(mut frame) = state.frame.lock() { frame.take(); }
    if was_open || was_recording { let _ = app.emit("camera-preview-closed", ()); }
}
pub(crate) fn prepare_recording(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<CameraPreview>(); let _guard = state.commands.lock().map_err(|e| e.to_string())?;
    stop_stream(app)?;
    if enabled { show(app)?; state.recording.store(true, Ordering::SeqCst); let _ = app.emit("camera-preview-recording", true); }
    else { close(app); }
    Ok(())
}
#[tauri::command]
pub(crate) fn camera_preview_snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<CameraPreview>();
    Ok(json!({"frame": *state.frame.lock().map_err(|e| e.to_string())?, "error": *state.error.lock().map_err(|e| e.to_string())?, "deviceId": *state.device.lock().map_err(|e| e.to_string())?, "recording": state.recording.load(Ordering::SeqCst)}))
}
#[tauri::command]
pub(crate) async fn start_camera_preview(app: tauri::AppHandle, device_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CameraPreview>(); let _guard = state.commands.lock().map_err(|e| e.to_string())?;
        if app.state::<Recorder>().exit_after_operation.load(Ordering::SeqCst) { return Err("O aplicativo está encerrando.".into()); }
        if app.state::<Recorder>().busy.load(Ordering::SeqCst) { return Err("Troque a câmera depois de terminar a gravação.".into()); }
        let device = device_id.unwrap_or_default();
        if device.len() > 4096 || device.contains('\0') { return Err("Dispositivo de câmera inválido.".into()); }
        if state.running.load(Ordering::SeqCst) && *state.device.lock().map_err(|e| e.to_string())? == device { return show(&app); }
        stop_stream(&app)?; show(&app)?;
        *state.error.lock().map_err(|e| e.to_string())? = None;
        *state.frame.lock().map_err(|e| e.to_string())? = None;
        *state.device.lock().map_err(|e| e.to_string())? = device.clone();
        let _ = app.emit("camera-preview-device", &device);
        let _ = app.emit("camera-preview-reset", ());
        #[cfg(debug_assertions)]
        if crate::benchmark::config()?.is_some_and(|c| c["mode"] == "floating-preview" && c["synthetic"] == true) { return Ok(()); }
        let mut command = studio::helper_command(&app)?;
        command.arg("camera-preview"); if !device.is_empty() { command.arg(device); }
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| { error(&app, &e.to_string()); e.to_string() })?;
        let stdout = child.stdout.take().ok_or("Não foi possível ler a prévia da câmera.")?;
        *state.control.lock().map_err(|e| e.to_string())? = child.stdin.take(); state.running.store(true, Ordering::SeqCst);
        let worker_app = app.clone();
        std::thread::spawn(move || {
            let app = worker_app;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    match value["event"].as_str() {
                        Some("camera-frame") => frame(&app, &value["data"]),
                        Some("error") => error(&app, value["message"].as_str().unwrap_or("Falha ao iniciar a webcam.")),
                        _ => {}
                    }
                }
            }
            let status = child.wait();
            let state = app.state::<CameraPreview>();
            if (status.is_err() || status.is_ok_and(|s| !s.success())) && state.error.lock().is_ok_and(|e| e.is_none()) { error(&app, "A webcam foi interrompida. Verifique a câmera e tente novamente."); }
            if let Ok(mut control) = state.control.lock() { control.take(); }
            state.running.store(false, Ordering::SeqCst);
        });
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn stop_camera_preview(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CameraPreview>(); let _guard = state.commands.lock().map_err(|e| e.to_string())?;
        if state.recording.load(Ordering::SeqCst) { return Err("Pare a gravação antes de fechar a webcam.".into()); }
        stop_stream(&app)?; close(&app); Ok(())
    }).await.map_err(|e| e.to_string())?
}
