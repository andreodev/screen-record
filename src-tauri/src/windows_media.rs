//! Windows media worker. Runs in a child instance of the application, speaking
//! the same newline-delimited JSON protocol as the macOS helper.
mod audio;
mod render;
mod sources;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    match dispatch(&args) {
        Ok(()) => 0,
        Err(error) => {
            emit(json!({"event":"error", "message":error.to_string()}));
            1
        }
    }
}

fn dispatch(args: &[String]) -> Result<()> {
    let arg = |i: usize| -> Result<&String> {
        args.get(i)
            .ok_or_else(|| "Argumento de mídia ausente.".into())
    };
    match args.first().map(String::as_str) {
        Some("sources") => { emit(sources::list()?); Ok(()) }
        Some("devices") => {
            let (outputs, inputs) = audio::devices()?;
            emit(
                json!({"event":"devices", "outputs":outputs,"inputs":inputs,"cameras":camera_devices()?,"supported":true}),
            );
            Ok(())
        }
        Some("analyze-audio") => analyze_audio(Path::new(arg(1)?)),
        Some("inspect") => emit_media(Path::new(arg(1)?)),
        Some("preview") => {
            let destination = Path::new(arg(2)?).join("QuickLook/Preview.png");
            fs::create_dir_all(destination.parent().unwrap())?;
            let output = ffmpeg()?
                .args(["-nostdin", "-i"])
                .arg(arg(1)?)
                .args([
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=960:600:force_original_aspect_ratio=decrease",
                    "-y",
                ])
                .arg(&destination)
                .output()?;
            check_output(output)?;
            emit(json!({"event":"preview", "path":destination}));
            Ok(())
        }
        Some("camera-preview") => camera_preview(args.get(1).map(String::as_str)),
        Some("record") => record(
            Path::new(arg(1)?),
            args.get(2).filter(|s| !s.starts_with("--")).map(Path::new),
            args.contains(&"--system-audio".into()),
            args.contains(&"--microphone".into()),
        ),
        Some("export") => render::export(Path::new(arg(1)?)),
        _ => Err("Comando de mídia desconhecido.".into()),
    }
}

fn emit(value: Value) {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    let _ = serde_json::to_writer(&mut lock, &value);
    let _ = lock.write_all(b"\n");
    let _ = lock.flush();
}

fn tool(name: &str) -> Result<PathBuf> {
    if let Some(path) = std::env::var_os(format!("FRAME_{}", name.to_uppercase())) {
        if Path::new(&path).is_file() {
            return Ok(path.into());
        }
    }
    let mut roots = Vec::new();
    if let Some(root) = std::env::var_os("FRAME_RESOURCES") {
        roots.push(PathBuf::from(root).join("ffmpeg"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.join("ffmpeg"));
        }
    }
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ffmpeg"));
    if let Some(paths) = std::env::var_os("PATH") {
        roots.extend(std::env::split_paths(&paths));
    }
    roots.into_iter().map(|p| p.join(format!("{name}.exe"))).find(|p| p.is_file())
        .ok_or_else(|| format!("{name}.exe não encontrado. Execute scripts/setup-windows.ps1 e recompile o aplicativo.").into())
}

