use std::path::Path;

#[cfg(target_os = "macos")]
pub fn reveal(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open").arg("-R").arg(path)
        .status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Não foi possível abrir o Finder.".into()) }
}

#[cfg(not(target_os = "macos"))]
pub fn reveal(_path: &Path) -> Result<(), String> {
    Err("Abrir a pasta nesta plataforma ainda não foi implementado.".into())
}
