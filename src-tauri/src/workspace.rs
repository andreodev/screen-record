use serde::Deserialize;
use tauri::{LogicalSize, Manager};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WorkspaceMode {
    Recorder,
    Recording,
    Editor,
}

#[tauri::command]
pub(crate) fn set_workspace_mode(app: tauri::AppHandle, mode: WorkspaceMode) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Janela principal indisponível.")?;
    if matches!(mode, WorkspaceMode::Recording) {
        return window.hide().map_err(|e| e.to_string());
    }
    let editor = matches!(mode, WorkspaceMode::Editor);
    let (width, height, min_width, min_height, title) = match mode {
        WorkspaceMode::Recorder => (460., 370., 420., 340., "Frame Studio — Captura"),
        WorkspaceMode::Recording => (360., 138., 360., 138., "Frame Studio — Gravando"),
        WorkspaceMode::Editor => (1280., 820., 900., 650., "Frame Studio"),
    };
    window.unmaximize().map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(LogicalSize::new(min_width, min_height)))
        .map_err(|e| e.to_string())?;
    window.set_decorations(editor).map_err(|e| e.to_string())?;
    window
        .set_resizable(!matches!(mode, WorkspaceMode::Recording))
        .map_err(|e| e.to_string())?;
    window
        .set_always_on_top(!editor)
        .map_err(|e| e.to_string())?;
    window
        .set_content_protected(!editor)
        .map_err(|e| e.to_string())?;
    window.set_title(title).map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if !matches!(mode, WorkspaceMode::Recording) {
        window.center().map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    if !matches!(mode, WorkspaceMode::Recording) {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WindowAction {
    Drag,
    Minimize,
    Close,
}

#[tauri::command]
pub(crate) fn workspace_window_action(
    app: tauri::AppHandle,
    action: WindowAction,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Janela principal indisponível.")?;
    match action {
        WindowAction::Drag => window.start_dragging().map_err(|e| e.to_string()),
        WindowAction::Minimize => window.minimize().map_err(|e| e.to_string()),
        WindowAction::Close => {
            std::thread::spawn(move || crate::studio::request_shutdown(app));
            Ok(())
        }
    }
}
