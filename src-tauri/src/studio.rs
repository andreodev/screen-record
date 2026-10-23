use std::{hash::{Hash, Hasher}, io::{BufRead, BufReader, Write}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::atomic::Ordering};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use crate::Recorder;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Media {
    path: String, duration: f64, width: u32, height: u32,
    cursor: Vec<Pointer>, cursor_captured: bool, #[serde(default)] has_audio: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")] webcam_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] microphone_path: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pointer { t: f64, x: f64, y: f64, down: bool, #[serde(default, skip_serializing_if = "Option::is_none")] kind: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] right_down: Option<bool>, #[serde(default, skip_serializing_if = "Option::is_none")] middle_down: Option<bool>, #[serde(default, skip_serializing_if = "Option::is_none")] typing: Option<bool> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Appearance { background: usize, padding: f64, radius: f64, shadow: f64, cursor_size: f64, smooth: bool, aspect: String, #[serde(default)] crop_fill: Option<bool>, #[serde(default)] crop_follow_cursor: Option<bool>, #[serde(default)] camera_mode: Option<String>, colors: Option<[String; 2]>, background_mode: Option<String>, cursor_smooth: Option<bool>, wallpaper: Option<String>, cursor_asset: Option<String>, cursor_theme: Option<String>, background_blur: Option<f64>, cursor_motion: Option<String>, camera_spring: Option<bool>, #[serde(default, skip_serializing_if = "Option::is_none")] camera_motion: Option<CameraMotion>, motion_blur: Option<MotionBlur>, #[serde(default)] click_sounds: Option<bool>, #[serde(default)] click_sound_volume: Option<f64> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Zoom { id: String, start: f64, end: f64, x: f64, y: f64, scale: f64, enabled: bool, #[serde(default)] follow: bool, #[serde(default)] instant: bool, #[serde(default)] manual_override: bool }
#[derive(Clone, Serialize, Deserialize)]
struct Trim { start: f64, end: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CameraMotion { style: String, shake: bool, #[serde(default)] webcam_shake: bool, intensity: f64, duration: f64, frequency: f64, spring: bool, damping: f64, blur: bool, blur_intensity: f64, #[serde(default)] impacts: Vec<f64> }
fn valid_camera_motion(motion: &CameraMotion, duration: f64) -> bool {
    ["smooth", "cinematic", "dynamic"].contains(&motion.style.as_str())
        && bounded(motion.intensity, 0., 0.004) && bounded(motion.duration, 0.08, 0.18)
        && bounded(motion.frequency, 8., 16.) && bounded(motion.damping, 0.8, 1.5)
        && bounded(motion.blur_intensity, 0., 0.5) && motion.impacts.len() <= 10000
        && motion.impacts.iter().all(|t| bounded(*t, 0., duration))
}
#[derive(Clone, Serialize, Deserialize)]
struct MotionBlur { cursor: f64, zoom: f64, pan: f64 }
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Clip { start: f64, end: f64, #[serde(skip_serializing_if = "Option::is_none")] speed: Option<f64>, #[serde(skip_serializing_if = "Option::is_none")] hide_cursor: Option<bool>, #[serde(skip_serializing_if = "Option::is_none")] cursor_original: Option<bool> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Effect { id: String, kind: String, start: f64, end: f64, x: f64, y: f64, width: f64, height: f64, opacity: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundAudio { path: String, volume: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Webcam { #[serde(default, skip_serializing_if = "Option::is_none")] zoom_behavior: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] zoom_size: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] transition_duration: Option<f64>, path: String, x: f64, y: f64, size: f64, shape: String, #[serde(default, skip_serializing_if = "Vec::is_empty")] keyframes: Vec<WebcamKeyframe>, #[serde(default, skip_serializing_if = "Option::is_none")] mode: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] opacity: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] border: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] shadow: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] border_radius: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] layouts: Option<WebcamLayouts> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebcamKeyframe { t: f64, x: f64, y: f64, size: f64, #[serde(default, skip_serializing_if = "Option::is_none")] opacity: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] border_radius: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] easing: Option<String> }
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WebcamLayout { #[serde(default, skip_serializing_if = "Option::is_none")] zoom_behavior: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] zoom_size: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] transition_duration: Option<f64>, x: Option<f64>, y: Option<f64>, size: Option<f64>, shape: Option<String>, opacity: Option<f64>, border: Option<f64>, shadow: Option<f64>, border_radius: Option<f64>, mode: Option<String>, #[serde(default)] keyframes: Vec<WebcamKeyframe> }
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WebcamLayouts { portrait: Option<WebcamLayout>, landscape: Option<WebcamLayout> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Project { version: u32, media_path: String, name: String, zooms: Vec<Zoom>, appearance: Appearance, trim: Trim, #[serde(default, skip_serializing_if = "Option::is_none")] clips: Option<Vec<Clip>>, #[serde(default, skip_serializing_if = "Option::is_none")] effects: Option<Vec<Effect>>, #[serde(default, skip_serializing_if = "Option::is_none")] background_audio: Option<BackgroundAudio>, #[serde(default, skip_serializing_if = "Option::is_none")] microphone: Option<BackgroundAudio>, #[serde(default, skip_serializing_if = "Option::is_none")] source_volume: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] webcam: Option<Webcam> }
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Key { t: f64, x: f64, y: f64, scale: f64, #[serde(default)] cut: bool }
#[derive(Deserialize)]
pub(crate) struct ExportSettings { start: f64, end: f64, #[serde(default)] ranges: Option<Vec<Clip>>, #[serde(default)] effects: Vec<Effect>, #[serde(default, rename = "backgroundAudio")] background_audio: Option<BackgroundAudio>, #[serde(default)] microphone: Option<BackgroundAudio>, #[serde(default, rename = "sourceVolume")] source_volume: Option<f64>, #[serde(default)] webcam: Option<Webcam>, appearance: Appearance, keys: Vec<Key>, cursor: Vec<Pointer>, #[serde(default, rename = "rawCursor")] raw_cursor: Vec<Pointer>, #[serde(default = "default_resolution")] resolution: u32, #[serde(default = "default_fps")] fps: u32 }
fn default_resolution() -> u32 { 1080 }
fn default_fps() -> u32 { 30 }
fn validate_export_format(resolution: u32, fps: u32) -> Result<(), String> {
    if ![480, 720, 1080, 1440, 2160].contains(&resolution) || ![24, 30, 60].contains(&fps) { return Err("Resolução ou taxa de quadros inválida.".into()); }
    Ok(())
}

fn helper(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(windows)]
    { let _ = app; return std::env::current_exe().map_err(|e| e.to_string()); }
    #[cfg(not(windows))]
    {
    if !cfg!(target_os = "macos") { return Err("O motor nativo está disponível no macOS.".into()); }
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("FrameNative.app/Contents/MacOS/frame-native");
    if bundled.is_file() { return Ok(bundled); }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    { let development = PathBuf::from(env!("FRAME_NATIVE_HELPER")); if development.is_file() { return Ok(development); } }
    Err("Motor nativo não encontrado. Recompile o aplicativo.".into())
    }
}
fn helper_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let mut command = Command::new(helper(app)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.arg("--media-helper").creation_flags(0x08000000);
        command.env("FRAME_RESOURCES", app.path().resource_dir().map_err(|e| e.to_string())?);
    }
    Ok(command)
}
fn asset_catalog() -> Value { serde_json::from_str(include_str!("../resources/studio-assets/catalog.json")).expect("Bundled asset catalog is valid") }
fn asset_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("studio-assets");
    if bundled.join("catalog.json").is_file() { return bundled.canonicalize().map_err(|e| e.to_string()); }
    #[cfg(debug_assertions)]
    { let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/studio-assets"); if development.join("catalog.json").is_file() { return development.canonicalize().map_err(|e| e.to_string()); } }
    Err("Biblioteca visual não encontrada. Recompile o aplicativo.".into())
}
#[tauri::command]
pub(crate) fn studio_asset_root(app: tauri::AppHandle) -> Result<String, String> {
    let root = asset_root(&app)?;
    app.asset_protocol_scope().allow_directory(&root, true).map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().into_owned())
}
fn run(app: &tauri::AppHandle, args: &[&str]) -> Result<Value, String> {
    let output = helper_command(app)?.args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    let value: Value = std::str::from_utf8(&output.stdout).map_err(|e| e.to_string())?.lines().last().ok_or("Motor nativo não respondeu.").and_then(|line| serde_json::from_str(line).map_err(|_| "Resposta inválida do motor nativo."))?;
    if !output.status.success() { return Err(value["message"].as_str().unwrap_or("Falha no motor nativo.").into()); }
    Ok(value)
}
fn choose(app: &tauri::AppHandle, kind: &str) -> Result<Option<PathBuf>, String> {
    // Only the opt-in debug benchmark supplies an export destination without a dialog.
    if kind == "save-video" {
        if let Some(config) = crate::benchmark::config()? {
            if config["mode"] == "export" {
                return Ok(Some(PathBuf::from(config["destination"].as_str().ok_or("Missing benchmark destination")?)));
            }
        }
    }
    let file = app.dialog().file();
    let chosen = match kind {
        "choose-video" => file.add_filter("Vídeos", &["mov", "mp4", "m4v"]).blocking_pick_file(),
        "choose-audio" => file.add_filter("Áudio", &["mp3", "m4a", "aac", "wav", "aiff"]).blocking_pick_file(),
        "choose-project" => {
            #[cfg(windows)]
            { file.set_title("Abra project.json dentro da pasta .framestudio").add_filter("Frame Studio (project.json)", &["json"]).blocking_pick_file() }
            #[cfg(not(windows))]
            { file.add_filter("Frame Studio", &["framestudio", "json"]).blocking_pick_file() }
        },
        "save-project" => file.add_filter("Frame Studio Project", &["framestudio"]).set_file_name("Meu projeto.framestudio").blocking_save_file(),
        "save-video" => file.add_filter("MP4", &["mp4"]).set_file_name("Meu vídeo.mp4").blocking_save_file(),
        _ => return Err("Diálogo inválido.".into()),
    };
    let path = chosen.map(|path| path.into_path().map_err(|e| e.to_string())).transpose()?;
    Ok(path.map(|path| {
        if kind == "choose-project" && path.file_name().is_some_and(|name| name == "project.json") {
            if let Some(parent) = path.parent().filter(|p| p.extension().is_some_and(|ext| ext == "framestudio")) { return parent.to_path_buf(); }
        }
        path
    }))
}
#[tauri::command]
pub(crate) async fn choose_background_audio(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_idle(&app)?;
        let Some(path) = choose(&app, "choose-audio")? else { return Ok(None) };
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}
fn check_idle(app: &tauri::AppHandle) -> Result<(), String> {
    if app.state::<Recorder>().busy.load(Ordering::SeqCst) { Err("Aguarde a operação atual terminar.".into()) } else { Ok(()) }
}
fn current(app: &tauri::AppHandle) -> Result<Media, String> {
    app.state::<Recorder>().media.lock().map_err(|e| e.to_string())?.clone().ok_or("Abra ou grave um vídeo primeiro.".into())
}
fn load_media(app: &tauri::AppHandle, path: &Path) -> Result<Media, String> {
    let path = path.canonicalize().map_err(|e| format!("Vídeo não encontrado: {e}"))?;
    let value = run(app, &["inspect", &path.to_string_lossy()])?;
    let mut media: Media = serde_json::from_value(value["media"].clone()).map_err(|e| e.to_string())?;
    let microphone = path.with_extension("microphone.m4a");
    if microphone.is_file() { app.asset_protocol_scope().allow_file(&microphone).map_err(|e| e.to_string())?; media.microphone_path = Some(microphone.to_string_lossy().into_owned()); }
    if !media.duration.is_finite() || media.duration <= 0. || media.duration > 86400. || media.width == 0 || media.height == 0 { return Err("Vídeo inválido ou duração maior que 24 horas.".into()); }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    // Asset access is restricted to videos explicitly opened in this app session.
    let state = app.state::<Recorder>();
    *state.media.lock().map_err(|e| e.to_string())? = Some(media.clone());
    *state.latest.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(media)
}
fn bounded(n: f64, min: f64, max: f64) -> bool { n.is_finite() && n >= min && n <= max }
fn valid_webcam_layout(layout: &WebcamLayout, camera: &Webcam, duration: f64) -> bool {
    let size = layout.size.unwrap_or(camera.size);
    let x = layout.x.unwrap_or(camera.x); let y = layout.y.unwrap_or(camera.y);
    valid_webcam_zoom(layout.zoom_behavior.as_deref(), layout.zoom_size, layout.transition_duration) && bounded(size, 0.08, 0.6) && bounded(x, 0., 1.) && bounded(y, 0., 1.)
        && layout.opacity.is_none_or(|v| bounded(v, 0., 1.)) && layout.border.is_none_or(|v| bounded(v, 0., 8.))
        && layout.shadow.is_none_or(|v| bounded(v, 0., 100.)) && layout.border_radius.is_none_or(|v| bounded(v, 0., 0.5))
        && layout.mode.as_deref().is_none_or(|mode| ["static", "manual", "auto", "hybrid"].contains(&mode))
        && layout.shape.as_deref().is_none_or(|shape| ["circle", "rounded", "square", "rectangle"].contains(&shape))
        && layout.keyframes.len() <= 10000
        && layout.keyframes.iter().all(|key| bounded(key.t, 0., duration) && bounded(key.size, 0.08, 0.6)
            && bounded(key.x, 0., 1.) && bounded(key.y, 0., 1.)
            && key.opacity.is_none_or(|v| bounded(v, 0., 1.)) && key.border_radius.is_none_or(|v| bounded(v, 0., 0.5))
            && key.easing.as_deref().is_none_or(|v| ["linear", "ease-in-out", "ease-out", "cubic-bezier"].contains(&v)))
        && layout.keyframes.windows(2).all(|keys| keys[0].t < keys[1].t)
}
fn valid_webcam_zoom(behavior: Option<&str>, size: Option<f64>, duration: Option<f64>) -> bool {
    behavior.is_none_or(|v| ["keep", "shrink", "grow", "custom"].contains(&v)) && size.is_none_or(|v| bounded(v, 0.08, 0.6)) && duration.is_none_or(|v| bounded(v, 0.15, 2.))
}
fn valid_webcam(camera: &Webcam, duration: f64) -> bool {
    valid_webcam_zoom(camera.zoom_behavior.as_deref(), camera.zoom_size, camera.transition_duration) && !camera.path.is_empty() && Path::new(&camera.path).is_file() && bounded(camera.size, 0.08, 0.6)
        && bounded(camera.x, 0., 1.) && bounded(camera.y, 0., 1.)
        && ["circle", "rounded", "square", "rectangle"].contains(&camera.shape.as_str()) && camera.keyframes.len() <= 10_000
        && camera.keyframes.iter().all(|key| bounded(key.t, 0., duration) && bounded(key.size, 0.08, 0.6)
            && bounded(key.x, 0., 1.) && bounded(key.y, 0., 1.)
            && key.opacity.is_none_or(|v| bounded(v, 0., 1.)) && key.border_radius.is_none_or(|v| bounded(v, 0., 0.5))
            && key.easing.as_deref().is_none_or(|v| ["linear", "ease-in-out", "ease-out", "cubic-bezier"].contains(&v)))
        && camera.keyframes.windows(2).all(|keys| keys[0].t < keys[1].t)
        && camera.mode.as_deref().is_none_or(|v| ["static", "manual", "auto", "hybrid"].contains(&v))
        && camera.opacity.is_none_or(|v| bounded(v, 0., 1.)) && camera.border.is_none_or(|v| bounded(v, 0., 8.))
        && camera.shadow.is_none_or(|v| bounded(v, 0., 100.)) && camera.border_radius.is_none_or(|v| bounded(v, 0., 0.5))
        && camera.layouts.as_ref().is_none_or(|layouts| [layouts.portrait.as_ref(), layouts.landscape.as_ref()].into_iter().flatten().all(|layout| valid_webcam_layout(layout, camera, duration)))
}
fn validate_appearance(a: &Appearance) -> Result<(), String> {
    if a.camera_mode.as_deref().is_some_and(|mode| !["auto", "manual", "hybrid"].contains(&mode)) { return Err("Modo de câmera inválido.".into()); }
    if a.background_mode.as_ref().is_some_and(|m| m != "gradient" && m != "color" && m != "wallpaper") || a.colors.as_ref().is_some_and(|colors| colors.iter().any(|c| c.len() != 7 || !c.starts_with('#') || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))) { return Err("Cor de fundo inválida.".into()); }
    let catalog = asset_catalog();
    for (kind, selected) in [("wallpapers", &a.wallpaper), ("cursors", &a.cursor_asset)] {
        if let Some(id) = selected { if !catalog[kind].as_array().unwrap().iter().any(|item| item["id"].as_str() == Some(id.as_str())) { return Err("Recurso visual inválido.".into()); } }
    }
    if let Some(theme) = &a.cursor_theme { if !catalog["cursors"].as_array().unwrap().iter().any(|item| item["group"].as_str() == Some(theme.as_str()) && item["id"].as_str().is_some_and(|id| id.starts_with("sets/"))) { return Err("Conjunto de cursores inválido.".into()); } }
    if a.background_mode.as_deref() == Some("wallpaper") && a.wallpaper.is_none() { return Err("Escolha um wallpaper.".into()); }
    if a.camera_motion.as_ref().is_some_and(|m| !valid_camera_motion(m, 86400.)) { return Err("Configuração de Camera Motion inválida.".into()); }
    if a.motion_blur.as_ref().is_some_and(|b| [b.cursor, b.zoom, b.pan].iter().any(|n| !bounded(*n, 0., 1.))) { return Err("Intensidade de motion blur inválida.".into()); }
    if a.background_blur.is_some_and(|n| !bounded(n, 0., 30.)) || a.cursor_motion.as_ref().is_some_and(|m| !["original", "smooth", "medium", "rapid"].contains(&m.as_str())) { return Err("Configuração de animação inválida.".into()); }
    if a.click_sound_volume.is_some_and(|n| !bounded(n, 0., 1.)) { return Err("Volume dos cliques inválido.".into()); }
    if a.background >= 6 || !bounded(a.padding, 0., 20.) || !bounded(a.radius, 0., 40.) || !bounded(a.shadow, 0., 100.) || !bounded(a.cursor_size, 0., 64.) || !["auto", "16:9", "9:16", "1:1"].contains(&a.aspect.as_str()) { return Err("Aparência inválida.".into()); }
    Ok(())
}
fn validate_trim(start: f64, end: f64, duration: f64) -> Result<(), String> {
    if !bounded(start, 0., duration) || !bounded(end, 0., duration + 0.05) || end - start < 0.1 { Err("O trecho deve ter pelo menos 0,1 segundo e estar dentro do vídeo.".into()) } else { Ok(()) }
}
fn validate_ranges(ranges: &[Clip], duration: f64) -> Result<(), String> {
    if ranges.is_empty() || ranges.len() > 10000 || ranges.iter().any(|r| !bounded(r.start, 0., duration) || !bounded(r.end, 0., duration + 0.05) || r.end <= r.start || !bounded(r.speed.unwrap_or(1.), 0.25, 4.)) || ranges.windows(2).any(|pair| pair[0].end > pair[1].start) || ranges.iter().map(|r| (r.end - r.start) / r.speed.unwrap_or(1.)).sum::<f64>() < 0.1 { return Err("Cortes inválidos: mantenha pelo menos 0,1 segundo, em ordem e sem sobreposição.".into()); }
    Ok(())
}
fn validate_effects(effects: &[Effect], duration: f64) -> Result<(), String> {
    if effects.len() > 10000 || effects.iter().any(|e| e.id.len() > 100 || !["mask", "highlight"].contains(&e.kind.as_str()) || !bounded(e.start, 0., duration) || !bounded(e.end, e.start + 0.1, duration + 0.05) || !bounded(e.x, 0., 1.) || !bounded(e.y, 0., 1.) || !bounded(e.width, 0.02, 1.) || !bounded(e.height, 0.02, 1.) || e.x < e.width / 2. || e.x > 1. - e.width / 2. || e.y < e.height / 2. || e.y > 1. - e.height / 2. || !bounded(e.opacity, 0.1, 1.)) { return Err("Máscaras ou destaques inválidos.".into()); }
    Ok(())
}
fn validate_project(project: &Project, media: &Media) -> Result<(), String> {
    if project.appearance.camera_motion.as_ref().is_some_and(|m| !valid_camera_motion(m, media.duration)) { return Err("Impactos fora do vídeo.".into()); }
    validate_appearance(&project.appearance)?; validate_trim(project.trim.start, project.trim.end, media.duration)?;
    if let Some(clips) = &project.clips {
        validate_ranges(clips, media.duration)?;
        if clips.iter().map(|r| (r.end.min(project.trim.end) - r.start.max(project.trim.start)).max(0.) / r.speed.unwrap_or(1.)).sum::<f64>() < 0.1 { return Err("O trecho selecionado não contém vídeo suficiente.".into()); }
    }
    if project.name.len() > 300 || project.zooms.len() > 10000 || project.zooms.iter().any(|z| z.id.len() > 100 || !bounded(z.start, 0., media.duration) || !bounded(z.end, z.start + 0.1, media.duration + 0.05) || !bounded(z.x, 0., 1.) || !bounded(z.y, 0., 1.) || !bounded(z.scale, 1., 3.)) { return Err("Segmentos de zoom inválidos.".into()); }
    if let Some(effects) = &project.effects { validate_effects(effects, media.duration)?; }
    if project.source_volume.is_some_and(|v| !bounded(v, 0., 1.)) { return Err("Volume da gravação inválido.".into()); }
    for audio in [project.background_audio.as_ref(), project.microphone.as_ref()].into_iter().flatten() { if audio.path.is_empty() || !Path::new(&audio.path).is_file() || !bounded(audio.volume, 0., 1.) { return Err("Trilha de áudio inválida.".into()); } }
    if project.webcam.as_ref().is_some_and(|camera| !valid_webcam(camera, media.duration)) { return Err("Configuração da webcam inválida.".into()); }
    Ok(())
}
#[tauri::command]
pub(crate) async fn import_video(app: tauri::AppHandle) -> Result<Option<Media>, String> {
    tauri::async_runtime::spawn_blocking(move || { check_idle(&app)?; choose(&app, "choose-video")?.map(|p| {
        let media = load_media(&app, &p)?;
        *app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())? = None;
        Ok(media)
    }).transpose() }).await.map_err(|e| e.to_string())?
}
fn read_document(path: &Path) -> Result<(Project, PathBuf), String> {
    let package = path.is_dir();
    let manifest = if package { path.join("project.json") } else { path.to_path_buf() };
    if std::fs::metadata(&manifest).map_err(|e| format!("Projeto não encontrado: {e}"))?.len() > 10_000_000 { return Err("Projeto maior que o limite de 10 MB.".into()); }
    let project: Project = serde_json::from_slice(&std::fs::read(&manifest).map_err(|e| e.to_string())?).map_err(|e| format!("Projeto inválido: {e}"))?;
    let source = PathBuf::from(&project.media_path);
    if package && (source.is_absolute() || source.components().any(|p| matches!(p, std::path::Component::ParentDir))) { return Err("O pacote deve usar uma mídia interna.".into()); }
    let source = if source.is_absolute() { source } else { manifest.parent().ok_or("Pasta de projeto inválida.")?.join(source) };
    let canonical = source.canonicalize().map_err(|e| format!("Mídia do projeto não encontrada: {e}"))?;
    if package && !canonical.starts_with(path.canonicalize().map_err(|e| e.to_string())?) { return Err("A mídia aponta para fora do pacote.".into()); }
    Ok((project, canonical))
}
fn open_document(app: &tauri::AppHandle, path: &Path) -> Result<Value, String> {
    let (mut project, canonical) = read_document(path)?;
    for audio in [&mut project.background_audio, &mut project.microphone].into_iter().flatten() {
        let package = path.is_dir();
        let raw = PathBuf::from(&audio.path);
        if package && (raw.is_absolute() || raw.components().any(|part| matches!(part, std::path::Component::ParentDir))) { return Err("O pacote deve usar uma trilha de áudio interna.".into()); }
        let base = if package { path } else { path.parent().ok_or("Pasta do projeto inválida.")? };
        let audio_path = (if raw.is_absolute() { raw } else { base.join(raw) }).canonicalize().map_err(|e| format!("Trilha de áudio não encontrada: {e}"))?;
        if package && !audio_path.starts_with(path.canonicalize().map_err(|e| e.to_string())?) { return Err("A trilha de áudio aponta para fora do pacote.".into()); }
        app.asset_protocol_scope().allow_file(&audio_path).map_err(|e| e.to_string())?;
        audio.path = audio_path.to_string_lossy().into_owned();
    }
    if let Some(camera) = &mut project.webcam {
        let package = path.is_dir(); let raw = PathBuf::from(&camera.path);
        if package && (raw.is_absolute() || raw.components().any(|part| matches!(part, std::path::Component::ParentDir))) { return Err("O pacote deve usar uma gravação de webcam interna.".into()); }
        let base = if package { path } else { path.parent().ok_or("Pasta do projeto inválida.")? };
        let camera_path = (if raw.is_absolute() { raw } else { base.join(raw) }).canonicalize().map_err(|e| format!("Gravação da webcam não encontrada: {e}"))?;
        if package && !camera_path.starts_with(path.canonicalize().map_err(|e| e.to_string())?) { return Err("A gravação da webcam aponta para fora do pacote.".into()); }
        app.asset_protocol_scope().allow_file(&camera_path).map_err(|e| e.to_string())?;
        camera.path = camera_path.to_string_lossy().into_owned();
    }
    let info = run(app, &["inspect", &canonical.to_string_lossy()])?;
    let media: Media = serde_json::from_value(info["media"].clone()).map_err(|e| e.to_string())?;
    validate_project(&project, &media)?;
    let media = load_media(app, &canonical)?;
    *app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())? = if path.is_dir() { Some(path.canonicalize().map_err(|e| e.to_string())?) } else { None };
    project.media_path = media.path.clone();
    Ok(json!({ "project": project, "media": media, "path": path }))
}
#[tauri::command]
pub(crate) async fn open_project(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_idle(&app)?;
        choose(&app, "choose-project")?.map(|path| open_document(&app, &path)).transpose()
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn take_pending_project(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if check_idle(&app).is_err() { return Ok(None) }
        let path = app.state::<Recorder>().pending_project.lock().map_err(|e| e.to_string())?.take();
        path.map(|path| open_document(&app, &path)).transpose()
    }).await.map_err(|e| e.to_string())?
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    atomic_bytes(path, &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
}
fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_file_name(format!(".frame-{}.tmp", timestamp()?));
    let result = (|| {
        let mut file = std::fs::File::create_new(&temp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(temp); }
    result
}
fn write_manifest(package: &Path, project: &Project, source: &Path) -> Result<(), String> {
    let package = package.canonicalize().map_err(|e| e.to_string())?;
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let relative = source.strip_prefix(&package).map_err(|_| "A mídia deve estar dentro do pacote.")?;
    let mut document = project.clone(); document.version = if document.microphone.is_some() || document.source_volume.is_some() { 11 } else if document.webcam.as_ref().is_some_and(|camera| !camera.keyframes.is_empty() || camera.layouts.is_some() || camera.mode.is_some()) { 11 } else if document.appearance.click_sounds.is_some() || document.appearance.click_sound_volume.is_some() { 9 } else if document.webcam.is_some() { 8 } else if document.appearance.camera_mode.is_some() || document.appearance.crop_follow_cursor == Some(true) { 7 } else if document.background_audio.is_some() { 6 } else if document.effects.as_ref().is_some_and(|effects| !effects.is_empty()) { 5 } else if document.appearance.motion_blur.is_some() || document.zooms.iter().any(|z| z.instant) || document.clips.as_ref().is_some_and(|clips| clips.iter().any(|c| c.speed.is_some() || c.hide_cursor.is_some() || c.cursor_original.is_some())) { 4 } else if document.clips.is_some() { 3 } else { 2 }; document.media_path = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
    for (kind, audio) in [("background", &mut document.background_audio), ("microphone", &mut document.microphone)] {
        let Some(audio) = audio else { continue };
        let source = Path::new(&audio.path).canonicalize().map_err(|e| format!("Trilha de áudio não encontrada: {e}"))?;
        let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("m4a");
        if let Ok(relative) = source.strip_prefix(&package) { audio.path = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"); }
        else {
            let mut hasher = std::collections::hash_map::DefaultHasher::new(); source.hash(&mut hasher);
            let relative = format!("audio/{kind}-{:016x}.{extension}", hasher.finish());
            let destination = package.join(&relative); let source_meta = std::fs::metadata(&source).map_err(|e| e.to_string())?;
            let stale = std::fs::metadata(&destination).map_or(true, |meta| meta.len() != source_meta.len() || meta.modified().ok() != source_meta.modified().ok());
            if stale { std::fs::create_dir_all(destination.parent().ok_or("Pasta de áudio inválida.")?).map_err(|e| e.to_string())?; std::fs::copy(&source, &destination).map_err(|e| format!("Não foi possível incluir a trilha de áudio: {e}"))?; }
            audio.path = relative;
        }
    }
    if let Some(camera) = &mut document.webcam {
        let source = Path::new(&camera.path).canonicalize().map_err(|e| format!("Gravação da webcam não encontrada: {e}"))?;
        if let Ok(relative) = source.strip_prefix(&package) { camera.path = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"); }
        else { let mut hasher = std::collections::hash_map::DefaultHasher::new(); source.hash(&mut hasher); let relative = format!("media/webcam-{:016x}.mov", hasher.finish()); let destination = package.join(&relative); if source != destination { let source_meta = std::fs::metadata(&source).map_err(|e| e.to_string())?; let stale = std::fs::metadata(&destination).map_or(true, |meta| meta.len() != source_meta.len() || meta.modified().ok() != source_meta.modified().ok()); if stale { std::fs::copy(&source, &destination).map_err(|e| format!("Não foi possível incluir a gravação da webcam: {e}"))?; } } camera.path = relative; }
    }
    let manifest = package.join("project.json");
    if manifest.exists() {
        if std::fs::metadata(&manifest).map_err(|e| e.to_string())?.len() > 10_000_000 { return Err("Manifesto anterior maior que o limite de segurança.".into()); }
        atomic_bytes(&package.join("project.json.bak"), &std::fs::read(&manifest).map_err(|e| e.to_string())?)?;
    }
    atomic_json(&manifest, &document)
}
fn create_package(path: &Path, project: &Project, media: &Media) -> Result<PathBuf, String> {
    if path.exists() { return Err("Já existe um projeto com esse nome. Escolha outro nome para Salvar como.".into()); }
    let parent = path.parent().ok_or("Destino inválido.")?;
    let staging = parent.join(format!(".frame-package-{}", timestamp()?));
    std::fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        let folder = staging.join("media"); std::fs::create_dir(&folder).map_err(|e| e.to_string())?;
        let extension = Path::new(&media.path).extension().and_then(|e| e.to_str()).unwrap_or("mov");
        let source = folder.join(format!("recording.{extension}"));
        std::fs::copy(&media.path, &source).map_err(|e| e.to_string())?;
        if media.cursor_captured { atomic_json(&source.with_extension("cursor.json"), &media.cursor)?; }
        write_manifest(&staging, project, &source)?;
        std::fs::rename(&staging, path).map_err(|e| e.to_string())?;
        Ok::<_, String>(path.join("media").join(source.file_name().ok_or("Nome de mídia inválido.")?))
    })();
    if result.is_err() { let _ = std::fs::remove_dir_all(staging); }
    result
}
fn preview_package(app: &tauri::AppHandle, package: &Path, source: &Path) {
    // A missing thumbnail never prevents saving the video/editing data.
    let _ = run(app, &["preview", &source.to_string_lossy(), &package.to_string_lossy()]);
}
#[tauri::command]
pub(crate) async fn save_project(app: tauri::AppHandle, project: Project, save_as: Option<bool>) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_idle(&app)?; let media = current(&app)?; validate_project(&project, &media)?;
        if project.media_path != media.path { return Err("A mídia do projeto não corresponde ao vídeo aberto.".into()); }
        let active = app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())?.clone();
        let (path, source) = if !save_as.unwrap_or(false) && active.is_some() {
            let path = active.unwrap(); write_manifest(&path, &project, Path::new(&media.path))?; (path, PathBuf::from(&media.path))
        } else {
            let Some(path) = choose(&app, "save-project")? else { return Ok(None) };
            let path = if path.extension().is_some_and(|e| e == "framestudio") { path } else { path.with_extension("framestudio") };
            let source = create_package(&path, &project, &media)?; (path, source)
        };
        let mut media = load_media(&app, &source)?;
        if let Some(microphone) = read_document(&path)?.0.microphone {
            let file = path.join(microphone.path).canonicalize().map_err(|e| e.to_string())?;
            app.asset_protocol_scope().allow_file(&file).map_err(|e| e.to_string())?;
            media.microphone_path = Some(file.to_string_lossy().into_owned());
        }
        *app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())? = Some(path.clone());
        preview_package(&app, &path, &source);
        Ok(Some(json!({ "path": path, "media": media })))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn autosave_project(app: tauri::AppHandle, project: Project) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_idle(&app)?; let media = current(&app)?; validate_project(&project, &media)?;
        if project.media_path != media.path { return Err("Mídia do projeto alterada.".into()); }
        let path = app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())?.clone();
        if let Some(path) = path { write_manifest(&path, &project, Path::new(&media.path))?; return Ok(Some(path.to_string_lossy().into_owned())) }
        Ok(None)
    }).await.map_err(|e| e.to_string())?
}
fn timestamp() -> Result<u128, String> { Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos()) }
#[tauri::command]
pub(crate) async fn list_recording_devices(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        { run(&app, &["devices"]) }
        #[cfg(not(windows))]
        { let _ = app; Ok(json!({"supported":false,"inputs":[],"outputs":[],"cameras":[]})) }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn start_camera_preview(app: tauri::AppHandle, device_id: Option<String>) -> Result<(), String> {
    let state = app.state::<Recorder>();
    let mut control = state.camera_preview_control.lock().map_err(|e| e.to_string())?;
    if control.is_some() { return Ok(()); }
    let mut command = helper_command(&app)?;
    command.arg("camera-preview");
    #[cfg(windows)]
    if let Some(device) = device_id.as_deref().filter(|d| !d.is_empty()) { command.arg(device); }
    #[cfg(not(windows))]
    let _ = device_id;
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    state.camera_preview_running.store(true, Ordering::SeqCst);
    *control = child.stdin.take();
    drop(control);
    let stdout = child.stdout.take().ok_or("Não foi possível ler a prévia da câmera.")?;
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                match value["event"].as_str() {
                    Some("camera-frame") => { let _ = app.emit("camera-preview-frame", value["data"].clone()); }
                    Some("error") => { let _ = app.emit("camera-preview-error", value["message"].as_str().unwrap_or("Falha ao iniciar a webcam.")); }
                    _ => {}
                }
            }
        }
        let _ = child.wait();
        if let Ok(mut control) = app.state::<Recorder>().camera_preview_control.lock() { control.take(); }
        app.state::<Recorder>().camera_preview_running.store(false, Ordering::SeqCst);
    });
    Ok(())
}
#[tauri::command]
pub(crate) fn stop_camera_preview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(mut pipe) = app.state::<Recorder>().camera_preview_control.lock().map_err(|e| e.to_string())?.take() { pipe.write_all(b"stop\n").map_err(|e| e.to_string())?; }
    for _ in 0..300 {
        if !app.state::<Recorder>().camera_preview_running.load(Ordering::SeqCst) { return Ok(()); }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    if app.state::<Recorder>().camera_preview_running.load(Ordering::SeqCst) { return Err("A câmera ainda está sendo liberada. Tente novamente em um instante.".into()); }
    Ok(())
}
fn acquire(app: &tauri::AppHandle) -> Result<(), String> { if app.state::<Recorder>().busy.swap(true, Ordering::SeqCst) { Err("Já existe uma operação em andamento.".into()) } else { Ok(()) } }
fn spawn_operation(app: tauri::AppHandle, kind: &'static str, arg: PathBuf, cleanup: bool, webcam: Option<PathBuf>, capture_audio: (bool, bool), options: Option<crate::recording::RecordingOptions>) {
    std::thread::spawn(move || {
        let result = (|| -> Result<(&str, Value), String> {
            let mut command = helper_command(&app)?; command.arg(kind).arg(&arg); if let Some(path) = &webcam { command.arg(path); }
            if let Some(options) = options { command.env("FRAME_CAPTURE_OPTIONS", serde_json::to_string(&options).map_err(|e| e.to_string())?); }
            if capture_audio.0 { command.arg("--system-audio"); } if capture_audio.1 { command.arg("--microphone"); }
            let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().map_err(|e| e.to_string())?;
            *app.state::<Recorder>().control.lock().map_err(|e| e.to_string())? = child.stdin.take();
            let stdout = child.stdout.take().ok_or("Não foi possível ler o motor nativo.")?;
            let mut final_event = None;
            let mut native_error = None;
            for line in BufReader::new(stdout).lines() {
                let line = line.map_err(|e| e.to_string())?;
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                match value["event"].as_str() {
                    Some("started") => { let _ = app.emit("recording-started", ()); }
                    Some("camera-frame") => { let _ = app.emit("camera-preview-frame", value["data"].clone()); }
                    Some("recording-time") => { let _ = app.emit("recording-time", &value); }
                    Some("progress") => { let _ = app.emit("export-progress", &value); }
                    Some("media") => { final_event = Some(value); }
                    Some("exported") => { final_event = Some(value); }
                    Some("error") => { if value["code"] == "screen-capture-permission" { let _ = app.emit("screen-capture-permission", ()); } native_error = Some(value["message"].as_str().unwrap_or("Falha no motor nativo.").to_string()); }
                    Some("capture-error") => { if let Ok(mut pipe) = app.state::<Recorder>().control.lock() { if let Some(pipe) = pipe.as_mut() { let _ = pipe.write_all(b"stop\n"); } } }
                    _ => {}
                }
            }
            let status = child.wait().map_err(|e| e.to_string())?;
            if !status.success() { return Err(native_error.unwrap_or("O motor nativo encerrou inesperadamente.".into())); }
            let value = final_event.ok_or("A operação terminou sem resultado.")?;
            if kind == "record" {
                let mut media = load_media(&app, &arg)?;
                if let Some(camera_path) = &webcam { if camera_path.is_file() { media.webcam_path = Some(camera_path.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().into_owned()); app.asset_protocol_scope().allow_file(camera_path).map_err(|e| e.to_string())?; } }
                if let Some(package) = arg.parent().and_then(|p| p.parent()) {
                let initial = Project { version: if media.webcam_path.is_some() { 8 } else { 2 }, name: "Nova gravação".into(), media_path: media.path.clone(), zooms: vec![], appearance: Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), crop_fill: None, crop_follow_cursor: None, camera_mode: None, colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, cursor_theme: None, background_blur: None, cursor_motion: None, camera_spring: None, camera_motion: None, motion_blur: None, click_sounds: Some(true), click_sound_volume: Some(0.3) }, trim: Trim { start: 0., end: media.duration }, clips: None, effects: None, background_audio: None, microphone: media.microphone_path.as_ref().map(|path| BackgroundAudio { path: path.clone(), volume: 1. }), source_volume: None, webcam: media.webcam_path.as_ref().map(|path| Webcam { zoom_behavior: None, zoom_size: None, transition_duration: None, path: path.clone(), x: 0.78, y: 0.78, size: 0.24, shape: "circle".into(), keyframes: vec![], mode: None, opacity: None, border: None, shadow: None, border_radius: None, layouts: None }) };
                    write_manifest(package, &initial, &arg)?;
                    *app.state::<Recorder>().project_path.lock().map_err(|e| e.to_string())? = Some(package.to_path_buf());
                    preview_package(&app, package, &arg);
                }
                return Ok(("recording-finished", serde_json::to_value(media).map_err(|e| e.to_string())?));
            } else {
                let path = value["path"].as_str().ok_or("Destino de exportação inválido.")?;
                *app.state::<Recorder>().latest.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(path));
                return Ok(("export-finished", value));
            }
        })();
        app.state::<Recorder>().control.lock().ok().map(|mut c| c.take());
        app.state::<Recorder>().busy.store(false, Ordering::SeqCst);
        if cleanup { let _ = std::fs::remove_file(arg); }
        match result { Ok((event, value)) => { let _ = app.emit(event, value); }, Err(error) => { let _ = app.emit("operation-error", error); } }
    });
}
#[tauri::command]
pub(crate) fn open_microphone_settings() -> Result<(), String> {
    #[cfg(windows)]
    { Command::new("explorer.exe").arg("ms-settings:privacy-microphone").spawn().map_err(|e| e.to_string())?; return Ok(()); }
    #[cfg(not(windows))]
    {
    Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone").spawn().map_err(|e| e.to_string())?; Ok(())
    }
}
#[tauri::command]
pub(crate) fn start_recording(app: tauri::AppHandle, with_webcam: bool, with_system_audio: bool, with_microphone: bool, options: Option<crate::recording::RecordingOptions>) -> Result<(), String> {
    let options = options.unwrap_or_default(); options.validate()?;
    stop_camera_preview(app.clone())?;
    acquire(&app)?;
    let result = (|| { helper(&app)?; let package = app.path().home_dir().map_err(|e| e.to_string())?.join("Frame Studio Projects").join(format!("Gravação-{}.framestudio", timestamp()?)); let folder = package.join("media"); std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?; Ok::<_, String>((folder.join("recording.mov"), with_webcam.then(|| folder.join("webcam.mov")))) })();
    match result { Ok((path, webcam)) => { spawn_operation(app, "record", path, false, webcam, (with_system_audio, with_microphone), Some(options)); Ok(()) }, Err(error) => { app.state::<Recorder>().busy.store(false, Ordering::SeqCst); Err(error) } }
}
#[tauri::command]
pub(crate) fn stop_operation(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Recorder>();
    let mut control = state.control.lock().map_err(|e| e.to_string())?;
    let pipe = control.as_mut().ok_or("O motor está iniciando. Tente novamente em um instante.")?;
    pipe.write_all(b"stop\n").map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn export_video(app: tauri::AppHandle, settings: ExportSettings) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_idle(&app)?; let media = current(&app)?;
        validate_export_format(settings.resolution, settings.fps)?;
        if let Some(ranges) = &settings.ranges {
            validate_ranges(ranges, media.duration)?;
            if ranges.iter().any(|r| r.start < settings.start || r.end > settings.end + 0.000001) { return Err("Corte fora do trecho de exportação.".into()); }
        }
        validate_trim(settings.start, settings.end, media.duration)?; validate_appearance(&settings.appearance)?; validate_effects(&settings.effects, media.duration)?;
        if settings.source_volume.is_some_and(|v| !bounded(v, 0., 1.)) { return Err("Volume da gravação inválido.".into()); }
        for audio in [settings.background_audio.as_ref(), settings.microphone.as_ref()].into_iter().flatten() { if audio.path.is_empty() || !Path::new(&audio.path).is_file() || !bounded(audio.volume, 0., 1.) { return Err("Trilha de áudio inválida.".into()); } }
        if settings.webcam.as_ref().is_some_and(|camera| !valid_webcam(camera, media.duration)) { return Err("Configuração da webcam inválida.".into()); }
        if settings.keys.len() < 2 || settings.keys.len() > 5_184_002 || settings.keys.iter().any(|k| !bounded(k.t, 0., media.duration + 0.05) || !bounded(k.x, 0., 1.) || !bounded(k.y, 0., 1.) || !bounded(k.scale, 1., 32.)) || settings.keys.windows(2).any(|k| k[0].t >= k[1].t) { return Err("Trajetória de câmera inválida.".into()); }
        if settings.raw_cursor.len() > media.cursor.len() || settings.raw_cursor.iter().any(|p| !bounded(p.t, 0., media.duration + 1.) || !bounded(p.x, 0., 1.) || !bounded(p.y, 0., 1.)) || settings.raw_cursor.windows(2).any(|p| p[0].t > p[1].t) { return Err("Trilha original de cursor inválida.".into()); }
        if settings.cursor.len() > media.cursor.len() || settings.cursor.iter().any(|p| !bounded(p.t, 0., media.duration + 1.) || !bounded(p.x, 0., 1.) || !bounded(p.y, 0., 1.)) || settings.cursor.windows(2).any(|p| p[0].t > p[1].t) { return Err("Trilha de cursor inválida.".into()); }
        let Some(destination) = choose(&app, "save-video")? else { return Ok(false) };
        if destination.canonicalize().ok().as_deref() == Some(Path::new(&media.path)) { return Err("Não é possível sobrescrever o vídeo original.".into()); }
        acquire(&app)?;
        let result = (|| {
            let folder = app.path().app_cache_dir().map_err(|e| e.to_string())?; std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let path = folder.join(format!("export-{}.json", timestamp()?));
            let job = json!({ "source": media.path, "destination": destination, "resolution": settings.resolution, "fps": settings.fps, "ranges": settings.ranges, "effects": settings.effects, "backgroundAudio": settings.background_audio, "microphone": settings.microphone, "sourceVolume": settings.source_volume, "webcam": settings.webcam, "start": settings.start, "end": settings.end, "appearance": settings.appearance, "keys": settings.keys, "cursor": settings.cursor, "rawCursor": settings.raw_cursor, "cursorCaptured": media.cursor_captured, "assetsRoot": asset_root(&app)? });
            std::fs::write(&path, serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            Ok::<_, String>(path)
        })();
        match result { Ok(path) => { spawn_operation(app, "export", path, true, None, (false, false), None); Ok(true) }, Err(error) => { app.state::<Recorder>().busy.store(false, Ordering::SeqCst); Err(error) } }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(windows)]
    { Command::new("explorer.exe").arg("ms-settings:privacy-screenshots").spawn().map_err(|e| e.to_string())?; return Ok(()); }
    #[cfg(not(windows))]
    {
    if !cfg!(target_os = "macos") { return Err("Disponível apenas no macOS.".into()); }
    let status = Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Não foi possível abrir os Ajustes do Sistema.".into()) }
    }
}
#[tauri::command]
pub(crate) fn open_camera_settings() -> Result<(), String> {
    #[cfg(windows)]
    { Command::new("explorer.exe").arg("ms-settings:privacy-webcam").spawn().map_err(|e| e.to_string())?; return Ok(()); }
    #[cfg(not(windows))]
    {
    if !cfg!(target_os = "macos") { return Err("Disponível apenas no macOS.".into()); }
    let status = Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera").status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Não foi possível abrir os Ajustes da Câmera.".into()) }
    }
}
#[tauri::command]
pub(crate) fn reveal_clip(state: tauri::State<Recorder>) -> Result<(), String> {
    let path = state.latest.lock().map_err(|e| e.to_string())?.clone().ok_or("Nenhum arquivo disponível.")?;
    crate::capture::reveal(&path)
}

