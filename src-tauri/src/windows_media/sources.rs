use super::*;
use windows_sys::Win32::{Foundation::{HWND, LPARAM, POINT, RECT}, Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, ClientToScreen}, UI::WindowsAndMessaging::{EnumWindows, GetClientRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible}};

fn floating_preview(handle: HWND) -> bool {
    let Some(parent) = std::env::var("FRAME_PREVIEW_OWNER_PID").ok().and_then(|v| v.parse::<u32>().ok()) else { return false };
    let mut owner = 0; let mut title = [0u16; 128];
    unsafe { GetWindowThreadProcessId(handle, &mut owner); }
    if owner != parent { return false; }
    let count = unsafe { GetWindowTextW(handle, title.as_mut_ptr(), title.len() as i32) };
    String::from_utf16_lossy(&title[..count.max(0) as usize]) == "Frame Studio — Webcam"
}

unsafe extern "system" fn monitor(handle: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> windows_sys::core::BOOL {
    let values = unsafe { &mut *(data as *mut Vec<Value>) };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(handle, &mut info) } != 0 {
        let r = info.rcMonitor;
        values.push(json!({"id":handle as usize as u64,"kind":"display","label":format!("Monitor {} · {} × {}",values.len()+1,r.right-r.left,r.bottom-r.top),"x":r.left,"y":r.top,"width":r.right-r.left,"height":r.bottom-r.top,"primary":info.dwFlags & 1 != 0}));
    }
    1
}
unsafe extern "system" fn window(handle: HWND, data: LPARAM) -> windows_sys::core::BOOL {
    if unsafe { IsWindowVisible(handle) } == 0 || unsafe { IsIconic(handle) } != 0 || floating_preview(handle) { return 1; }
    let mut title = [0u16; 1024];
    let count = unsafe { GetWindowTextW(handle, title.as_mut_ptr(), title.len() as i32) };
    if count == 0 { return 1; }
    if let Ok((x, y, width, height)) = window_bounds(handle) {
        let values = unsafe { &mut *(data as *mut Vec<Value>) };
        values.push(json!({"id":handle as usize as u64,"kind":"window","label":String::from_utf16_lossy(&title[..count as usize]),"x":x,"y":y,"width":width,"height":height}));
    }
    1
}
fn window_bounds(handle: HWND) -> Result<(i32, i32, i32, i32)> {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let mut origin = POINT { x: 0, y: 0 };
    if unsafe { GetClientRect(handle, &mut rect) } == 0 || unsafe { ClientToScreen(handle, &mut origin) } == 0 || rect.right < 32 || rect.bottom < 32 { return Err("A janela selecionada está indisponível.".into()); }
    Ok((origin.x, origin.y, rect.right, rect.bottom))
}
pub(super) fn list() -> Result<Value> {
    unsafe { windows_sys::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
    let mut displays: Vec<Value> = Vec::new(); let mut windows: Vec<Value> = Vec::new();
    unsafe { EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(monitor), &mut displays as *mut _ as LPARAM); EnumWindows(Some(window), &mut windows as *mut _ as LPARAM); }
    displays.sort_by_key(|value| value["primary"] != true);
    Ok(json!({"event":"sources","displays":displays,"windows":windows}))
}
pub(super) struct Region { pub x: i32, pub y: i32, pub width: i32, pub height: i32, pub input: String, window: Option<HWND> }
impl Region {
    pub fn update(&mut self) {
        if let Some(handle) = self.window {
            if let Ok((x, y, _, _)) = window_bounds(handle) { self.x = x; self.y = y; }
        }
    }
}
pub(super) fn region(options: &crate::recording::RecordingOptions) -> Result<Region> {
    let source = options.source.as_ref();
    if let Some(source) = source.filter(|source| source.kind == "window") {
        let handle = source.id as usize as HWND;
        if floating_preview(handle) { return Err("A prévia da webcam não pode ser usada como fonte de captura.".into()); }
        let (x, y, width, height) = window_bounds(handle)?;
        return Ok(Region { x, y, width, height, input: format!("hwnd={}", source.id), window: Some(handle) });
    }
    let inventory = list()?;
    let displays = inventory["displays"].as_array().ok_or("Nenhum monitor disponível.")?;
    let display = match source { Some(source) => displays.iter().find(|display| display["id"].as_u64() == Some(source.id)), None => displays.first() }.ok_or("O monitor selecionado foi desconectado.")?;
    let mut x = display["x"].as_i64().unwrap() as i32; let mut y = display["y"].as_i64().unwrap() as i32;
    let mut width = display["width"].as_i64().unwrap() as i32; let mut height = display["height"].as_i64().unwrap() as i32;
    if let Some(area) = source.filter(|source| source.kind == "area").and_then(|source| source.area.as_ref()) {
        if area.x + area.width > width as f64 || area.y + area.height > height as f64 { return Err("A área deve ficar dentro do monitor selecionado.".into()); }
        x += area.x as i32; y += area.y as i32; width = area.width as i32; height = area.height as i32;
    }
    Ok(Region { x, y, width, height, input: "desktop".into(), window: None })
}
