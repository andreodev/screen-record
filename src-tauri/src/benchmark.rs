// Diagnostics are opt-in in debug builds and never read screen content.
use serde_json::Value;
use std::io::Write;

pub fn config() -> Result<Option<Value>, String> {
    if !cfg!(debug_assertions) { return Ok(None) }
    let Some(path) = std::env::var_os("FRAME_STUDIO_BENCHMARK") else { return Ok(None) };
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if data.len() > 8192 { return Err("Benchmark config is too large".into()); }
    Ok(Some(serde_json::from_slice(&data).map_err(|e| e.to_string())?))
}
#[tauri::command]
pub fn benchmark_config() -> Result<Option<Value>, String> { config() }
#[tauri::command]
pub fn report_preview_benchmark(report: Value) -> Result<(), String> {
    let config = config()?.ok_or("Benchmark diagnostics are disabled")?;
    let path = config["report"].as_str().ok_or("Missing benchmark report path")?;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    writeln!(file, "{}", serde_json::to_string(&report).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
