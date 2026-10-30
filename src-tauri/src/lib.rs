mod capture;
mod benchmark;
mod studio;
mod recording;
#[cfg(any(windows, test))]
mod typing;
mod camera_preview;
mod workspace;
mod recording_tray;
mod recording_session;
#[cfg(windows)]
pub mod windows_media;

use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct Recorder {
    busy: AtomicBool,
    latest: Mutex<Option<PathBuf>>,
    media: Mutex<Option<studio::Media>>,
    control: Mutex<Option<std::process::ChildStdin>>,
    exit_after_operation: AtomicBool,
    project_path: Mutex<Option<PathBuf>>,
    pending_project: Mutex<Option<PathBuf>>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(Recorder::default())
        .manage(camera_preview::CameraPreview::default())
        .manage(recording_session::RecordingSession::default())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit-safe" { let app = app.clone(); std::thread::spawn(move || studio::request_shutdown(app)); }
        })
        .invoke_handler(tauri::generate_handler![recording_session::toggle_recording_pause, workspace::set_workspace_mode, workspace::workspace_window_action, studio::recent_projects, studio::open_recent_project, studio::analyze_recording_audio, studio::import_subtitles, studio::list_capture_sources, studio::list_recording_devices, studio::import_video, studio::choose_background_audio, studio::open_project, studio::save_project, studio::autosave_project, studio::take_pending_project, camera_preview::camera_preview_snapshot, camera_preview::start_camera_preview, camera_preview::stop_camera_preview, studio::open_camera_settings, studio::open_microphone_settings, studio::start_recording, studio::stop_operation, studio::export_video, studio::reveal_clip, studio::studio_asset_root, studio::open_screen_recording_settings, benchmark::benchmark_config, benchmark::report_preview_benchmark])
        .setup(|app| {
            recording_tray::setup(app)?;
            #[cfg(any(target_os = "macos", target_os = "windows"))] {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                let menu = Menu::default(app.handle())?;
                let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
                let quit = MenuItem::with_id(app, "quit-safe", "Sair do Frame Studio", true, Some("CmdOrCtrl+Q"))?;
                for item in menu.items()? {
                    if let Some(submenu) = item.as_submenu() {
                        for (index, entry) in submenu.items()?.iter().enumerate() {
                            if entry.as_predefined_menuitem().is_some_and(|p| p.text().is_ok_and(|text| text == quit_text)) {
                                submenu.remove_at(index)?; submenu.insert(&quit, index)?;
                            }
                        }
                    }
                }
                app.set_menu(menu)?;
            }
            #[cfg(windows)]
            if let Some(path) = std::env::args_os().skip(1).map(PathBuf::from).find(|p| p.extension().is_some_and(|ext| ext == "framestudio" || ext == "json") && p.exists()) {
                *app.state::<Recorder>().pending_project.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
            }
            if let Some(config) = benchmark::config()? {
                if let Some(project) = config["project"].as_str() { *app.state::<Recorder>().pending_project.lock().unwrap_or_else(|e| e.into_inner()) = Some(PathBuf::from(project));
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("Frame Studio — Teste automático de desempenho");
                        let _ = window.set_always_on_top(true);
                        let _ = window.show(); let _ = window.set_focus();
                    }
                }
            }
            Ok(())
        })
        .on_page_load(|_webview, _payload| {
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var_os("FRAME_STUDIO_BENCHMARK").is_some() {
                if benchmark::config().ok().flatten().is_some_and(|c| c["mode"] == "recording-test") { return; }
                if benchmark::config().ok().flatten().is_some_and(|c| c["mode"] == "floating-preview") {
                    let _ = _webview.eval(include_str!("../../tests/floating-preview-benchmark.js"));
                } else if _webview.label() == "main" { let _ = _webview.eval(include_str!("../../tests/preview-benchmark.js")); }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                api.prevent_close();
                if window.label() == camera_preview::LABEL {
                    if !app.state::<camera_preview::CameraPreview>().recording.load(std::sync::atomic::Ordering::SeqCst) {
                        tauri::async_runtime::spawn(async move { let _ = camera_preview::stop_camera_preview(app).await; });
                    }
                } else { std::thread::spawn(move || studio::request_shutdown(app)); }
            }
        })
        .build(tauri::generate_context!())
        .expect("Falha ao iniciar o aplicativo")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Native OS termination must also let the helper finish its video container.
                app.state::<Recorder>().exit_after_operation.store(true, std::sync::atomic::Ordering::SeqCst);
                if app.state::<Recorder>().busy.load(std::sync::atomic::Ordering::SeqCst) && app.state::<Recorder>().control.lock().is_ok_and(|control| control.is_some()) {
                    let _ = studio::stop_operation(app.clone());
                    while app.state::<Recorder>().busy.load(std::sync::atomic::Ordering::SeqCst) { std::thread::sleep(std::time::Duration::from_millis(10)); }
                }
            }
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if app.state::<Recorder>().busy.load(std::sync::atomic::Ordering::SeqCst) || !app.state::<Recorder>().exit_after_operation.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit(); let app = app.clone(); std::thread::spawn(move || studio::request_shutdown(app));
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::Emitter;
                if let Some(path) = urls.into_iter().filter_map(|u| u.to_file_path().ok()).find(|p| p.extension().is_some_and(|ext| ext == "framestudio")) {
                    *app.state::<Recorder>().pending_project.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
                    let _ = app.emit("project-open-request", ());
                    if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
                }
            }
        });
}
