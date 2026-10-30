use tauri::{
    Emitter, Manager, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

pub(crate) struct RecordingTray {
    status: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    show: MenuItem<Wry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Idle,
    Starting,
    Recording,
    Pausing,
    Paused,
    Stopping,
}

pub(crate) fn setup(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(
        app,
        "record-status",
        "Frame Studio · pronto",
        false,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(app, "record-pause", "Pausar gravação", false, None::<&str>)?;
    let stop = MenuItem::with_id(
        app,
        "record-stop",
        "Parar e abrir editor",
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "record-show", "Abrir Frame Studio", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "record-quit", "Sair", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &pause, &stop, &separator, &show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("recording-controls")
        .menu(&menu)
        .tooltip("Frame Studio")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let action = event.id().as_ref().to_owned();
            let app = app.clone();
            std::thread::spawn(move || {
                let result = match action.as_str() {
                    "record-pause" => crate::recording_session::toggle_pause(&app),
                    "record-stop" => crate::studio::stop_operation(app.clone()),
                    "record-show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        Ok(())
                    }
                    "record-quit" => {
                        crate::studio::request_shutdown(app.clone());
                        Ok(())
                    }
                    _ => Ok(()),
                };
                if let Err(error) = result {
                    let _ = app.emit("recording-control-error", error);
                }
            });
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(RecordingTray {
        status,
        pause,
        stop,
        show,
    });
    Ok(())
}

pub(crate) fn update(app: &tauri::AppHandle, phase: Phase) {
    let Some(tray) = app.try_state::<RecordingTray>() else {
        return;
    };
    let text = match phase {
        Phase::Idle => "Frame Studio · pronto",
        Phase::Starting => "Preparando gravação…",
        Phase::Recording => "● Gravando",
        Phase::Pausing => "Pausando captura…",
        Phase::Paused => "Ⅱ Gravação pausada",
        Phase::Stopping => "Finalizando gravação…",
    };
    let _ = tray.status.set_text(text);
    let _ = tray.pause.set_text(if phase == Phase::Paused {
        "Retomar gravação"
    } else {
        "Pausar gravação"
    });
    let _ = tray
        .pause
        .set_enabled(matches!(phase, Phase::Recording | Phase::Paused));
    let _ = tray
        .stop
        .set_enabled(matches!(phase, Phase::Recording | Phase::Paused));
    let _ = tray.show.set_enabled(phase == Phase::Idle);
    if let Some(icon) = app.tray_by_id("recording-controls") {
        let _ = icon.set_tooltip(Some(text));
        if phase == Phase::Idle {
            let _ = icon.set_icon(app.default_window_icon().cloned());
        } else {
            let mut pixels = vec![0u8; 16 * 16 * 4];
            for y in 0i32..16 {
                for x in 0i32..16 {
                    let filled = if phase == Phase::Paused {
                        (4..7).contains(&x) || (9..12).contains(&x)
                    } else {
                        (x - 8).pow(2) + (y - 8).pow(2) <= 28
                    };
                    if filled && (3..14).contains(&y) {
                        let at = ((y * 16 + x) * 4) as usize;
                        pixels[at..at + 4].copy_from_slice(if phase == Phase::Paused {
                            &[244, 194, 80, 255]
                        } else {
                            &[242, 91, 76, 255]
                        });
                    }
                }
            }
            let _ = icon.set_icon(Some(tauri::image::Image::new_owned(pixels, 16, 16)));
        }
    }
}
