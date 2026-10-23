// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--media-helper")) {
        std::process::exit(screen_studio_lib::windows_media::main());
    }
    screen_studio_lib::run()
}
