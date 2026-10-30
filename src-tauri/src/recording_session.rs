use crate::{
    Recorder,
    recording::RecordingOptions,
    recording_tray::{self, Phase},
};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::{Condvar, Mutex},
};
use tauri::{Emitter, Manager};

pub(crate) struct RecordingSession {
    phase: Mutex<Phase>,
    wake: Condvar,
}
impl Default for RecordingSession {
    fn default() -> Self {
        Self {
            phase: Mutex::new(Phase::Idle),
            wake: Condvar::new(),
        }
    }
}

fn set_phase(app: &tauri::AppHandle, phase: Phase) {
    let state = app.state::<RecordingSession>();
    *state.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
    state.wake.notify_all();
    recording_tray::update(app, phase);
}
pub(crate) fn begin(app: &tauri::AppHandle) {
    set_phase(app, Phase::Starting);
}
pub(crate) fn finish(app: &tauri::AppHandle) {
    set_phase(app, Phase::Idle);
}
pub(crate) fn is_stopping(app: &tauri::AppHandle) -> bool {
    *app.state::<RecordingSession>()
        .phase
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        == Phase::Stopping
}
pub(crate) fn started(app: &tauri::AppHandle, resumed: bool) {
    if !is_stopping(app) {
        set_phase(app, Phase::Recording);
    }
    if let Some(camera) = app.get_webview_window(crate::camera_preview::LABEL) {
        let _ = camera.hide();
    }
    let _ = app.emit(
        if resumed {
            "recording-resumed"
        } else {
            "recording-started"
        },
        (),
    );
}