fn ffmpeg() -> Result<Command> {
    let mut command = Command::new(tool("ffmpeg")?);
    command
        .creation_flags(0x08000000)
        .args(["-hide_banner", "-loglevel", "error"]);
    Ok(command)
}
fn analyze_audio(path: &Path) -> Result<()> {
    let mut command = ffmpeg()?;
    command.args(["-nostdin", "-i"]).arg(path).args(["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]).stdout(Stdio::piped()).stdin(Stdio::null());
    let mut process = Process::spawn(&mut command)?;
    let mut output = BufReader::new(process.child.stdout.take().ok_or("Áudio indisponível.")?);
    let mut levels = Vec::new(); let mut count = 0usize; let mut sum = 0f64; let mut samples = 0usize;
    loop {
        let mut raw = [0u8; 4];
        match output.read_exact(&mut raw) { Ok(()) => {}, Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break, Err(error) => return Err(error.into()) }
        let value = f32::from_le_bytes(raw) as f64;
        sum += if value.is_finite() { value * value } else { 0. }; count += 1; samples += 1;
        if count == 800 { levels.push((sum / count as f64).sqrt()); count = 0; sum = 0.; }
        if samples > 8000 * 14400 { return Err("A análise aceita áudio de até 4 horas.".into()); }
    }
    process.finish()?;
    if count > 0 { levels.push((sum / count as f64).sqrt()); }
    if samples == 0 { return Err("Nenhum áudio encontrado para analisar.".into()); }
    emit(json!({"event":"analysis","step":0.1,"levels":levels,"duration":samples as f64 / 8000.})); Ok(())
}
fn check_output(output: std::process::Output) -> Result<Vec<u8>> {
    if !output.status.success() {
        return Err(format!(
            "Falha no FFmpeg: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(output.stdout)
}

/// Drains stderr concurrently (no pipe deadlocks), bounds error memory, and
/// always reaps the worker on early return or cancellation.
struct Process {
    child: Child,
    error: Arc<Mutex<VecDeque<u8>>>,
}
impl Process {
    fn spawn(command: &mut Command) -> Result<Self> {
        let mut child = command.stderr(Stdio::piped()).spawn()?;
        let error = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(mut stderr) = child.stderr.take() {
            let error = error.clone();
            thread::spawn(move || {
                let mut buf = [0; 4096];
                while let Ok(n) = stderr.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut tail) = error.lock() {
                        tail.extend(&buf[..n]);
                        while tail.len() > 8192 {
                            tail.pop_front();
                        }
                    }
                }
            });
        }
        Ok(Self { child, error })
    }
    fn message(&self) -> String {
        String::from_utf8_lossy(
            &self
                .error
                .lock()
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
        )
        .trim()
        .to_owned()
    }
    fn finish(&mut self) -> Result<()> {
        if !self.child.wait()?.success() {
            return Err(format!("Falha no FFmpeg: {}", self.message()).into());
        }
        Ok(())
    }
    fn wait_cancel(&mut self, cancelled: &AtomicBool) -> Result<()> {
        loop {
            ensure_running(cancelled)?;
            if let Some(status) = self.child.try_wait()? {
                if !status.success() {
                    return Err(format!("Falha no FFmpeg: {}", self.message()).into());
                }
                return Ok(());
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn stop_signal() -> Arc<AtomicBool> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    thread::spawn(move || {
        let _ = io::stdin().lock().lines().next();
        flag.store(true, Ordering::SeqCst);
    });
    stop
}
fn ensure_running(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::SeqCst) {
        Err("Exportação cancelada.".into())
    } else {
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    t: f64,
    x: f64,
    y: f64,
    down: bool,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    right_down: bool,
    #[serde(default)]
    middle_down: bool,
    #[serde(default)]
    typing: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Clip {
    start: f64,
    end: f64,
    #[serde(default = "one")]
    speed: f64,
    #[serde(default)]
    hide_cursor: bool,
    #[serde(default)]
    cursor_original: bool,
}
fn one() -> f64 {
    1.
}
impl Clip {
    fn duration(&self) -> f64 {
        (self.end - self.start) / self.speed
    }
}
#[derive(Clone, Copy, Deserialize)]
struct Key {
    t: f64,
    x: f64,
    y: f64,
    scale: f64,
    #[serde(default)]
    cut: bool,
}

fn inspect(path: &Path) -> Result<Value> {
    let mut command = Command::new(tool("ffprobe")?);
    let output = command
        .creation_flags(0x08000000)
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(path)
        .output()?;
    let probe: Value = serde_json::from_slice(&check_output(output)?)?;
    let streams = probe["streams"]
        .as_array()
        .ok_or("Metadados de mídia inválidos.")?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or("O arquivo não contém vídeo.")?;
    let duration = probe["format"]["duration"]
        .as_str()
        .or(video["duration"].as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or("Duração de vídeo inválida.")?;
    if !duration.is_finite() || !(0. ..=86400.).contains(&duration) || duration == 0. {
        return Err("Duração de vídeo inválida ou maior que 24 horas.".into());
    }
    let mut width = video["width"].as_u64().unwrap_or(0);
    let mut height = video["height"].as_u64().unwrap_or(0);
    let rotation = video["side_data_list"]
        .as_array()
        .and_then(|a| a.iter().find_map(|s| s["rotation"].as_i64()))
        .unwrap_or(0);
    if rotation.abs() % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    if width == 0 || height == 0 || width > 32768 || height > 32768 {
        return Err("Dimensões de vídeo inválidas.".into());
    }
    let sidecar = path.with_extension("cursor.json");
    let mut cursor = Vec::<Pointer>::new();
    let mut captured = false;
    if fs::metadata(&sidecar).is_ok_and(|m| m.len() <= 50_000_000) {
        if let Ok(events) = serde_json::from_slice::<Vec<Pointer>>(&fs::read(&sidecar)?) {
            if events.iter().all(|p| {
                p.t.is_finite()
                    && p.t >= 0.
                    && p.t <= duration + 1.
                    && p.x.is_finite()
                    && p.y.is_finite()
                    && (0. ..=1.).contains(&p.x)
                    && (0. ..=1.).contains(&p.y)
            }) && events.windows(2).all(|p| p[0].t <= p[1].t)
            {
                cursor = events;
                captured = true;
            }
        }
    }
    Ok(
        json!({"path":path, "duration":duration, "width":width, "height":height, "cursor":cursor, "cursorCaptured":captured, "hasAudio":streams.iter().any(|s| s["codec_type"] == "audio")}),
    )
}
fn emit_media(path: &Path) -> Result<()> {
    emit(json!({"event":"media", "media":inspect(path)?}));
    Ok(())
}

fn camera_devices() -> Result<Vec<Value>> {
    let output = ffmpeg()?
        .args([
            "-loglevel",
            "info",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .output()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let mut result = Vec::new();
    let mut video = false;
    for line in text.lines() {
        if line.contains("(video)") {
            video = true;
            if let Some(label) = line.split('"').nth(1) {
                result.push(json!({"id":label,"label":label,"isDefault":result.is_empty()}));
            }
        } else if line.contains("(audio)") {
            video = false;
        } else if video && line.contains("Alternative name") {
            if let (Some(device), Some(id)) = (result.last_mut(), line.split('"').nth(1)) {
                device["id"] = json!(id);
            }
            video = false;
        }
    }
    Ok(result)
}
fn choose_camera(selected: Option<&str>) -> Result<String> {
    let devices = camera_devices()?;
    let device = if let Some(id) = selected.filter(|id| !id.is_empty()) {
        devices.iter().find(|d| d["id"] == id || d["label"] == id)
    } else {
        devices.first()
    };
    device.and_then(|d| d["id"].as_str()).map(str::to_owned)
        .ok_or_else(|| "A webcam selecionada não está disponível. Atualize os dispositivos e verifique a conexão e a permissão da câmera.".into())
}
fn camera_command(device: &str) -> Result<Command> {
    // Negotiate a raw mode: some UVC cameras advertise MJPEG by default but
    // deliver empty JPEG packets. Use only modes the driver actually lists.
    let options = ffmpeg()?
        .args([
            "-loglevel",
            "info",
            "-list_options",
            "true",
            "-f",
            "dshow",
            "-i",
        ])
        .arg(format!("video={device}"))
        .output()?;
    let modes = String::from_utf8_lossy(&options.stderr);
    let mut candidates = Vec::new();
    for line in modes.lines() {
        let format = line.split_whitespace().find_map(|s| {
            s.strip_prefix("pixel_format=")
                .map(|f| ("-pixel_format", f, true))
                .or_else(|| s.strip_prefix("vcodec=").map(|f| ("-vcodec", f, false)))
        });
        let Some((flag, format, raw)) = format else {
            continue;
        };
        let Some(size) = line
            .split("min s=")
            .nth(1)
            .and_then(|s| s.split_whitespace().next())
        else {
            continue;
        };
        let Some((w, h)) = size
            .split_once('x')
            .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        else {
            continue;
        };
        let fps = line
            .split("fps=")
            .nth(1)
            .and_then(|s| s.split_whitespace().next())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(30.);
        if w > 0 && h > 0 && w <= 1280 && h <= 720 && fps > 0. {
            candidates.push((
                raw,
                w * h,
                flag.to_owned(),
                format.to_owned(),
                size.to_owned(),
                fps,
            ));
        }
    }
    candidates.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
    let mut command = ffmpeg()?;
    command.args([
        "-thread_queue_size",
        "512",
        "-f",
        "dshow",
        "-rtbufsize",
        "256M",
    ]);
    if let Some((_, _, flag, format, size, fps)) = candidates.first() {
        command
            .arg(flag)
            .arg(format)
            .arg("-video_size")
            .arg(size)
            .arg("-framerate")
            .arg(fps.min(30.).to_string());
    }
    command.arg("-i").arg(format!("video={device}"));
    Ok(command)
}
fn camera_preview(selected: Option<&str>) -> Result<()> {
    let stop = stop_signal();
    let mut command = camera_command(&choose_camera(selected)?)?;
    command
        .args([
            "-an",
            "-vf",
            "fps=10,scale=480:-2",
            "-c:v",
            "mjpeg",
            "-q:v",
            "5",
            "-f",
            "image2pipe",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped());
    let mut process = Process::spawn(&mut command)?;
    let stdout = process.child.stdout.take().ok_or("Prévia indisponível.")?;
    let (tx, rx) = mpsc::sync_channel(2);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut frame = Vec::new();
        let mut buf = [0; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            for byte in &buf[..n] {
                frame.push(*byte);
                if frame.ends_with(&[0xff, 0xd9]) {
                    if tx.send(std::mem::take(&mut frame)).is_err() {
                        return;
                    }
                }
                if frame.len() > 4_000_000 {
                    return;
                }
            }
        }
    });
    let mut last = Instant::now();
    while !stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => { emit(json!({"event":"camera-frame", "data":base64::engine::general_purpose::STANDARD.encode(frame)})); last = Instant::now(); }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(format!("Não foi possível abrir a webcam. {}", process.message()).into()),
            _ if last.elapsed() > Duration::from_secs(20) => return Err("A webcam não enviou imagens. Feche outros aplicativos que estejam usando a câmera.".into()),
            _ => {}
        }
    }
    Ok(())
}

fn record(path: &Path, webcam: Option<&Path>, system_audio: bool, microphone: bool) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::POINT,
        UI::{
            HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext},
            Input::KeyboardAndMouse::*,
            WindowsAndMessaging::*,
        },
    };
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let stop = stop_signal();
    let options: crate::recording::RecordingOptions = std::env::var("FRAME_CAPTURE_OPTIONS")
        .ok()
        .map(|s| serde_json::from_str(&s))
        .transpose()?
        .unwrap_or_default();
    options.validate()?;
    let mut region = sources::region(&options)?;
    let width = region.width; let height = region.height;
    let resolution = options.resolution.unwrap_or(2160) as f64;
    let fps = options.fps.unwrap_or(60);
    let scale = (resolution * 16. / 9. / width.max(height) as f64).min(resolution / width.min(height) as f64).min(1.);
    let out_width = ((width as f64 * scale / 2.).floor() as u32 * 2).max(2);
    let out_height = ((height as f64 * scale / 2.).floor() as u32 * 2).max(2);
    let mut camera_input = if webcam.is_some() {
        Some(camera_command(&choose_camera(
            options.camera_device.as_deref(),
        )?)?)
    } else {
        None
    };
    let start = Arc::new(Mutex::new(None));
    let audio =
        audio::RecordingAudio::start(path, system_audio, microphone, start.clone(), &options)?;
    let capture = path.with_extension("capture.mov");
    let mut command = ffmpeg()?;
    command.args(["-stats_period", "0.1", "-progress", "pipe:1", "-f", "gdigrab", "-framerate"]).arg(fps.to_string()).args(["-draw_mouse", "0"]);
    if region.input == "desktop" { command.arg("-offset_x").arg(region.x.to_string()).arg("-offset_y").arg(region.y.to_string()); }
    command.arg("-video_size").arg(format!("{width}x{height}")).arg("-i").arg(&region.input).arg("-vf")
        .arg(format!("scale={out_width}:{out_height}"))
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(&capture)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    let mut screen = Process::spawn(&mut command)?;
    let (tx, rx) = mpsc::channel();
    let stdout = screen.child.stdout.take().unwrap();
    thread::spawn(move || {
        for line in BufReader::new(stdout)
            .lines()
            .map_while(std::result::Result::ok)
        {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let mut face = None;
    let mut events = Vec::new();
    let mut typing = crate::typing::TypingActivity::default();
    let mut seconds = 0.;
    let mut begun = None;
    let launched = Instant::now();
    let hand = unsafe { LoadCursorW(std::ptr::null_mut(), IDC_HAND) };
    let text = unsafe { LoadCursorW(std::ptr::null_mut(), IDC_IBEAM) };
    while !stop.load(Ordering::SeqCst) {
        while let Ok(line) = rx.try_recv() {
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<f64>().ok())
            {
                seconds = value / 1_000_000.;
            }
            if line
                .strip_prefix("frame=")
                .is_some_and(|n| n.trim().parse::<u64>().unwrap_or(0) > 0)
                && begun.is_none()
            {
                let now = Instant::now();
                begun = Some(now);
                *start.lock().unwrap() = Some(now);
                if let (Some(mut command), Some(destination)) = (camera_input.take(), webcam) {
                    command
                        .args([
                            "-an",
                            "-vf",
                            "scale=1280:720:force_original_aspect_ratio=decrease",
                            "-c:v",
                            "libx264",
                            "-preset",
                            "ultrafast",
                            "-tune",
                            "zerolatency",
                            "-crf",
                            "20",
                            "-pix_fmt",
                            "yuv420p",
                            "-y",
                        ])
                        .arg(destination)
                        .args([
                            "-map",
                            "0:v:0",
                            "-an",
                            "-vf",
                            "fps=10,scale=480:-2",
                            "-c:v",
                            "mjpeg",
                            "-q:v",
                            "5",
                            "-flush_packets",
                            "1",
                            "-f",
                            "image2pipe",
                            "pipe:1",
                        ])
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped());
                    let mut camera = Process::spawn(&mut command)?;
                    let mut reader = BufReader::new(camera.child.stdout.take().unwrap());
                    thread::spawn(move || {
                        let mut bytes = [0; 8192];
                        let mut frame = Vec::new();
                        while let Ok(n) = reader.read(&mut bytes) {
                            if n == 0 {
                                break;
                            }
                            for byte in &bytes[..n] {
                                frame.push(*byte);
                                if frame.ends_with(&[0xff, 0xd9]) {
                                    emit(
                                        json!({"event":"camera-frame","data":base64::engine::general_purpose::STANDARD.encode(&frame)}),
                                    );
                                    frame.clear();
                                }
                                if frame.len() > 4_000_000 {
                                    return;
                                }
                            }
                        }
                    });
                    face = Some(camera);
                }
                emit(json!({"event":"started"}));
            }
            if line.starts_with("progress=") && begun.is_some() {
                emit(json!({"event":"recording-time", "seconds":seconds}));
            }
        }
        if let Some(now) = begun {
            let mut point = POINT { x: 0, y: 0 };
            let mut info: CURSORINFO = unsafe { std::mem::zeroed() };
            info.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
            unsafe {
                GetCursorPos(&mut point);
                GetCursorInfo(&mut info);
            }
            let pressed = |key: u16| unsafe { GetAsyncKeyState(key as i32) < 0 };
            let time = now.elapsed().as_secs_f64();
            region.update();
            events.push(Pointer {
                t: time,
                x: ((point.x - region.x) as f64 / width as f64).clamp(0., 1.),
                y: ((point.y - region.y) as f64 / height as f64).clamp(0., 1.),
                down: pressed(VK_LBUTTON),
                right_down: pressed(VK_RBUTTON),
                middle_down: pressed(VK_MBUTTON),
                kind: Some(
                    if info.hCursor == hand {
                        "hand"
                    } else if info.hCursor == text {
                        "text"
                    } else {
                        "pointer"
                    }
                    .into(),
                ),
                typing: typing.sample(time, pressed),
            });
        } else if launched.elapsed() > Duration::from_secs(20) {
            return Err("A captura do desktop não iniciou em 20 segundos.".into());
        }
        if screen.child.try_wait()?.is_some() {
            return Err(format!("A captura foi interrompida. {}", screen.message()).into());
        }
        if let Some(face) = &mut face {
            if face.child.try_wait()?.is_some() {
                return Err(format!("A webcam foi interrompida. {}", face.message()).into());
            }
        }
        audio.check()?;
        thread::sleep(Duration::from_micros(8333));
    }
    if let Some(mut stdin) = screen.child.stdin.take() {
        let _ = stdin.write_all(b"q\n");
    }
    if let Some(face) = &mut face {
        if let Some(mut stdin) = face.child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
        }
    }
    screen.finish()?;
    if let Some(mut face) = face {
        face.finish()?;
    }
    let duration = inspect(&capture)?["duration"]
        .as_f64()
        .ok_or("Gravação sem duração.")?;
    emit(json!({"event":"recording-time", "seconds":duration}));
    audio.finish(path, &capture, duration)?;
    events.retain(|p| p.t <= duration);
    fs::write(
        path.with_extension("cursor.json"),
        serde_json::to_vec(&events)?,
    )?;
    let _ = fs::remove_file(&capture);
    emit_media(path)
}

struct WorkDir(PathBuf);
impl WorkDir {
    fn new(parent: &Path) -> Result<Self> {
        let id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = parent.join(format!(".frame-windows-{}-{id}", std::process::id()));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn value_number(value: &Value, key: &str, default: f64) -> f64 {
    value[key].as_f64().unwrap_or(default)
}
fn value_str<'a>(value: &'a Value, key: &str, default: &'a str) -> &'a str {
    value[key].as_str().unwrap_or(default)
}
