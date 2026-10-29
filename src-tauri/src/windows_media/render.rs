use super::*;
use image::{RgbaImage, imageops};
use std::collections::HashMap;
use tiny_skia::{FillRule, Mask, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    quality: Option<String>,
    source: PathBuf,
    destination: PathBuf,
    start: f64,
    end: f64,
    appearance: Value,
    keys: Vec<Key>,
    cursor: Vec<Pointer>,
    #[serde(default)]
    raw_cursor: Vec<Pointer>,
    #[serde(default)]
    cursor_captured: bool,
    assets_root: PathBuf,
    resolution: u32,
    fps: u32,
    ranges: Option<Vec<Clip>>,
    #[serde(default)]
    effects: Vec<Value>,
    #[serde(default)]
    annotation_images: HashMap<String, String>,
    #[serde(default)]
    cursor_activity: Vec<f64>,
    background_audio: Option<Value>,
    microphone: Option<Value>,
    webcam: Option<Value>,
    source_volume: Option<f64>,
}

pub(super) fn export(path: &Path) -> Result<()> {
    let job: Job = serde_json::from_slice(&fs::read(path)?)?;
    if ![480, 720, 1080, 1440, 2160].contains(&job.resolution) || ![24, 30, 60].contains(&job.fps) {
        return Err("Formato de exportação inválido.".into());
    }
    if job.source.canonicalize()?
        == job
            .destination
            .canonicalize()
            .unwrap_or_else(|_| job.destination.clone())
    {
        return Err("Não é possível sobrescrever o vídeo original.".into());
    }
    let ranges = job.ranges.clone().unwrap_or_else(|| {
        vec![Clip {
            start: job.start,
            end: job.end,
            speed: 1.,
            hide_cursor: false,
            cursor_original: false,
        }]
    });
    if ranges.is_empty()
        || ranges.iter().any(|r| {
            !r.start.is_finite()
                || !r.end.is_finite()
                || !r.speed.is_finite()
                || r.start < job.start
                || r.end > job.end + 0.000001
                || r.end <= r.start
                || !(0.25..=4.).contains(&r.speed)
        })
        || ranges.windows(2).any(|r| r[0].end > r[1].start)
    {
        return Err("Cortes inválidos.".into());
    }
    let duration: f64 = ranges.iter().map(Clip::duration).sum();
    if !duration.is_finite() || !(0.1..=345600.).contains(&duration) {
        return Err("Duração de exportação inválida.".into());
    }
    let cancel = stop_signal();
    let source = inspect(&job.source)?;
    let sw = source["width"].as_u64().unwrap() as u32;
    let sh = source["height"].as_u64().unwrap() as u32;
    let (width, height) = dimensions(
        sw as f64 * value_number(&job.appearance["crop"], "width", 1.),
        sh as f64 * value_number(&job.appearance["crop"], "height", 1.),
        job.resolution,
        value_str(&job.appearance, "aspect", "auto"),
    );
    let work = WorkDir::new(job.destination.parent().ok_or("Destino inválido.")?)?;
    let codec = job.codec.as_deref().unwrap_or("h264"); let quality = job.quality.as_deref().unwrap_or("high");
    if !["h264", "hevc", "prores-lt", "prores", "prores-hq", "prores-4444"].contains(&codec) || !["web", "balanced", "high"].contains(&quality) { return Err("Codec ou qualidade inválidos.".into()); }
    let extension = if codec.starts_with("prores") { "mov" } else { "mp4" };
    let silent = work.0.join(format!("video.{extension}"));
    let mut renderer = Renderer::new(&job, sw, sh, width, height)?;
    let mut encoder_command = ffmpeg()?;
    encoder_command.args(["-f", "rawvideo", "-pixel_format", "rgba", "-video_size"]).arg(format!("{width}x{height}")).arg("-framerate").arg(job.fps.to_string()).args(["-i", "pipe:0", "-an"]);
    if codec.starts_with("prores") {
        let profile = match codec { "prores-lt" => "1", "prores-hq" => "3", "prores-4444" => "4", _ => "2" };
        encoder_command.args(["-c:v", "prores_ks", "-profile:v", profile, "-pix_fmt", if codec == "prores-4444" { "yuva444p10le" } else { "yuv422p10le" }]);
    } else {
        encoder_command.args(["-c:v", if codec == "hevc" { "libx265" } else { "libx264" }, "-preset", "fast", "-crf", match quality { "web" => "26", "balanced" => "22", _ => "18" }, "-pix_fmt", "yuv420p"]);
        if codec == "hevc" { encoder_command.args(["-tag:v", "hvc1"]); }
    }
    encoder_command.args(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", "-y"]).arg(&silent).stdin(Stdio::piped()).stdout(Stdio::null());
    let mut encoder = Process::spawn(&mut encoder_command)?;
    let mut writer = encoder.child.stdin.take().unwrap();
    let mut offset = 0.;
    let mut frame_index = 0u64;
    let mut progress = -1;
    let webcam_info = job
        .webcam
        .as_ref()
        .map(|w| inspect(Path::new(value_str(w, "path", ""))))
        .transpose()?;
    for range in &ranges {
        ensure_running(&cancel)?;
        let end_frame = ((offset + range.duration()) * job.fps as f64).round() as u64;
        let count = end_frame.saturating_sub(frame_index);
        let mut decoder = Decoder::new(&job.source, range, sw, sh, job.fps, count)?;
        let mut webcam = if let (Some(camera), Some(info)) = (&job.webcam, &webcam_info) {
            let camera_duration = info["duration"].as_f64().unwrap();
            // A separately captured camera can end a few frames before the
            // screen. Retain its final frame through the remaining timeline.
            let camera_range = Clip {
                start: range.start.min((camera_duration - 0.2).max(0.)),
                end: range.end.min(camera_duration),
                ..range.clone()
            };
            Some(Decoder::new(
                Path::new(value_str(camera, "path", "")),
                &camera_range,
                info["width"].as_u64().unwrap() as u32,
                info["height"].as_u64().unwrap() as u32,
                job.fps,
                count,
            )?)
        } else {
            None
        };
        for local in 0..count {
            ensure_running(&cancel)?;
            let time = (range.start + local as f64 / job.fps as f64 * range.speed).min(range.end);
            let frame = decoder.frame()?;
            let face = webcam.as_mut().map(Decoder::frame).transpose()?;
            let output = renderer.frame(&job, &frame, face.as_ref(), time, range)?;
            writer
                .write_all(output.data())
                .map_err(|e| format!("Encoder interrompido: {e}. {}", encoder.message()))?;
            frame_index += 1;
            let pct = (90. * frame_index as f64 / (duration * job.fps as f64)).floor() as i32;
            if pct != progress {
                progress = pct;
                emit(json!({"event":"progress", "progress":pct.min(90)}));
            }
        }
        offset += range.duration();
    }
    drop(writer);
    encoder.wait_cancel(&cancel)?;
    emit(json!({"event":"progress", "progress":92}));
    let audio = export_audio(
        &job,
        &ranges,
        duration,
        source["hasAudio"] == true,
        &work.0,
        &cancel,
    )?;
    let final_path = work.0.join(format!("finished.{extension}"));
    let mut mux = ffmpeg()?;
    mux.args(["-nostdin", "-i"]).arg(&silent);
    if let Some(audio) = &audio {
        mux.arg("-i")
            .arg(audio)
            .args(["-map", "0:v:0", "-map", "1:a:0"]);
    }
    mux.args(["-c", "copy", "-t"])
        .arg(duration.to_string())
        .args(["-movflags", "+faststart", "-y"])
        .arg(&final_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    Process::spawn(&mut mux)?.wait_cancel(&cancel)?;
    ensure_running(&cancel)?;
    // Publish only a complete export; failed/cancelled jobs preserve any existing destination.
    fs::rename(&final_path, &job.destination)?;
    emit(json!({"event":"progress", "progress":100}));
    emit(json!({"event":"exported", "path":job.destination}));
    Ok(())
}

struct Decoder {
    process: Process,
    reader: std::process::ChildStdout,
    width: u32,
    height: u32,
    held: Option<Pixmap>,
}
impl Decoder {
    fn new(
        path: &Path,
        range: &Clip,
        width: u32,
        height: u32,
        fps: u32,
        frames: u64,
    ) -> Result<Self> {
        let mut command = ffmpeg()?;
        command.args(["-nostdin", "-ss"]).arg(range.start.to_string()).arg("-t").arg((range.end-range.start).to_string()).arg("-i").arg(path)
            .arg("-vf").arg(format!("setpts=(PTS-STARTPTS)/{},fps={fps},scale={width}:{height},tpad=stop_mode=clone:stop_duration=1",range.speed))
            .arg("-frames:v").arg(frames.to_string()).args(["-an", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]).stdin(Stdio::null()).stdout(Stdio::piped());
        let mut process = Process::spawn(&mut command)?;
        let reader = process.child.stdout.take().unwrap();
        Ok(Self {
            process,
            reader,
            width,
            height,
            held: None,
        })
    }
    fn frame(&mut self) -> Result<Pixmap> {
        let mut frame =
            Pixmap::new(self.width, self.height).ok_or("Sem memória para decodificar vídeo.")?;
        match self.reader.read_exact(frame.data_mut()) {
            Ok(()) => {
                self.held = Some(frame.clone());
                Ok(frame)
            }
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                self.process.finish()?;
                self.held
                    .clone()
                    .ok_or_else(|| "O vídeo não contém frames no trecho selecionado.".into())
            }
            Err(e) => Err(e.into()),
        }
    }
}

fn dimensions(sw: f64, sh: f64, resolution: u32, aspect: &str) -> (u32, u32) {
    let ratio = match aspect {
        "16:9" => 16. / 9.,
        "9:16" => 9. / 16.,
        "1:1" => 1.,
        _ => sw / sh,
    };
    let short = resolution as f64;
    let long = short * 16. / 9.;
    let (mw, mh) = if ratio >= 1. {
        (long, short)
    } else {
        (short, long)
    };
    let w = ((mw.min(mh * ratio) / 2.).round() as u32 * 2).max(2);
    let h = ((w as f64 / ratio / 2.).round() as u32 * 2).max(2);
    (w, h)
}

fn camera(time: f64, keys: &[Key]) -> Key {
    if keys.is_empty() {
        return Key {
            t: time,
            x: 0.5,
            y: 0.5,
            scale: 1.,
            cut: false,
        };
    }
    let next = keys.partition_point(|k| k.t <= time);
    let a = keys[next.saturating_sub(1)];
    let b = keys[next.min(keys.len() - 1)];
    let u = if b.t > a.t && !b.cut {
        ((time - a.t) / (b.t - a.t)).clamp(0., 1.)
    } else {
        0.
    };
    Key {
        t: time,
        x: mix(a.x, b.x, u),
        y: mix(a.y, b.y, u),
        scale: mix(a.scale, b.scale, u),
        cut: false,
    }
}
fn pointer(time: f64, events: &[Pointer]) -> Option<Pointer> {
    if events.is_empty() {
        return None;
    }
    let next = events.partition_point(|p| p.t <= time);
    let a = &events[next.saturating_sub(1)];
    let b = &events[next.min(events.len() - 1)];
    let u = if b.t > a.t {
        ((time - a.t) / (b.t - a.t)).clamp(0., 1.)
    } else {
        0.
    };
    Some(Pointer {
        t: time,
        x: mix(a.x, b.x, u),
        y: mix(a.y, b.y, u),
        ..a.clone()
    })
}
fn mix(a: f64, b: f64, u: f64) -> f64 {
    a + (b - a) * u
}

struct Renderer {
    width: u32,
    height: u32,
    sw: u32,
    sh: u32,
    vw: f64,
    vh: f64,
    span_x: f64,
    span_y: f64,
    background: Pixmap,
    cursors: HashMap<String, (Pixmap, f64, f64, f64)>,
    cuts: Vec<f64>,
    annotations: HashMap<String, Pixmap>,
    clicks: Vec<Pointer>,
}
impl Renderer {
    fn new(job: &Job, sw: u32, sh: u32, width: u32, height: u32) -> Result<Self> {
        let a = &job.appearance;
        let w = width as f64;
        let h = height as f64;
        let padding = w.min(h) * value_number(a, "padding", 9.) / 100.;
        let crop = &a["crop"];
        let crop_width = value_number(crop, "width", 1.);
        let crop_height = value_number(crop, "height", 1.);
        let fit_x = (w - 2. * padding) / (sw as f64 * crop_width);
        let fit_y = (h - 2. * padding) / (sh as f64 * crop_height);
        let fill = a["cropFill"] == true;
        let scale = if fill {
            fit_x.max(fit_y)
        } else {
            fit_x.min(fit_y)
        };
        let vw = sw as f64 * scale;
        let vh = sh as f64 * scale;
        let mut background = Pixmap::new(width, height).ok_or("Sem memória para a composição.")?;
        let palettes = [
            ("25243d", "7c6a9e"),
            ("112e3b", "45a7ac"),
            ("512e53", "eb9a89"),
            ("182b33", "538367"),
            ("171719", "35353c"),
            ("6b3e81", "d574ae"),
        ];
        let palette = palettes[(value_number(a, "background", 0.) as usize).min(5)];
        let colors = a["colors"].as_array();
        let first = color(
            colors
                .and_then(|v| v.first())
                .and_then(Value::as_str)
                .unwrap_or(palette.0),
        );
        let last = if a["backgroundMode"] == "color" {
            first
        } else {
            color(
                colors
                    .and_then(|v| v.get(1))
                    .and_then(Value::as_str)
                    .unwrap_or(palette.1),
            )
        };
        for y in 0..height {
            for x in 0..width {
                let u = (x as f64 / w + y as f64 / h) / 2.;
                let at = ((y * width + x) * 4) as usize;
                for c in 0..3 {
                    background.data_mut()[at + c] =
                        mix(first[c] as f64, last[c] as f64, u).round() as u8;
                }
                background.data_mut()[at + 3] = 255;
            }
        }
        let catalog: Value =
            serde_json::from_slice(&fs::read(job.assets_root.join("catalog.json"))?)?;
        if a["backgroundMode"] == "wallpaper" {
            let entry = catalog["wallpapers"]
                .as_array()
                .and_then(|v| v.iter().find(|v| v["id"] == a["wallpaper"]))
                .ok_or("Wallpaper não encontrado.")?;
            background = cover(
                &load_pixmap(
                    &job.assets_root
                        .join(entry["file"].as_str().ok_or("Wallpaper inválido.")?),
                )?,
                width,
                height,
            )?;
        }
        let blur = value_number(a, "backgroundBlur", 0.);
        if blur > 0. {
            background = blurred(&background, (blur * w / 1920.) as f32)?;
        }
        let mut cursors = HashMap::new();
        let entries = catalog["cursors"]
            .as_array()
            .ok_or("Catálogo de cursores inválido.")?;
        for kind in ["pointer", "hand", "text"] {
            let theme = value_str(a, "cursorTheme", "macos");
            let matches = |group: &str, role: &str| {
                entries.iter().find(|e| {
                    e["group"] == group
                        && e["label"]
                            .as_str()
                            .is_some_and(|s| s.starts_with(&format!("{role}-")))
                })
            };
            let entry = if a["cursorTheme"].is_string() {
                let role = match kind { "hand" => "pointinghand", "text" => "ibeam", _ => kind };
                matches(theme, role)
                    .or_else(|| matches("macos", role))
                    .or_else(|| matches(theme, "pointer"))
            } else {
                entries
                    .iter()
                    .find(|e| e["id"] == a["cursorAsset"])
                    .or_else(|| matches("macos", match kind { "hand" => "pointinghand", "text" => "ibeam", _ => kind }))
            }
            .ok_or("Cursor não encontrado.")?;
            let image = load_pixmap(
                &job.assets_root
                    .join(entry["file"].as_str().ok_or("Cursor inválido.")?),
            )?;
            cursors.insert(
                kind.to_string(),
                (
                    image,
                    value_number(entry, "hotspotX", 0.),
                    value_number(entry, "hotspotY", 0.),
                    value_number(entry, "visibleHeight", 128.),
                ),
            );
        }
        let mut annotations = HashMap::new();
        for (id, encoded) in &job.annotation_images {
            use base64::Engine;
            if encoded.len() > 4_000_000 { return Err("Imagem de anotação muito grande.".into()); }
            let data = base64::engine::general_purpose::STANDARD.decode(encoded)?;
            let reader = image::ImageReader::with_format(std::io::Cursor::new(&data), image::ImageFormat::Png);
            let (width, height) = reader.into_dimensions()?;
            if width == 0 || height == 0 || width > 4096 || height > 4096 || width as u64 * height as u64 > 8_000_000 { return Err("Dimensões de anotação inválidas.".into()); }
            let image = Pixmap::decode_png(&data)?;
            annotations.insert(id.clone(), image);
        }
        for effect in &job.effects {
            if ["text", "arrow", "rectangle", "ellipse", "caption", "watermark"].contains(&value_str(effect, "kind", "")) && !annotations.contains_key(value_str(effect, "id", "")) { return Err("Imagem de anotação ausente.".into()); }
        }
        let mut clicks = Vec::new(); let mut pressed = false;
        for point in if job.raw_cursor.is_empty() { &job.cursor } else { &job.raw_cursor } {
            let down = point.down || point.right_down || point.middle_down;
            if down && !pressed { clicks.push(point.clone()); } pressed = down;
        }
        Ok(Self {
            clicks,
            annotations,
            width,
            height,
            sw,
            sh,
            vw,
            vh,
            span_x: if fill {
                ((w - 2. * padding) / vw).min(crop_width)
            } else {
                crop_width
            },
            span_y: if fill {
                ((h - 2. * padding) / vh).min(crop_height)
            } else {
                crop_height
            },
            background,
            cursors,
            cuts: job.keys.iter().filter(|k| k.cut).map(|k| k.t).collect(),
        })
    }

    fn frame(
        &mut self,
        job: &Job,
        source: &Pixmap,
        face: Option<&Pixmap>,
        time: f64,
        clip: &Clip,
    ) -> Result<Pixmap> {
        let a = &job.appearance;
        let w = self.width as f64;
        let h = self.height as f64;
        let current = camera(time, &job.keys);
        let events = if clip.cursor_original {
            &job.raw_cursor
        } else {
            &job.cursor
        };
        let point = if clip.hide_cursor {
            None
        } else {
            pointer(time, events)
        };
        let blur = &a["motionBlur"];
        let bc = value_number(blur, "cursor", 0.);
        let bz = value_number(blur, "zoom", 0.);
        let bp = value_number(blur, "pan", 0.);
        let max = bc.max(bz).max(bp);
        let count = if max > 0.5 {
            5
        } else if max > 0. {
            3
        } else {
            1
        };
        let next_cut = self.cuts.partition_point(|t| *t <= time);
        let cut = if next_cut > 0 {
            self.cuts[next_cut - 1].max(clip.start)
        } else {
            clip.start
        };
        let past = (time - clip.speed / 60.).max(cut);
        let mut sum = if count > 1 {
            vec![0u16; (self.width * self.height * 4) as usize]
        } else {
            Vec::new()
        };
        let mut layer = Pixmap::new(self.width, self.height).ok_or("Sem memória para o frame.")?;
        for i in 0..count {
            let sample = if count > 1 {
                time - (time - past) * i as f64 / (count - 1) as f64
            } else {
                time
            };
            let previous = camera(sample, &job.keys);
            let mut cam = current;
            if count > 1 {
                cam.scale = mix(current.scale, previous.scale, bz);
                let hx = self.span_x / (2. * cam.scale);
                let hy = self.span_y / (2. * cam.scale);
                cam.x = mix(current.x, previous.x, bp).clamp(hx, 1. - hx);
                cam.y = mix(current.y, previous.y, bp).clamp(hy, 1. - hy);
            }
            let mut p = point.clone();
            if let (Some(p), Some(old)) = (&mut p, pointer(sample, events)) {
                if !p.down && !p.right_down && !p.middle_down {
                    p.x = mix(p.x, old.x, bc);
                    p.y = mix(p.y, old.y, bc);
                }
            }
            layer.fill(tiny_skia::Color::TRANSPARENT);
            let tx = w / 2. - cam.x * self.vw * cam.scale;
            let ty = h / 2. - cam.y * self.vh * cam.scale;
            let sx = self.vw / self.sw as f64 * cam.scale;
            let sy = self.vh / self.sh as f64 * cam.scale;
            layer.draw_pixmap(
                0,
                0,
                source.as_ref(),
                &PixmapPaint {
                    quality: tiny_skia::FilterQuality::Bilinear,
                    ..Default::default()
                },
                Transform::from_row(sx as f32, 0., 0., sy as f32, tx as f32, ty as f32),
                None,
            );
            if job.cursor_captured && value_number(a, "cursorSize", 24.) > 0. {
                if let Some(p) = p {
                    let (cursor, hx, hy, visible) = &self.cursors[p
                        .kind
                        .as_deref()
                        .map(|k| match k { "pointinghand" => "hand", "ibeam" => "text", _ => k })
                        .filter(|k| self.cursors.contains_key(*k))
                        .unwrap_or("pointer")];
                    let index = job.cursor_activity.partition_point(|t| *t <= time);
                    let last = if index > 0 { job.cursor_activity[index - 1] } else { 0. };
                    let opacity = if a["hideIdleCursor"] == true { (1. - (time - last - 1.) / 0.2).clamp(0., 1.) as f32 } else { 1. };
                    let s = value_number(a, "cursorSize", 24.) * w / 1000. * cam.scale / visible;
                    let cx = tx + p.x * self.vw * cam.scale - hx * cursor.width() as f64 * s;
                    let cy = ty + p.y * self.vh * cam.scale - hy * cursor.height() as f64 * s;
                    layer.draw_pixmap(
                        0,
                        0,
                        cursor.as_ref(),
                        &PixmapPaint {
                            opacity,
                            quality: tiny_skia::FilterQuality::Bilinear,
                            ..Default::default()
                        },
                        Transform::from_row(s as f32, 0., 0., s as f32, cx as f32, cy as f32),
                        None,
                    );
                }
            }
            if count > 1 {
                for (total, value) in sum.iter_mut().zip(layer.data()) {
                    *total += *value as u16;
                }
            }
        }
        if count > 1 {
            for (out, total) in layer.data_mut().iter_mut().zip(sum) {
                *out = (total / count as u16) as u8;
            }
        }
        let click = self.clicks.partition_point(|point| point.t <= time);
        if click > 0 && job.cursor_captured && !clip.hide_cursor && value_number(a, "cursorSize", 24.) > 0. && ["circle", "ripple"].contains(&value_str(a, "clickEffect", "none")) {
            let point = &self.clicks[click - 1]; let age = (time - point.t) / 0.35;
            if age < 1. {
                let ripple = a["clickEffect"] == "ripple";
                let radius = value_number(a, "cursorSize", 24.) * w / 1920. * current.scale * if ripple { 0.7 + age * 1.5 } else { 1. };
                let x = w / 2. + (point.x - current.x) * self.vw * current.scale; let y = h / 2. + (point.y - current.y) * self.vh * current.scale;
                if let Some(path) = PathBuilder::from_circle(x as f32, y as f32, radius as f32) {
                    let mut paint = Paint::default(); paint.set_color_rgba8(173, 145, 255, ((1. - age) * 0.65 * 255.) as u8);
                    if ripple { layer.stroke_path(&path, &paint, &Stroke { width: (2. * w / 1920. * current.scale) as f32, ..Stroke::default() }, Transform::identity(), None); }
                    else { layer.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None); }
                }
            }
        }
        let crop = &a["crop"];
        let crop_x = value_number(crop, "x", 0.);
        let crop_y = value_number(crop, "y", 0.);
        let crop_width = value_number(crop, "width", 1.);
        let crop_height = value_number(crop, "height", 1.);
        let left = w / 2. + (crop_x - current.x) * self.vw * current.scale;
        let top = h / 2. + (crop_y - current.y) * self.vh * current.scale;
        let vw = self.vw * current.scale;
        let vh = self.vh * current.scale;
        let radius = value_number(a, "radius", 12.) * w / 1000. * current.scale;
        let mut mask = Mask::new(self.width, self.height).ok_or("Sem memória para a máscara.")?;
        mask.fill_path(
            &rounded(left, top, vw * crop_width, vh * crop_height, radius),
            FillRule::Winding,
            true,
            Transform::identity(),
        );
        for effect in &job.effects {
            if ["caption", "watermark"].contains(&value_str(effect, "kind", "")) { continue; }
            if time < value_number(effect, "start", 0.) || time >= value_number(effect, "end", 0.) {
                continue;
            }
            let x = value_number(effect, "x", 0.5);
            let y = value_number(effect, "y", 0.5);
            let ew = value_number(effect, "width", 0.2) * vw;
            let eh = value_number(effect, "height", 0.2) * vh;
            let x = w / 2. + (x - current.x) * vw - ew / 2.;
            let y = h / 2. + (y - current.y) * vh - eh / 2.;
            let mut em = Mask::new(self.width, self.height).ok_or("Sem memória para o efeito.")?;
            em.fill_path(
                &rounded(x, y, ew, eh, 8. * w / 1920. * current.scale),
                FillRule::Winding,
                true,
                Transform::identity(),
            );
            if effect["kind"] == "mask" {
                let blur = blurred(&layer, (14. * w / 1920.) as f32)?;
                layer.draw_pixmap(
                    0,
                    0,
                    blur.as_ref(),
                    &PixmapPaint::default(),
                    Transform::identity(),
                    Some(&em),
                );
            } else if effect["kind"] == "spotlight" {
                let mut outside = em.clone(); outside.invert();
                let mut paint = Paint::default(); paint.set_color_rgba8(0, 0, 0, (value_number(effect, "opacity", 0.65) * 255.) as u8);
                layer.fill_rect(tiny_skia::Rect::from_xywh(0., 0., w as f32, h as f32).unwrap(), &paint, Transform::identity(), Some(&outside));
            } else if effect["kind"] == "magnifier" {
                let zoom = 2. * vw / self.sw as f64;
                let transform = Transform::from_row(zoom as f32, 0., 0., zoom as f32, (x + ew / 2. - value_number(effect, "x", 0.5) * self.sw as f64 * zoom) as f32, (y + eh / 2. - value_number(effect, "y", 0.5) * self.sh as f64 * zoom) as f32);
                layer.draw_pixmap(0, 0, source.as_ref(), &PixmapPaint::default(), transform, Some(&em));
            } else if let Some(graphic) = self.annotations.get(value_str(effect, "id", "")) {
                let transform = Transform::from_row((ew / graphic.width() as f64) as f32, 0., 0., (eh / graphic.height() as f64) as f32, x as f32, y as f32);
                layer.draw_pixmap(0, 0, graphic.as_ref(), &PixmapPaint { opacity: value_number(effect, "opacity", 1.) as f32, ..PixmapPaint::default() }, transform, None);
            } else {
                let mut paint = Paint::default();
                paint.set_color_rgba8(
                    255,
                    199,
                    41,
                    (value_number(effect, "opacity", 0.28) * 255.) as u8,
                );
                layer.fill_path(
                    &rounded(x, y, ew, eh, 8. * w / 1920.),
                    &paint,
                    FillRule::Winding,
                    Transform::identity(),
                    None,
                );
            }
        }
        let mut output = if a["backgroundMode"] == "video-blur" {
            let bg = cover_region(source, self.width, self.height, crop_x, crop_y, crop_width, crop_height)?;
            let mut bg = blurred(
                &bg,
                (value_number(a, "backgroundBlur", 18.) * w / 1920.) as f32,
            )?;
            for pixel in bg.data_mut().chunks_exact_mut(4) {
                for c in &mut pixel[..3] {
                    *c = (*c as f32 * 0.82) as u8;
                }
            }
            bg
        } else {
            self.background.clone()
        };
        shadow(
            &mut output,
            left,
            top + 12. * w / 1920. * current.scale,
            vw * crop_width,
            vh * crop_height,
            radius,
            18. * w / 1920. * current.scale,
            value_number(a, "shadow", 35.) / 100.,
        );
        output.draw_pixmap(
            0,
            0,
            layer.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            Some(&mask),
        );
        if let (Some(camera), Some(face)) = (&job.webcam, face) {
            self.webcam(
                &mut output,
                camera,
                face,
                time,
                &job.keys,
                &a["cameraMotion"],
            )?;
        }
        for effect in &job.effects {
            if !["caption", "watermark"].contains(&value_str(effect, "kind", "")) || time < value_number(effect, "start", 0.) || time >= value_number(effect, "end", 0.) { continue; }
            if let Some(graphic) = self.annotations.get(value_str(effect, "id", "")) {
                let ew = value_number(effect, "width", 0.8) * w; let eh = value_number(effect, "height", 0.12) * h;
                let x = (value_number(effect, "x", 0.5) - value_number(effect, "width", 0.8) / 2.) * w;
                let y = (value_number(effect, "y", 0.87) - value_number(effect, "height", 0.12) / 2.) * h;
                output.draw_pixmap(0, 0, graphic.as_ref(), &PixmapPaint { opacity: value_number(effect, "opacity", 1.) as f32, ..PixmapPaint::default() }, Transform::from_row((ew / graphic.width() as f64) as f32, 0., 0., (eh / graphic.height() as f64) as f32, x as f32, y as f32), None);
            }
        }
        Ok(output)
    }

    fn webcam(
        &self,
        out: &mut Pixmap,
        camera: &Value,
        face: &Pixmap,
        time: f64,
        keys: &[Key],
        motion: &Value,
    ) -> Result<()> {
        let w = self.width as f64;
        let h = self.height as f64;
        let shape = value_str(camera, "shape", "circle");
        let default_radius = if shape == "circle" {
            0.5
        } else if shape == "square" {
            0.
        } else {
            0.18
        };
        let mut state = [
            value_number(camera, "x", 0.78),
            value_number(camera, "y", 0.78),
            value_number(camera, "size", 0.24),
            value_number(camera, "opacity", 1.),
            value_number(camera, "borderRadius", default_radius),
        ];
        let manual = camera["keyframes"].as_array().filter(|v| !v.is_empty());
        let mode = value_str(
            camera,
            "mode",
            if manual.is_some() { "manual" } else { "static" },
        );
        if mode != "static" {
            if let Some(track) = manual {
                let next = track.partition_point(|k| value_number(k, "t", 0.) < time);
                let a = &track[next.saturating_sub(1)];
                let b = &track[next.min(track.len() - 1)];
                let at = value_number(a, "t", 0.);
                let bt = value_number(b, "t", at);
                let u = if next == 0 {
                    0.
                } else if next >= track.len() {
                    1.
                } else if bt > at {
                    ((time - at) / (bt - at)).clamp(0., 1.)
                } else {
                    0.
                };
                let u = ease(u, value_str(a, "easing", "ease-in-out"));
                for (i, key) in ["x", "y", "size", "opacity", "borderRadius"]
                    .iter()
                    .enumerate()
                {
                    state[i] = mix(
                        value_number(a, key, state[i]),
                        value_number(b, key, state[i]),
                        u,
                    );
                }
            }
        }
        if mode == "static" || manual.is_none() {
            let duration = value_number(camera, "transitionDuration", 0.4);
            let scale = (0..25)
                .map(|i| {
                    camera_at(time - duration * i as f64 / 24., keys)
                        .scale
                        .clamp(1.02, 1.35)
                })
                .sum::<f64>()
                / 25.;
            let u = ease(((scale - 1.02) / 0.33).clamp(0., 1.), "ease-in-out");
            let target = match value_str(camera, "zoomBehavior", "keep") {
                "shrink" => state[2] * 0.65,
                "grow" => state[2] * 1.35,
                "custom" => value_number(camera, "zoomSize", state[2]),
                _ => state[2],
            };
            state[2] = mix(state[2], target, u).clamp(0.08, 0.6);
            if mode == "auto" || mode == "hybrid" {
                let overlap = (state[0] - 0.5).abs() < state[2] / 2. + 0.025
                    && (state[1] - 0.5).abs() < state[2] / 2. + 0.025;
                if overlap {
                    let margin = state[2] / 2. + 0.025;
                    let u = ease(
                        ((scale - if mode == "auto" { 1.05 } else { 1.08 })
                            / if mode == "auto" { 0.45 } else { 0.42 })
                        .clamp(0., 1.),
                        "ease-in-out",
                    );
                    state[0] = mix(state[0], 1. - margin, u);
                    state[1] = mix(state[1], 1. - margin, u);
                }
            }
        }
        if motion["webcamShake"] == true {
            if let Some(event) = motion["impacts"].as_array().and_then(|v| {
                v.iter()
                    .rev()
                    .filter_map(Value::as_f64)
                    .find(|t| *t <= time)
            }) {
                let age = time - event;
                let u = age / value_number(motion, "duration", 0.12);
                if u > 0. && u < 1. {
                    let envelope =
                        (2. * (std::f64::consts::PI * u).sin().powi(2) * (1. - u)).min(1.);
                    let phase =
                        2. * std::f64::consts::PI * value_number(motion, "frequency", 12.) * age;
                    let intensity = value_number(motion, "intensity", 0.0015);
                    state[0] += intensity * envelope * phase.sin();
                    state[1] += intensity * 0.65 * envelope * (phase * 0.85 + 0.7).sin();
                }
            }
        }
        let side = w.min(h) * state[2];
        let aspect = if shape == "rectangle" {
            (face.width() as f64 / face.height() as f64).clamp(0.25, 4.)
        } else {
            1.
        };
        let fw = side * aspect.min(1.);
        let fh = side / aspect.max(1.);
        let margin = w.min(h) * 0.025;
        let cx = (state[0] * w).clamp(margin + fw / 2., w - margin - fw / 2.);
        let cy = (state[1] * h).clamp(margin + fh / 2., h - margin - fh / 2.);
        let x = cx - fw / 2.;
        let y = cy - fh / 2.;
        let radius = fw.min(fh)
            * if shape == "circle" {
                0.5
            } else {
                state[4].clamp(0., 0.5)
            };
        let border = (value_number(camera, "border", 2.) * w / 1000.).min(fw.min(fh) * 0.08);
        let opacity = state[3].clamp(0., 1.) as f32;
        shadow(
            out,
            x,
            y + side * 0.025,
            fw,
            fh,
            radius,
            side * 0.055,
            value_number(camera, "shadow", 35.) / 100. * opacity as f64,
        );
        let mut layer = Pixmap::new(self.width, self.height).ok_or("Sem memória para a webcam.")?;
        let mut paint = Paint::default();
        paint.set_color_rgba8(255, 255, 255, 255);
        layer.fill_path(
            &rounded(x, y, fw, fh, radius),
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
        let mut mask = Mask::new(self.width, self.height).ok_or("Sem memória para a webcam.")?;
        mask.fill_path(
            &rounded(
                x + border,
                y + border,
                fw - 2. * border,
                fh - 2. * border,
                (radius - border).max(0.),
            ),
            FillRule::Winding,
            true,
            Transform::identity(),
        );
        let scale = ((fw - 2. * border) / face.width() as f64)
            .max((fh - 2. * border) / face.height() as f64);
        // Mirror the webcam, matching the preview.
        layer.draw_pixmap(
            0,
            0,
            face.as_ref(),
            &PixmapPaint {
                quality: tiny_skia::FilterQuality::Bilinear,
                ..Default::default()
            },
            Transform::from_row(
                -scale as f32,
                0.,
                0.,
                scale as f32,
                (cx + face.width() as f64 * scale / 2.) as f32,
                (cy - face.height() as f64 * scale / 2.) as f32,
            ),
            Some(&mask),
        );
        out.draw_pixmap(
            0,
            0,
            layer.as_ref(),
            &PixmapPaint {
                opacity,
                ..Default::default()
            },
            Transform::identity(),
            None,
        );
        Ok(())
    }
}

fn camera_at(time: f64, keys: &[Key]) -> Key {
    camera(time, keys)
}
fn ease(t: f64, style: &str) -> f64 {
    match style {
        "linear" => t,
        "ease-out" => 1. - (1. - t).powi(3),
        "cubic-bezier" => {
            let (mut low, mut high) = (0.0_f64, 1.0_f64);
            for _ in 0..24 {
                let u = (low + high) / 2.;
                let x = 3. * (1. - u).powi(2) * u * 0.42 + 3. * (1. - u) * u * u * 0.58 + u * u * u;
                if x < t { low = u } else { high = u }
            }
            let u = (low + high) / 2.;
            3. * (1. - u) * u * u + u * u * u
        }
        _ => t * t * (3. - 2. * t),
    }
}
fn color(s: &str) -> [u8; 3] {
    let s = s.trim_start_matches('#');
    let value = u32::from_str_radix(s, 16).unwrap_or(0);
    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}
fn load_pixmap(path: &Path) -> Result<Pixmap> {
    let mut rgba = image::open(path)?.into_rgba8();
    for p in rgba.pixels_mut() {
        for i in 0..3 {
            p[i] = (p[i] as u16 * p[3] as u16 / 255) as u8;
        }
    }
    let (w, h) = rgba.dimensions();
    Pixmap::from_vec(
        rgba.into_raw(),
        tiny_skia::IntSize::from_wh(w, h).ok_or("Imagem inválida.")?,
    )
    .ok_or_else(|| "Imagem inválida.".into())
}
fn cover(source: &Pixmap, width: u32, height: u32) -> Result<Pixmap> {
    cover_region(source, width, height, 0., 0., 1., 1.)
}
fn cover_region(source: &Pixmap, width: u32, height: u32, x: f64, y: f64, crop_width: f64, crop_height: f64) -> Result<Pixmap> {
    let mut out = Pixmap::new(width, height).ok_or("Sem memória para o fundo.")?;
    let sw = source.width() as f32;
    let sh = source.height() as f32;
    let s = (width as f32 / (sw * crop_width as f32)).max(height as f32 / (sh * crop_height as f32));
    out.draw_pixmap(
        0,
        0,
        source.as_ref(),
        &PixmapPaint {
            quality: tiny_skia::FilterQuality::Bilinear,
            ..Default::default()
        },
        Transform::from_row(
            s,
            0.,
            0.,
            s,
            (width as f32 - sw * crop_width as f32 * s) / 2. - x as f32 * sw * s,
            (height as f32 - sh * crop_height as f32 * s) / 2. - y as f32 * sh * s,
        ),
        None,
    );
    Ok(out)
}
fn blurred(source: &Pixmap, sigma: f32) -> Result<Pixmap> {
    if sigma <= 0. {
        return Ok(source.clone());
    }
    let image = RgbaImage::from_raw(source.width(), source.height(), source.data().to_vec())
        .ok_or("Frame inválido.")?;
    let blurred = imageops::blur(&image, sigma);
    Pixmap::from_vec(
        blurred.into_raw(),
        tiny_skia::IntSize::from_wh(source.width(), source.height()).unwrap(),
    )
    .ok_or_else(|| "Frame inválido.".into())
}
fn rounded(x: f64, y: f64, w: f64, h: f64, r: f64) -> tiny_skia::Path {
    let r = r.max(0.).min(w.min(h) / 2.);
    let k = 0.5522847498;
    let mut p = PathBuilder::new();
    p.move_to((x + r) as f32, y as f32);
    p.line_to((x + w - r) as f32, y as f32);
    p.cubic_to(
        (x + w - r + r * k) as f32,
        y as f32,
        (x + w) as f32,
        (y + r - r * k) as f32,
        (x + w) as f32,
        (y + r) as f32,
    );
    p.line_to((x + w) as f32, (y + h - r) as f32);
    p.cubic_to(
        (x + w) as f32,
        (y + h - r + r * k) as f32,
        (x + w - r + r * k) as f32,
        (y + h) as f32,
        (x + w - r) as f32,
        (y + h) as f32,
    );
    p.line_to((x + r) as f32, (y + h) as f32);
    p.cubic_to(
        (x + r - r * k) as f32,
        (y + h) as f32,
        x as f32,
        (y + h - r + r * k) as f32,
        x as f32,
        (y + h - r) as f32,
    );
    p.line_to(x as f32, (y + r) as f32);
    p.cubic_to(
        x as f32,
        (y + r - r * k) as f32,
        (x + r - r * k) as f32,
        y as f32,
        (x + r) as f32,
        y as f32,
    );
    p.close();
    p.finish().unwrap()
}
fn shadow(out: &mut Pixmap, x: f64, y: f64, w: f64, h: f64, r: f64, blur: f64, strength: f64) {
    if strength <= 0. {
        return;
    }
    for i in (0..12).rev() {
        let spread = blur * i as f64 / 4.;
        let mut paint = Paint::default();
        paint.set_color_rgba8(
            0,
            0,
            0,
            (strength * 255. / 18. * (-0.5 * (i as f64 / 4.).powi(2)).exp()) as u8,
        );
        out.fill_path(
            &rounded(
                x - spread,
                y - spread,
                w + spread * 2.,
                h + spread * 2.,
                r + spread,
            ),
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

fn export_audio(
    job: &Job,
    ranges: &[Clip],
    duration: f64,
    source_audio: bool,
    work: &Path,
    cancel: &AtomicBool,
) -> Result<Option<PathBuf>> {
    let mut command = ffmpeg()?;
    command.arg("-nostdin");
    let mut graph = String::new();
    let mut tracks = Vec::new();
    let mut index = 0;
    for (source, volume) in [
        (
            source_audio.then(|| job.source.clone()),
            job.source_volume.unwrap_or(1.),
        ),
        (
            job.microphone
                .as_ref()
                .map(|m| PathBuf::from(value_str(m, "path", ""))),
            job.microphone
                .as_ref()
                .map_or(1., |m| value_number(m, "volume", 1.)),
        ),
    ] {
        if let Some(source) = source {
            command.arg("-i").arg(source);
            let mut split = format!("[{index}:a:0]asplit={}", ranges.len());
            for i in 0..ranges.len() {
                split += &format!("[s{index}_{i}]");
            }
            graph += &format!("{split};\n");
            for (i, r) in ranges.iter().enumerate() {
                graph += &format!(
                    "[s{index}_{i}]atrim=start={}:end={},asetpts=PTS-STARTPTS,{},apad,atrim=duration={},volume={volume}[c{index}_{i}];\n",
                    r.start,
                    r.end,
                    tempo(r.speed),
                    r.duration()
                );
            }
            for i in 0..ranges.len() {
                graph += &format!("[c{index}_{i}]");
            }
            graph += &format!("concat=n={}:v=0:a=1[a{index}];\n", ranges.len());
            tracks.push(format!("[a{index}]"));
            index += 1;
        }
    }
    if let Some(music) = &job.background_audio {
        command
            .args(["-stream_loop", "-1", "-i"])
            .arg(value_str(music, "path", ""));
        graph += &format!(
            "[{index}:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,volume={}[music];\n",
            value_number(music, "volume", 1.)
        );
        tracks.push("[music]".into());
        index += 1;
    }
    if job.appearance["clickSounds"] != false && job.cursor_captured {
        if let Some(clicks) = click_audio(job, ranges, duration, work)? {
            command
                .args(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i"])
                .arg(clicks);
            graph += &format!(
                "[{index}:a]volume={}[clicks];\n",
                value_number(&job.appearance, "clickSoundVolume", 0.3)
            );
            tracks.push("[clicks]".into());
        }
    }
    if tracks.is_empty() {
        return Ok(None);
    }
    graph += &format!(
        "{}amix=inputs={}:duration=longest:normalize=0,alimiter=limit=0.95:latency=1,apad,atrim=duration={duration}[out]",
        tracks.join(""),
        tracks.len()
    );
    let script = work.join("audio-filter.txt");
    fs::write(&script, graph)?;
    let output = work.join("audio.m4a");
    command
        .arg("-/filter_complex")
        .arg(script)
        .args(["-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-y"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    Process::spawn(&mut command)?.wait_cancel(cancel)?;
    Ok(Some(output))
}
fn tempo(mut speed: f64) -> String {
    let mut parts = Vec::new();
    while speed < 0.5 {
        parts.push("atempo=0.5".to_owned());
        speed /= 0.5;
    }
    while speed > 2. {
        parts.push("atempo=2".to_owned());
        speed /= 2.;
    }
    parts.push(format!("atempo={speed}"));
    parts.join(",")
}
fn click_audio(job: &Job, ranges: &[Clip], duration: f64, work: &Path) -> Result<Option<PathBuf>> {
    use std::io::{Seek, SeekFrom};
    let times: Vec<f64> = job
        .raw_cursor
        .iter()
        .enumerate()
        .filter(|(i, p)| p.down && (*i == 0 || !job.raw_cursor[*i - 1].down))
        .filter_map(|(_, p)| {
            let mut offset = 0.;
            for r in ranges {
                if p.t >= r.start && p.t < r.end {
                    return Some(offset + (p.t - r.start) / r.speed);
                }
                offset += r.duration();
            }
            None
        })
        .collect();
    if times.is_empty() {
        return Ok(None);
    }
    let sample = check_output(
        ffmpeg()?
            .args(["-nostdin", "-i"])
            .arg(job.assets_root.join("mouse-click.wav"))
            .args(["-f", "f32le", "-ar", "48000", "-ac", "2", "pipe:1"])
            .output()?,
    )?;
    let path = work.join("clicks.f32");
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&path)?;
    let length = (duration * 48000.).ceil() as u64 * 8;
    file.set_len(length)?;
    for time in times {
        let at = (time * 48000.).round() as u64 * 8;
        let len = (sample.len() as u64).min(length.saturating_sub(at)) as usize;
        let mut mixed = vec![0; len];
        file.seek(SeekFrom::Start(at))?;
        file.read_exact(&mut mixed)?;
        for (dest, src) in mixed.chunks_exact_mut(4).zip(sample.chunks_exact(4)) {
            let value = f32::from_le_bytes(dest.try_into().unwrap())
                + f32::from_le_bytes(src.try_into().unwrap());
            dest.copy_from_slice(&value.to_le_bytes());
        }
        file.seek(SeekFrom::Start(at))?;
        file.write_all(&mixed)?;
    }
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_geometry_matches_editor() {
        assert_eq!(dimensions(1920., 1080., 1080, "9:16"), (1080, 1920));
        assert_eq!(dimensions(1920., 1080., 2160, "16:9"), (3840, 2160));
        assert_eq!(dimensions(1080., 1920., 720, "1:1"), (720, 720));
        assert_eq!(dimensions(960., 1080., 1080, "auto"), (1080, 1216));
    }
    #[test]
    fn camera_respects_instant_cuts() {
        let keys = [
            Key {
                t: 0.,
                x: 0.5,
                y: 0.5,
                scale: 1.,
                cut: false,
            },
            Key {
                t: 1.,
                x: 0.8,
                y: 0.5,
                scale: 2.,
                cut: true,
            },
        ];
        assert_eq!(camera(0.99, &keys).scale, 1.);
        assert_eq!(camera(1., &keys).scale, 2.);
    }
    #[test]
    fn audio_speed_chain_stays_supported() {
        assert_eq!(tempo(0.25), "atempo=0.5,atempo=0.5");
        assert_eq!(tempo(4.), "atempo=2,atempo=2");
    }
}