pub(crate) fn toggle_pause(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<RecordingSession>();
    let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
    match *phase {
        Phase::Recording => {
            let recorder = app.state::<Recorder>();
            let mut pipe = recorder.control.lock().map_err(|e| e.to_string())?;
            let pipe = pipe
                .as_mut()
                .ok_or("A captura ainda não está pronta para pausar.")?;
            pipe.write_all(b"stop\n").map_err(|e| e.to_string())?;
            *phase = Phase::Pausing;
            drop(phase);
            recording_tray::update(app, Phase::Pausing);
            let _ = app.emit("recording-pausing", ());
        }
        Phase::Paused => {
            *phase = Phase::Starting;
            state.wake.notify_all();
            drop(phase);
            recording_tray::update(app, Phase::Starting);
            let _ = app.emit("recording-resuming", ());
        }
        _ => return Err("A gravação não pode ser pausada ou retomada neste momento.".into()),
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn toggle_recording_pause(app: tauri::AppHandle) -> Result<(), String> {
    toggle_pause(&app)
}

// Returns false for exports, which use the original helper control pipe.
pub(crate) fn stop(app: &tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<RecordingSession>();
    let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *phase == Phase::Idle {
        return Ok(false);
    }
    *phase = Phase::Stopping;
    state.wake.notify_all();
    drop(phase);
    recording_tray::update(app, Phase::Stopping);
    if let Some(pipe) = app
        .state::<Recorder>()
        .control
        .lock()
        .map_err(|e| e.to_string())?
        .as_mut()
    {
        pipe.write_all(b"stop\n").map_err(|e| e.to_string())?;
    }
    let _ = app.emit("recording-stopping", ());
    Ok(true)
}

fn wait_for_resume(app: &tauri::AppHandle) -> bool {
    let state = app.state::<RecordingSession>();
    let mut phase = state.phase.lock().unwrap_or_else(|e| e.into_inner());
    if *phase != Phase::Pausing {
        return false;
    }
    *phase = Phase::Paused;
    drop(phase);
    recording_tray::update(app, Phase::Paused);
    let _ = app.emit("recording-paused", ());
    let mut phase = state.phase.lock().unwrap_or_else(|e| e.into_inner());
    while *phase == Phase::Paused {
        phase = state.wake.wait(phase).unwrap_or_else(|e| e.into_inner());
    }
    *phase == Phase::Starting
}

pub(crate) fn capture(
    app: &tauri::AppHandle,
    destination: &Path,
    webcam: Option<&Path>,
    audio: (bool, bool),
    options: &RecordingOptions,
) -> Result<Value, String> {
    let folder = destination
        .parent()
        .ok_or("Pasta de gravação inválida.")?
        .join(".parts");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut parts = Vec::new();
    let mut camera_parts = Vec::new();
    let mut microphone_parts = Vec::new();
    let mut cursor = Vec::new();
    let mut elapsed = 0.;
    loop {
        if is_stopping(app) && !parts.is_empty() {
            break;
        }
        let index = parts.len();
        let path = folder.join(format!("part-{index:04}.mov"));
        let camera = webcam.map(|_| folder.join(format!("camera-{index:04}.mov")));
        let value = crate::studio::run_native_operation(
            app,
            "record",
            &path,
            camera.as_deref(),
            audio,
            Some(options),
            elapsed,
            index > 0,
        )?;
        let duration = value["media"]["duration"]
            .as_f64()
            .filter(|n| n.is_finite() && *n > 0.)
            .ok_or("Trecho de gravação sem duração.")?;
        parts.push(json!({ "path":path, "duration":duration }));
        if let Some(camera) = camera {
            camera_parts.push(json!({ "path":camera, "duration":duration }));
        }
        if audio.1 {
            microphone_parts
                .push(json!({ "path":path.with_extension("microphone.m4a"), "duration":duration }));
        }
        if let Ok(bytes) = fs::read(path.with_extension("cursor.json")) {
            let points: Vec<Value> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            cursor.extend(offset_cursor(points, elapsed, duration));
        }
        elapsed += duration;
        let _ = app.emit("recording-time", json!({"seconds":elapsed}));
        if !wait_for_resume(app) {
            break;
        }
    }
    recording_tray::update(app, Phase::Stopping);
    let _ = app.emit("recording-stopping", ());
    stitch(
        app,
        &folder,
        "screen",
        &parts,
        destination,
        false,
        options.fps,
    )?;
    if let Some(webcam) = webcam {
        stitch(
            app,
            &folder,
            "camera",
            &camera_parts,
            webcam,
            false,
            options.fps,
        )?;
    }
    if audio.1 {
        stitch(
            app,
            &folder,
            "microphone",
            &microphone_parts,
            &destination.with_extension("microphone.m4a"),
            true,
            None,
        )?;
    }
    fs::write(
        destination.with_extension("cursor.json"),
        serde_json::to_vec(&cursor).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Parts remain recoverable until all final tracks have been written successfully.
    fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(json!({"event":"media"}))
}

fn stitch(
    app: &tauri::AppHandle,
    folder: &Path,
    name: &str,
    parts: &[Value],
    destination: &Path,
    audio_only: bool,
    fps: Option<u32>,
) -> Result<(), String> {
    if parts.len() == 1 {
        let source = parts[0]["path"]
            .as_str()
            .ok_or("Caminho do trecho inválido.")?;
        return fs::copy(source, destination)
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    let job = folder.join(format!("stitch-{name}.json"));
    fs::write(
        &job,
        serde_json::to_vec(
            &json!({"segments":parts,"destination":destination,"audioOnly":audio_only,"fps":fps}),
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    crate::studio::run(
        app,
        &["concat", job.to_str().ok_or("Caminho de união inválido.")?],
    )
    .map(|_| ())
}

fn offset_cursor(points: Vec<Value>, offset: f64, duration: f64) -> Vec<Value> {
    points
        .into_iter()
        .filter_map(|mut point| {
            let time = point["t"]
                .as_f64()
                .filter(|t| t.is_finite() && *t >= 0. && *t <= duration)?;
            point["t"] = json!(time + offset);
            Some(point)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_segments_exclude_pause_wall_time_and_invalid_points() {
        let points = vec![
            json!({"t":0.,"x":0.2}),
            json!({"t":0.75,"x":0.3}),
            json!({"t":2.}),
        ];
        let joined = offset_cursor(points, 4., 1.);
        assert_eq!(joined.len(), 2);
        assert_eq!(joined[0]["t"], 4.);
        assert_eq!(joined[1]["t"], 4.75);
        assert_eq!(joined[1]["x"], 0.3);
    }
}