#[cfg(test)]
mod tests {
    #[test]
    fn cut_ranges_reject_empty_overlapping_or_reversed_edits() {
        assert!(validate_ranges(&[Clip { start: 0., end: 1., ..Default::default() }, Clip { start: 2., end: 3., ..Default::default() }], 3.).is_ok());
        assert!(validate_ranges(&[], 3.).is_err());
        assert!(validate_ranges(&[Clip { start: 1., end: 0., ..Default::default() }], 3.).is_err());
        assert!(validate_ranges(&[Clip { start: 0., end: 2., ..Default::default() }, Clip { start: 1., end: 3., ..Default::default() }], 3.).is_err());
        assert!(validate_ranges(&[Clip { start: 0., end: 4., ..Default::default() }], 3.).is_err());
        for speed in [0., 0.1, 4.1, f64::NAN, f64::INFINITY] {
            assert!(validate_ranges(&[Clip { start: 0., end: 2., speed: Some(speed), ..Default::default() }], 3.).is_err());
        }
        assert!(validate_ranges(&[Clip { start: 0., end: 2., speed: Some(4.), ..Default::default() }], 3.).is_ok());
    }
    #[test]
    fn cinematic_motion_is_bounded_and_persisted() {
        let mut motion: CameraMotion = serde_json::from_value(json!({"style":"cinematic","shake":true,"intensity":0.0015,"duration":0.12,"frequency":12.,"spring":true,"damping":0.95,"blur":true,"blurIntensity":0.18,"impacts":[1.,2.]})).unwrap();
        assert!(valid_camera_motion(&motion, 3.)); assert!(!motion.webcam_shake);
        let saved: CameraMotion = serde_json::from_value(serde_json::to_value(&motion).unwrap()).unwrap();
        assert_eq!(saved.impacts, vec![1.,2.]); assert_eq!(saved.style,"cinematic");
        motion.duration = f64::NAN; assert!(!valid_camera_motion(&motion,3.));
        motion.duration = 0.12; motion.intensity=0.05; assert!(!valid_camera_motion(&motion,3.));
        motion.intensity=0.0015; motion.impacts=vec![4.]; assert!(!valid_camera_motion(&motion,3.));
    }
    #[test]
    fn export_formats_are_bounded() {
        assert!(valid_webcam_zoom(Some("custom"), Some(0.2), Some(0.4)));
        assert!(!valid_webcam_zoom(Some("invalid"), Some(0.2), Some(0.4)));
        assert!(!valid_webcam_zoom(Some("grow"), Some(f64::NAN), Some(0.4)));
        assert!(!valid_webcam_zoom(Some("keep"), None, Some(0.)));
        for resolution in [480, 720, 1080, 1440, 2160] { for fps in [24, 30, 60] { assert!(super::validate_export_format(resolution, fps).is_ok()); } }
        for (resolution, fps) in [(0, 60), (4320, 60), (2160, 0), (2160, 120)] { assert!(super::validate_export_format(resolution, fps).is_err()); }
    }

