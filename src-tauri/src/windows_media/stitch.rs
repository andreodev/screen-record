use super::*;

#[derive(Deserialize)]
struct Segment {
    path: PathBuf,
    duration: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StitchJob {
    segments: Vec<Segment>,
    destination: PathBuf,
    audio_only: bool,
    fps: Option<u32>,
}

pub(super) fn run(path: &Path) -> Result<()> {
    let job: StitchJob = serde_json::from_slice(&fs::read(path)?)?;
    if job.segments.is_empty()
        || job.segments.len() > 1000
        || job
            .segments
            .iter()
            .any(|s| !s.path.is_file() || !s.duration.is_finite() || s.duration <= 0.)
    {
        return Err("Trechos de gravação inválidos.".into());
    }
    let first = if job.audio_only {
        Value::Null
    } else {
        inspect(&job.segments[0].path)?
    };
    let has_audio = job.audio_only || first["hasAudio"].as_bool().unwrap_or(false);
    let width = first["width"].as_u64().unwrap_or(1280);
    let height = first["height"].as_u64().unwrap_or(720);
    let mut command = ffmpeg()?;
    command.arg("-nostdin");
    for segment in &job.segments {
        command.arg("-i").arg(&segment.path);
    }
    let mut filters = Vec::new();
    let mut joined = String::new();
    for (i, segment) in job.segments.iter().enumerate() {
        if !job.audio_only {
            filters.push(format!("[{i}:v]scale={width}:{height},setsar=1,fps={},tpad=stop_mode=clone:stop_duration={},trim=duration={},setpts=PTS-STARTPTS[v{i}]",job.fps.unwrap_or(60),segment.duration,segment.duration));
            joined.push_str(&format!("[v{i}]"));
        }
        if has_audio {
            filters.push(format!(
                "[{i}:a]aresample=48000,apad,atrim=duration={},asetpts=PTS-STARTPTS[a{i}]",
                segment.duration
            ));
            joined.push_str(&format!("[a{i}]"));
        }
    }
    filters.push(format!(
        "{joined}concat=n={}:v={}:a={}{}",
        job.segments.len(),
        u8::from(!job.audio_only),
        u8::from(has_audio),
        match (job.audio_only, has_audio) {
            (true, _) => "[audio]",
            (false, true) => "[video][audio]",
            (false, false) => "[video]",
        }
    ));
    command.arg("-filter_complex").arg(filters.join(";"));
    if !job.audio_only {
        command.args([
            "-map", "[video]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt",
            "yuv420p",
        ]);
    }
    if has_audio {
        command.args(["-map", "[audio]", "-c:a", "aac", "-b:a", "192k"]);
    }
    command.arg("-y").arg(&job.destination);
    check_output(command.output()?)?;
    emit(json!({"event":"stitched","path":job.destination}));
    Ok(())
}
