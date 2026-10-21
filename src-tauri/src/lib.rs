mod capture;
mod benchmark;
mod studio;

use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct Recorder {
    busy: AtomicBool,
    latest: Mutex<Option<PathBuf>>,
    media: Mutex<Option<studio::Media>>,
    control: Mutex<Option<std::process::ChildStdin>>,
    project_path: Mutex<Option<PathBuf>>,
    pending_project: Mutex<Option<PathBuf>>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(Recorder::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![studio::import_video, studio::open_project, studio::save_project, studio::autosave_project, studio::take_pending_project, studio::start_recording, studio::stop_operation, studio::export_video, studio::reveal_clip, studio::studio_asset_root, benchmark::benchmark_config, benchmark::report_preview_benchmark])
        .setup(|app| {
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
                let _ = _webview.eval(include_str!("../../tests/preview-benchmark.js"));
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Recorder>().busy.load(std::sync::atomic::Ordering::SeqCst) { api.prevent_close(); }
            }
        })
        .build(tauri::generate_context!())
        .expect("Falha ao iniciar o aplicativo")
        .run(|app, event| {
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
