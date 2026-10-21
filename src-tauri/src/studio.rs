use std::{io::{BufRead, BufReader, Write}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::atomic::Ordering};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use crate::Recorder;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Media {
    path: String, duration: f64, width: u32, height: u32,
    cursor: Vec<Pointer>, cursor_captured: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Pointer { t: f64, x: f64, y: f64, down: bool }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Appearance { background: usize, padding: f64, radius: f64, shadow: f64, cursor_size: f64, smooth: bool, aspect: String, colors: Option<[String; 2]>, background_mode: Option<String>, cursor_smooth: Option<bool>, wallpaper: Option<String>, cursor_asset: Option<String>, background_blur: Option<f64>, cursor_motion: Option<String>, camera_spring: Option<bool> }
#[derive(Clone, Serialize, Deserialize)]
struct Zoom { id: String, start: f64, end: f64, x: f64, y: f64, scale: f64, enabled: bool, #[serde(default)] follow: bool }
#[derive(Clone, Serialize, Deserialize)]
struct Trim { start: f64, end: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Project { version: u32, media_path: String, name: String, zooms: Vec<Zoom>, appearance: Appearance, trim: Trim }
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Key { t: f64, x: f64, y: f64, scale: f64 }
#[derive(Deserialize)]
pub(crate) struct ExportSettings { start: f64, end: f64, appearance: Appearance, keys: Vec<Key>, cursor: Vec<Pointer> }

fn helper(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") { return Err("O motor nativo está disponível no macOS.".into()); }
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("frame-native");
    if bundled.is_file() { return Ok(bundled); }
    #[cfg(debug_assertions)]
    { let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("native/frame-native"); if development.is_file() { return Ok(development); } }
    Err("Motor nativo não encontrado. Recompile o aplicativo.".into())
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
    let output = Command::new(helper(app)?).args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
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
        "choose-project" => file.add_filter("Frame Studio", &["framestudio", "json"]).blocking_pick_file(),
        "save-project" => file.add_filter("Frame Studio Project", &["framestudio"]).set_file_name("Meu projeto.framestudio").blocking_save_file(),
        "save-video" => file.add_filter("MP4", &["mp4"]).set_file_name("Meu vídeo.mp4").blocking_save_file(),
        _ => return Err("Diálogo inválido.".into()),
    };
    chosen.map(|path| path.into_path().map_err(|e| e.to_string())).transpose()
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
    let media: Media = serde_json::from_value(value["media"].clone()).map_err(|e| e.to_string())?;
    if !media.duration.is_finite() || media.duration <= 0. || media.duration > 86400. || media.width == 0 || media.height == 0 { return Err("Vídeo inválido ou duração maior que 24 horas.".into()); }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    // Asset access is restricted to videos explicitly opened in this app session.
    let state = app.state::<Recorder>();
    *state.media.lock().map_err(|e| e.to_string())? = Some(media.clone());
    *state.latest.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(media)
}
fn bounded(n: f64, min: f64, max: f64) -> bool { n.is_finite() && n >= min && n <= max }
fn validate_appearance(a: &Appearance) -> Result<(), String> {
    if a.background_mode.as_ref().is_some_and(|m| m != "gradient" && m != "color" && m != "wallpaper") || a.colors.as_ref().is_some_and(|colors| colors.iter().any(|c| c.len() != 7 || !c.starts_with('#') || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))) { return Err("Cor de fundo inválida.".into()); }
    let catalog = asset_catalog();
    for (kind, selected) in [("wallpapers", &a.wallpaper), ("cursors", &a.cursor_asset)] {
        if let Some(id) = selected { if !catalog[kind].as_array().unwrap().iter().any(|item| item["id"].as_str() == Some(id.as_str())) { return Err("Recurso visual inválido.".into()); } }
    }
    if a.background_mode.as_deref() == Some("wallpaper") && a.wallpaper.is_none() { return Err("Escolha um wallpaper.".into()); }
    if a.background_blur.is_some_and(|n| !bounded(n, 0., 30.)) || a.cursor_motion.as_ref().is_some_and(|m| !["original", "smooth", "medium", "rapid"].contains(&m.as_str())) { return Err("Configuração de animação inválida.".into()); }
    if a.background >= 6 || !bounded(a.padding, 0., 20.) || !bounded(a.radius, 0., 40.) || !bounded(a.shadow, 0., 100.) || !bounded(a.cursor_size, 0., 64.) || !["auto", "16:9", "9:16", "1:1"].contains(&a.aspect.as_str()) { return Err("Aparência inválida.".into()); }
    Ok(())
}
fn validate_trim(start: f64, end: f64, duration: f64) -> Result<(), String> {
    if !bounded(start, 0., duration) || !bounded(end, 0., duration + 0.05) || end - start < 0.1 { Err("O trecho deve ter pelo menos 0,1 segundo e estar dentro do vídeo.".into()) } else { Ok(()) }
}
fn validate_project(project: &Project, media: &Media) -> Result<(), String> {
    if ![1, 2].contains(&project.version) { return Err("Versão de projeto não suportada.".into()); }
    validate_appearance(&project.appearance)?; validate_trim(project.trim.start, project.trim.end, media.duration)?;
    if project.name.len() > 300 || project.zooms.len() > 10000 || project.zooms.iter().any(|z| z.id.len() > 100 || !bounded(z.start, 0., media.duration) || !bounded(z.end, z.start + 0.1, media.duration + 0.05) || !bounded(z.x, 0., 1.) || !bounded(z.y, 0., 1.) || !bounded(z.scale, 1., 3.)) { return Err("Segmentos de zoom inválidos.".into()); }
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
    let mut document = project.clone(); document.version = 2; document.media_path = relative.to_string_lossy().into_owned();
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
        let media = load_media(&app, &source)?;
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
fn acquire(app: &tauri::AppHandle) -> Result<(), String> { if app.state::<Recorder>().busy.swap(true, Ordering::SeqCst) { Err("Já existe uma operação em andamento.".into()) } else { Ok(()) } }
fn spawn_operation(app: tauri::AppHandle, kind: &'static str, arg: PathBuf, cleanup: bool) {
    std::thread::spawn(move || {
        let result = (|| -> Result<(&str, Value), String> {
            let mut child = Command::new(helper(&app)?).arg(kind).arg(&arg).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().map_err(|e| e.to_string())?;
            *app.state::<Recorder>().control.lock().map_err(|e| e.to_string())? = child.stdin.take();
            let stdout = child.stdout.take().ok_or("Não foi possível ler o motor nativo.")?;
            let mut final_event = None;
            let mut native_error = None;
            for line in BufReader::new(stdout).lines() {
                let line = line.map_err(|e| e.to_string())?;
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                match value["event"].as_str() {
                    Some("started") => { let _ = app.emit("recording-started", ()); }
                    Some("progress") => { let _ = app.emit("export-progress", &value); }
                    Some("media") => { final_event = Some(value); }
                    Some("exported") => { final_event = Some(value); }
                    Some("error") => { native_error = Some(value["message"].as_str().unwrap_or("Falha no motor nativo.").to_string()); }
                    Some("capture-error") => { if let Ok(mut pipe) = app.state::<Recorder>().control.lock() { if let Some(pipe) = pipe.as_mut() { let _ = pipe.write_all(b"stop\n"); } } }
                    _ => {}
                }
            }
            let status = child.wait().map_err(|e| e.to_string())?;
            if !status.success() { return Err(native_error.unwrap_or("O motor nativo encerrou inesperadamente.".into())); }
            let value = final_event.ok_or("A operação terminou sem resultado.")?;
            if kind == "record" {
                let media = load_media(&app, &arg)?;
                if let Some(package) = arg.parent().and_then(|p| p.parent()) {
                    let initial = Project { version: 2, name: "Nova gravação".into(), media_path: media.path.clone(), zooms: vec![], appearance: Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, background_blur: None, cursor_motion: None, camera_spring: None }, trim: Trim { start: 0., end: media.duration } };
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
pub(crate) fn start_recording(app: tauri::AppHandle) -> Result<(), String> {
    acquire(&app)?;
    let result = (|| { helper(&app)?; let package = app.path().home_dir().map_err(|e| e.to_string())?.join("Frame Studio Projects").join(format!("Gravação-{}.framestudio", timestamp()?)); let folder = package.join("media"); std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?; Ok::<_, String>(folder.join("recording.mov")) })();
    match result { Ok(path) => { spawn_operation(app, "record", path, false); Ok(()) }, Err(error) => { app.state::<Recorder>().busy.store(false, Ordering::SeqCst); Err(error) } }
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
        validate_trim(settings.start, settings.end, media.duration)?; validate_appearance(&settings.appearance)?;
        if settings.keys.len() < 2 || settings.keys.len() > 5_184_002 || settings.keys.iter().any(|k| !bounded(k.t, 0., media.duration + 0.05) || !bounded(k.x, 0., 1.) || !bounded(k.y, 0., 1.) || !bounded(k.scale, 1., 3.)) || settings.keys.windows(2).any(|k| k[0].t >= k[1].t) { return Err("Trajetória de câmera inválida.".into()); }
        if settings.cursor.len() > media.cursor.len() || settings.cursor.iter().any(|p| !bounded(p.t, 0., media.duration + 1.) || !bounded(p.x, 0., 1.) || !bounded(p.y, 0., 1.)) || settings.cursor.windows(2).any(|p| p[0].t > p[1].t) { return Err("Trilha de cursor inválida.".into()); }
        let Some(destination) = choose(&app, "save-video")? else { return Ok(false) };
        if destination.canonicalize().ok().as_deref() == Some(Path::new(&media.path)) { return Err("Não é possível sobrescrever o vídeo original.".into()); }
        acquire(&app)?;
        let result = (|| {
            let folder = app.path().app_cache_dir().map_err(|e| e.to_string())?; std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let path = folder.join(format!("export-{}.json", timestamp()?));
            let job = json!({ "source": media.path, "destination": destination, "start": settings.start, "end": settings.end, "appearance": settings.appearance, "keys": settings.keys, "cursor": settings.cursor, "cursorCaptured": media.cursor_captured, "assetsRoot": asset_root(&app)? });
            std::fs::write(&path, serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            Ok::<_, String>(path)
        })();
        match result { Ok(path) => { spawn_operation(app, "export", path, true); Ok(true) }, Err(error) => { app.state::<Recorder>().busy.store(false, Ordering::SeqCst); Err(error) } }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn reveal_clip(state: tauri::State<Recorder>) -> Result<(), String> {
    let path = state.latest.lock().map_err(|e| e.to_string())?.clone().ok_or("Nenhum arquivo disponível.")?;
    crate::capture::reveal(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn validates_edit_boundaries() {
        assert!(validate_trim(0., 2., 2.).is_ok());
        for (start, end) in [(1., 0.), (-1., 1.), (0., 3.), (f64::NAN, 1.), (0., 0.01)] { assert!(validate_trim(start, end, 2.).is_err()); }
        let mut a = Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, background_blur: None, cursor_motion: None, camera_spring: None };
        assert!(validate_appearance(&a).is_ok()); a.padding = f64::INFINITY; assert!(validate_appearance(&a).is_err());
    }
    #[test] fn project_package_moves_with_its_media_and_keeps_a_backup() {
        let folder = std::env::temp_dir().join(format!("frame-package-test-{}", timestamp().unwrap()));
        std::fs::create_dir(&folder).unwrap();
        let original = folder.join("original.mov"); std::fs::write(&original, b"synthetic-video").unwrap();
        let media = Media { path: original.to_string_lossy().into_owned(), duration: 3., width: 1280, height: 800, cursor: vec![Pointer { t: 0., x: 0.5, y: 0.5, down: false }], cursor_captured: true };
        let mut project = Project { version: 1, name: "Example".into(), media_path: media.path.clone(), zooms: vec![], appearance: Appearance { background: 0, padding: 9., radius: 12., shadow: 35., cursor_size: 24., smooth: true, aspect: "auto".into(), colors: None, background_mode: None, cursor_smooth: None, wallpaper: None, cursor_asset: None, background_blur: None, cursor_motion: None, camera_spring: None }, trim: Trim { start: 0., end: 3. } };
        let package = folder.join("Example.framestudio");
        create_package(&package, &project, &media).unwrap();
        assert!(create_package(&package, &project, &media).is_err(), "Save As must not replace an existing package");
        std::fs::remove_file(&original).unwrap();
        let moved = folder.join("Moved.framestudio"); std::fs::rename(&package, &moved).unwrap();
        let (saved, source) = read_document(&moved).unwrap();
        assert_eq!(saved.version, 2); assert_eq!(saved.media_path, "media/recording.mov");
        assert_eq!(std::fs::read(&source).unwrap(), b"synthetic-video");
        assert!(source.with_extension("cursor.json").is_file());
        project.name = "Renamed".into(); write_manifest(&moved, &project, &source).unwrap();
        let backup: Project = serde_json::from_slice(&std::fs::read(moved.join("project.json.bak")).unwrap()).unwrap();
        assert_eq!(backup.name, "Example"); assert_eq!(read_document(&moved).unwrap().0.name, "Renamed");
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