    use super::*;
    #[test] fn validates_edit_boundaries() {
        assert!(validate_trim(0., 2., 2.).is_ok());
        for (start, end) in [(1., 0.), (-1., 1.), (0., 3.), (f64::NAN, 1.), (0., 0.01)] { assert!(validate_trim(start, end, 2.).is_err()); }
        let mut a = Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), crop_fill: None, crop_follow_cursor: None, camera_mode: None, colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, cursor_theme: None, background_blur: None, cursor_motion: None, camera_spring: None, camera_motion: None, motion_blur: None, click_sounds: Some(true), click_sound_volume: Some(0.3) };
        assert!(validate_appearance(&a).is_ok()); a.padding = f64::INFINITY; assert!(validate_appearance(&a).is_err());
        a.padding = 9.;
        a.camera_mode = Some("hybrid".into()); assert!(validate_appearance(&a).is_ok());
        a.camera_mode = Some("automatic-random".into()); assert!(validate_appearance(&a).is_err());
        a.camera_mode = None;
        a.motion_blur = Some(MotionBlur {cursor: 0.5, zoom: 1., pan: 0.});
        assert!(validate_appearance(&a).is_ok());
        a.motion_blur.as_mut().unwrap().cursor = 1.1;
        assert!(validate_appearance(&a).is_err());
    }
    #[test] fn project_package_moves_with_its_media_and_keeps_a_backup() {
        let folder = std::env::temp_dir().join(format!("frame-package-test-{}", timestamp().unwrap()));
        std::fs::create_dir(&folder).unwrap();
        let original = folder.join("original.mov"); std::fs::write(&original, b"synthetic-video").unwrap();
        let media = Media { path: original.to_string_lossy().into_owned(), duration: 3., width: 1280, height: 800, cursor: vec![Pointer { t: 0., x: 0.5, y: 0.5, down: false, kind: None, right_down: Some(true), middle_down: Some(false), typing: None }], cursor_captured: true, has_audio: false, webcam_path: None, microphone_path: None };
        let mut project = Project { version: 1, name: "Example".into(), media_path: media.path.clone(), zooms: vec![], appearance: Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), crop_fill: None, crop_follow_cursor: None, camera_mode: None, colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, cursor_theme: None, background_blur: None, cursor_motion: None, camera_spring: None, camera_motion: None, motion_blur: None, click_sounds: None, click_sound_volume: None }, trim: Trim { start: 0., end: 3. }, clips: None, effects: None, background_audio: None, microphone: None, source_volume: None, webcam: None };
        project.clips = Some(vec![Clip { start: 0., end: 0.5, ..Default::default() }, Clip { start: 1., end: 3., ..Default::default() }]);
        let package = folder.join("Example.framestudio");
        create_package(&package, &project, &media).unwrap();
        assert!(create_package(&package, &project, &media).is_err(), "Save As must not replace an existing package");
        std::fs::remove_file(&original).unwrap();
        let moved = folder.join("Moved.framestudio"); std::fs::rename(&package, &moved).unwrap();
        let (saved, source) = read_document(&moved).unwrap();
        assert_eq!(saved.clips.as_ref().unwrap().len(), 2);
        assert_eq!(saved.clips.as_ref().unwrap()[1].start, 1.);
        assert_eq!(saved.version, 3); assert_eq!(saved.media_path, "media/recording.mov");
        assert_eq!(std::fs::read(&source).unwrap(), b"synthetic-video");
        assert!(source.with_extension("cursor.json").is_file());
        let cursor: Vec<Pointer> = serde_json::from_slice(&std::fs::read(source.with_extension("cursor.json")).unwrap()).unwrap();
        assert_eq!(cursor[0].right_down, Some(true)); assert_eq!(cursor[0].middle_down, Some(false));
        project.name = "Renamed".into(); write_manifest(&moved, &project, &source).unwrap();
        let backup: Project = serde_json::from_slice(&std::fs::read(moved.join("project.json.bak")).unwrap()).unwrap();
        assert_eq!(backup.name, "Example"); assert_eq!(read_document(&moved).unwrap().0.name, "Renamed");
        project.clips.as_mut().unwrap()[0].speed = Some(2.);
        project.clips.as_mut().unwrap()[0].hide_cursor = Some(true);
        project.clips.as_mut().unwrap()[1].cursor_original = Some(true);
        project.appearance.motion_blur = Some(MotionBlur {cursor: 0.5, zoom: 0.25, pan: 0.75});
        project.zooms.push(Zoom {id: "instant".into(), start: 0.2, end: 1., x: 0.5, y: 0.5, scale: 2., enabled: true, follow: false, instant: true, manual_override: false});
        project.effects = Some(vec![Effect {id:"privacy-mask".into(),kind:"mask".into(),start:0.4,end:1.4,x:0.5,y:0.5,width:0.3,height:0.2,opacity:0.28}]);
        assert!(validate_project(&project,&media).is_ok());
        let mut invalid_effect = project.clone(); invalid_effect.effects.as_mut().unwrap()[0].width = 1.2;
        assert!(validate_project(&invalid_effect,&media).is_err());
        write_manifest(&moved, &project, &source).unwrap();
        let saved = read_document(&moved).unwrap().0;
        assert_eq!(saved.version, 5);
        assert_eq!(saved.clips.as_ref().unwrap()[0].speed, Some(2.));
        assert_eq!(saved.clips.as_ref().unwrap()[0].hide_cursor, Some(true));
        assert_eq!(saved.clips.as_ref().unwrap()[1].cursor_original, Some(true));
        assert!(saved.zooms[0].instant);
        assert_eq!(saved.appearance.motion_blur.unwrap().pan, 0.75);
        assert_eq!(saved.effects.as_ref().unwrap()[0].kind, "mask");
        let background = folder.join("background.m4a"); std::fs::write(&background, b"synthetic-audio").unwrap();
        project.background_audio = Some(BackgroundAudio { path: background.to_string_lossy().into_owned(), volume: 0.25 });
        assert!(validate_project(&project, &media).is_ok());
        write_manifest(&moved, &project, &source).unwrap();
        let saved = read_document(&moved).unwrap().0;
        assert_eq!(saved.version, 6);
        let saved_audio = saved.background_audio.unwrap();
        assert!(saved_audio.path.starts_with("audio/background-"));
        assert!(moved.join(&saved_audio.path).is_file());
        assert_eq!(saved_audio.volume, 0.25);
        project.appearance.camera_mode = Some("hybrid".into()); project.appearance.crop_follow_cursor = Some(true);
        write_manifest(&moved, &project, &source).unwrap();
        let saved = read_document(&moved).unwrap().0;
        assert_eq!(saved.version, 7); assert_eq!(saved.appearance.camera_mode.as_deref(), Some("hybrid")); assert_eq!(saved.appearance.crop_follow_cursor, Some(true));
        let camera = folder.join("webcam.mov"); std::fs::write(&camera, b"synthetic-webcam").unwrap();
        project.webcam = Some(Webcam { zoom_behavior: None, zoom_size: None, transition_duration: None, path: camera.to_string_lossy().into_owned(), x: 0.78, y: 0.78, size: 0.24, shape: "circle".into(), keyframes: vec![], mode: None, opacity: None, border: None, shadow: None, border_radius: None, layouts: None });
        assert!(validate_project(&project, &media).is_ok()); write_manifest(&moved, &project, &source).unwrap();
        let saved = read_document(&moved).unwrap().0; assert_eq!(saved.version, 8);
        let saved_webcam = saved.webcam.unwrap(); assert_eq!(saved_webcam.shape, "circle"); assert!(moved.join(saved_webcam.path).is_file());
        project.webcam.as_mut().unwrap().mode = Some("manual".into());
        project.webcam.as_mut().unwrap().opacity = Some(0.9);
        project.webcam.as_mut().unwrap().border = Some(3.);
        project.webcam.as_mut().unwrap().shadow = Some(40.);
        project.webcam.as_mut().unwrap().keyframes = vec![WebcamKeyframe { t: 0., x: 0.78, y: 0.78, size: 0.24, opacity: Some(0.5), border_radius: Some(0.2), easing: Some("ease-in-out".into()) }, WebcamKeyframe { t: 2., x: 0.22, y: 0.7, size: 0.3, opacity: Some(1.), border_radius: Some(0.5), easing: Some("ease-out".into()) }];
        project.webcam.as_mut().unwrap().layouts = Some(WebcamLayouts { portrait: Some(WebcamLayout { zoom_behavior: Some("shrink".into()), zoom_size: Some(0.16), transition_duration: Some(0.4), x: Some(0.5), y: Some(0.7), size: Some(0.32), shape: Some("rounded".into()), opacity: Some(1.), border: Some(3.), shadow: Some(45.), border_radius: Some(0.18), mode: Some("hybrid".into()), keyframes: vec![] }), landscape: None });
        assert!(validate_project(&project, &media).is_ok()); write_manifest(&moved, &project, &source).unwrap();
        let saved = read_document(&moved).unwrap().0; assert_eq!(saved.version, 11); let saved_camera = saved.webcam.unwrap(); assert_eq!(saved_camera.keyframes.len(), 2); assert_eq!(saved_camera.layouts.unwrap().portrait.unwrap().size, Some(0.32)); assert_eq!(saved_camera.keyframes[1].easing.as_deref(), Some("ease-out"));
        project.microphone = Some(BackgroundAudio { path: background.to_string_lossy().into_owned(), volume: 0.8 }); project.source_volume = Some(0.7);
        write_manifest(&moved, &project, &source).unwrap();
        let recorded = read_document(&moved).unwrap().0;
        assert_eq!(recorded.source_volume, Some(0.7));
        let microphone = recorded.microphone.unwrap(); assert_eq!(microphone.volume, 0.8); assert!(microphone.path.starts_with("audio/microphone-")); assert!(moved.join(microphone.path).is_file());
        let saved_copy = folder.join("Audio Copy.framestudio"); let moved_media = Media { path: source.to_string_lossy().into_owned(), ..media.clone() }; create_package(&saved_copy, &project, &moved_media).unwrap();
        let copied = read_document(&saved_copy).unwrap().0; assert!(saved_copy.join(copied.microphone.unwrap().path).is_file());
        let mut invalid_voice = project.clone(); invalid_voice.microphone.as_mut().unwrap().volume = 2.; assert!(validate_project(&invalid_voice, &media).is_err());
        let mut invalid_animation = project.clone(); invalid_animation.webcam.as_mut().unwrap().keyframes[1].t = 0.; assert!(validate_project(&invalid_animation, &media).is_err());
        let mut edge_webcam = project.clone(); edge_webcam.webcam.as_mut().unwrap().x = 0.; edge_webcam.webcam.as_mut().unwrap().shape = "rectangle".into(); assert!(validate_project(&edge_webcam, &media).is_ok());
        let mut invalid_webcam = project.clone(); invalid_webcam.webcam.as_mut().unwrap().x = -0.01;
        assert!(validate_project(&invalid_webcam, &media).is_err());
        let mut invalid_audio = project.clone(); invalid_audio.background_audio.as_mut().unwrap().volume = 1.1;
        assert!(validate_project(&invalid_audio, &media).is_err());
        let mut escaped = project.clone(); escaped.media_path = "../outside.mov".into();
        atomic_json(&moved.join("project.json"), &escaped).unwrap();
        assert!(read_document(&moved).is_err(), "Packages cannot reach external media");
        let mut legacy = project; legacy.media_path = source.to_string_lossy().into_owned();
        let legacy_path = folder.join("old.frame.json"); atomic_json(&legacy_path, &legacy).unwrap();
        assert_eq!(read_document(&legacy_path).unwrap().1, source);
        #[cfg(unix)] {
            use std::os::unix::fs::symlink;
            let outside = folder.join("outside.mov"); std::fs::write(&outside, b"outside").unwrap();
            symlink(&outside, moved.join("media/linked.mov")).unwrap();
            escaped.media_path = "media/linked.mov".into(); atomic_json(&moved.join("project.json"), &escaped).unwrap();
            assert!(read_document(&moved).is_err(), "Symlinks cannot escape the package");
        }
        std::fs::remove_dir_all(folder).unwrap();
    }

}
