//! WASAPI shared-mode microphone and render-endpoint loopback capture. Raw
//! float files use the QPC packet timestamp, preserving silence and gaps.
use super::*;
use crate::recording::{MicrophoneProcessing, RecordingOptions};
use std::io::{Seek, SeekFrom};
use windows::Win32::{
    Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
    Media::Audio::*,
    System::{
        Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
        Com::*,
        Performance::*,
    },
};

pub(super) fn devices() -> Result<(Vec<Value>, Vec<Value>)> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }
    let _com = Com;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let enumerate = |flow: EDataFlow| -> Result<Vec<Value>> {
        let default = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }
            .ok()
            .and_then(|device| endpoint_id(&device).ok());
        let collection = unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)? };
        let mut result = Vec::new();
        for i in 0..unsafe { collection.GetCount()? } {
            let device = unsafe { collection.Item(i)? };
            let id = endpoint_id(&device)?;
            let label = (|| -> Result<String> {
                let store = unsafe { device.OpenPropertyStore(STGM_READ)? };
                let mut value = unsafe { store.GetValue(&PKEY_Device_FriendlyName)? };
                let name = unsafe { PropVariantToStringAlloc(&value) };
                unsafe {
                    PropVariantClear(&mut value)?;
                }
                take_string(name?)
            })()
            .unwrap_or_else(|_| format!("Dispositivo {}", i + 1));
            result.push(
                json!({"id":id,"label":label,"isDefault":default.as_deref()==Some(id.as_str())}),
            );
        }
        Ok(result)
    };
    Ok((enumerate(eRender)?, enumerate(eCapture)?))
}
fn take_string(value: windows::core::PWSTR) -> Result<String> {
    let result = unsafe { value.to_string() };
    unsafe {
        CoTaskMemFree(Some(value.0.cast()));
    }
    Ok(result?)
}
fn endpoint_id(device: &IMMDevice) -> Result<String> {
    take_string(unsafe { device.GetId()? })
}

pub(super) struct RecordingAudio {
    stop: Arc<AtomicBool>,
    errors: Arc<Mutex<Vec<String>>>,
    threads: Vec<thread::JoinHandle<()>>,
    system: Option<PathBuf>,
    microphone: Option<PathBuf>,
}

impl RecordingAudio {
    pub fn start(
        path: &Path,
        system: bool,
        microphone: bool,
        start: Arc<Mutex<Option<Instant>>>,
        options: &RecordingOptions,
    ) -> Result<Self> {
        let mut result = Self {
            stop: Arc::new(AtomicBool::new(false)),
            errors: Arc::new(Mutex::new(Vec::new())),
            threads: Vec::new(),
            system: system.then(|| path.with_extension("system.f32")),
            microphone: microphone.then(|| path.with_extension("microphone.f32")),
        };
        for (loopback, path) in [
            (true, result.system.clone()),
            (false, result.microphone.clone()),
        ] {
            let Some(path) = path else { continue };
            let stop = result.stop.clone();
            let start = start.clone();
            let errors = result.errors.clone();
            let device = if loopback {
                options.output_device.clone()
            } else {
                options.microphone_device.clone()
            };
            let processing = (!loopback).then(|| options.microphone_processing.clone());
            let (tx, rx) = mpsc::sync_channel(1);
            result.threads.push(thread::spawn(move || {
                let role = if loopback { "áudio do sistema" } else { "microfone" };
                if let Err(error) = capture(&path, loopback, device.as_deref(), processing.as_ref(), &stop, &start, &tx) {
                    let message = format!("Falha no {role}: {error}. Verifique o dispositivo selecionado e as permissões de áudio nas Configurações do Windows.");
                    let _ = tx.try_send(Err(message.clone())); errors.lock().unwrap().push(message);
                }
            }));
            rx.recv_timeout(Duration::from_secs(15))
                .map_err(|_| "O dispositivo de áudio não respondeu.")?
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
        }
        Ok(result)
    }
    pub fn check(&self) -> Result<()> {
        if let Some(error) = self.errors.lock().unwrap().first() {
            return Err(error.clone().into());
        }
        Ok(())
    }
    pub fn finish(mut self, destination: &Path, capture: &Path, duration: f64) -> Result<()> {
        self.stop.store(true, Ordering::SeqCst);
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
        self.check()?;
        // Extend silence to the video duration, including an entirely silent
        // loopback endpoint, without allocating a recording-sized buffer.
        for path in [&self.system, &self.microphone].into_iter().flatten() {
            fs::OpenOptions::new()
                .write(true)
                .open(path)?
                .set_len((duration * 48000.).ceil() as u64 * 8)?;
        }
        if let Some(system) = &self.system {
            let output = ffmpeg()?
                .args(["-nostdin", "-i"])
                .arg(capture)
                .args(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i"])
                .arg(system)
                .args([
                    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a",
                    "192k", "-t",
                ])
                .arg(duration.to_string())
                .args(["-movflags", "+faststart", "-y"])
                .arg(destination)
                .output()?;
            check_output(output)?;
        } else {
            fs::rename(capture, destination)?;
        }
        if let Some(microphone) = &self.microphone {
            check_output(
                ffmpeg()?
                    .args(["-nostdin", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i"])
                    .arg(microphone)
                    .args(["-c:a", "aac", "-b:a", "128k", "-y"])
                    .arg(destination.with_extension("microphone.m4a"))
                    .output()?,
            )?;
        }
        Ok(())
    }
}
impl Drop for RecordingAudio {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
        for path in [&self.system, &self.microphone].into_iter().flatten() {
            let _ = fs::remove_file(path);
        }
    }
}

struct Com;
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
struct Stream(IAudioClient);
impl Drop for Stream {
    fn drop(&mut self) {
        let _ = unsafe { self.0.Stop() };
    }
}

fn capture(
    path: &Path,
    loopback: bool,
    selected: Option<&str>,
    processing: Option<&MicrophoneProcessing>,
    stop: &AtomicBool,
    start: &Mutex<Option<Instant>>,
    ready: &mpsc::SyncSender<std::result::Result<(), String>>,
) -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }
    let _com = Com;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = if let Some(id) = selected.filter(|id| !id.is_empty()) {
        let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
        let device = unsafe { enumerator.GetDevice(windows::core::PCWSTR(wide.as_ptr()))? };
        use windows::core::Interface;
        let endpoint: IMMEndpoint = device.cast()?;
        if unsafe { endpoint.GetDataFlow()? } != if loopback { eRender } else { eCapture } {
            return Err("O dispositivo selecionado não corresponde ao tipo de captura.".into());
        }
        device
    } else {
        unsafe {
            enumerator
                .GetDefaultAudioEndpoint(if loopback { eRender } else { eCapture }, eConsole)?
        }
    };
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let format = WAVEFORMATEX {
        wFormatTag: 3,
        nChannels: 2,
        nSamplesPerSec: 48000,
        nAvgBytesPerSec: 384000,
        nBlockAlign: 8,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    let flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
        | if loopback {
            AUDCLNT_STREAMFLAGS_LOOPBACK
        } else {
            0
        };
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            flags,
            10_000_000,
            0,
            &format,
            None,
        )?;
    }
    let packets: IAudioCaptureClient = unsafe { client.GetService()? };
    let mut sink = PcmSink::new(path, processing)?;
    ready.send(Ok(()))?;
    while start.lock().unwrap().is_none() {
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(2));
    }
    let mut counter = 0;
    let mut frequency = 0;
    unsafe {
        QueryPerformanceCounter(&mut counter)?;
        QueryPerformanceFrequency(&mut frequency)?;
        client.Start()?;
    }
    let _stream = Stream(client);
    let origin = counter as f64 / frequency as f64 * 10_000_000.;
    let mut written = 0u64;
    while !stop.load(Ordering::SeqCst) {
        while unsafe { packets.GetNextPacketSize()? } > 0 {
            let mut data = std::ptr::null_mut();
            let mut frames = 0;
            let mut flags = 0;
            let mut timestamp = 0;
            unsafe {
                packets.GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut flags,
                    None,
                    Some(&mut timestamp),
                )?;
            }
            // Always release the COM buffer, including on a filesystem error.
            let write_result = (|| -> Result<()> {
                let at = if flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0 {
                    written
                } else {
                    (((timestamp as f64 - origin) / 10_000_000. * 48000.).max(0.)).round() as u64
                };
                let bytes;
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                    bytes = vec![0u8; frames as usize * 8];
                    sink.write_at(at, &bytes)?;
                } else {
                    sink.write_at(at, unsafe {
                        std::slice::from_raw_parts(data, frames as usize * 8)
                    })?;
                }
                written = at + frames as u64;
                Ok(())
            })();
            unsafe {
                packets.ReleaseBuffer(frames)?;
            }
            write_result?;
        }
        thread::sleep(Duration::from_millis(5));
    }
    sink.finish()?;
    Ok(())
}

/// The microphone enters the denoiser/compressor while capture is active.
/// Timestamp gaps become silence before filtering; overlaps are discarded so
/// queued WASAPI packets never shift the voice relative to the screen.
struct PcmSink {
    file: Option<fs::File>,
    process: Option<Process>,
    pipe: Option<std::process::ChildStdin>,
    written: u64,
}
impl PcmSink {
    fn new(path: &Path, processing: Option<&MicrophoneProcessing>) -> Result<Self> {
        if let Some(processing) = processing {
            let mut command = ffmpeg()?;
            command
                .args([
                    "-probesize",
                    "4096",
                    "-analyzeduration",
                    "1",
                    "-f",
                    "f32le",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-blocksize",
                    "4096",
                    "-i",
                    "pipe:0",
                    "-af",
                ])
                .arg(processing.filter())
                .args([
                    "-c:a",
                    "pcm_f32le",
                    "-flush_packets",
                    "1",
                    "-f",
                    "f32le",
                    "-y",
                ])
                .arg(path)
                .stdin(Stdio::piped())
                .stdout(Stdio::null());
            let mut process = Process::spawn(&mut command)?;
            let pipe = process.child.stdin.take();
            Ok(Self {
                file: None,
                process: Some(process),
                pipe,
                written: 0,
            })
        } else {
            Ok(Self {
                file: Some(fs::File::create(path)?),
                process: None,
                pipe: None,
                written: 0,
            })
        }
    }
    fn write_at(&mut self, frame: u64, bytes: &[u8]) -> Result<()> {
        if let Some(file) = &mut self.file {
            file.seek(SeekFrom::Start(frame * 8))?;
            file.write_all(bytes)?;
            return Ok(());
        }
        let pipe = self
            .pipe
            .as_mut()
            .ok_or("O tratamento do microfone foi encerrado.")?;
        let silence = [0u8; 8192];
        while frame > self.written {
            let gap = (frame - self.written).min(1024) as usize;
            pipe.write_all(&silence[..gap * 8])?;
            self.written += gap as u64;
        }
        let skip = (self.written.saturating_sub(frame)).min(bytes.len() as u64 / 8) as usize * 8;
        pipe.write_all(&bytes[skip..])?;
        self.written += ((bytes.len() - skip) / 8) as u64;
        Ok(())
    }
    fn finish(mut self) -> Result<()> {
        self.pipe.take();
        if let Some(process) = &mut self.process {
            process.finish()?;
        }
        if let Some(file) = &mut self.file {
            file.flush()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn samples(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(4)
            .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
            .collect()
    }
    fn rms(values: &[f32]) -> f64 {
        (values.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / values.len() as f64).sqrt()
    }
    #[test]
    fn live_microphone_denoises_without_erasing_voice() {
        let work = WorkDir::new(&std::env::temp_dir()).unwrap();
        let output = work.0.join("clean.f32");
        let mut seed = 123456789u32;
        let mut input = Vec::new();
        for frame in 0..144000 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed as f64 / u32::MAX as f64) * 2. - 1.) as f32 * 0.012;
            let voice = if frame >= 96000 {
                (frame as f32 * 2. * std::f32::consts::PI * 440. / 48000.).sin() * 0.3
            } else {
                0.
            };
            for _ in 0..2 {
                input.extend_from_slice(&(noise + voice).to_le_bytes());
            }
        }
        let mut sink = PcmSink::new(&output, Some(&MicrophoneProcessing::default())).unwrap();
        let mut frame = 0;
        for packet in input.chunks(480 * 8) {
            sink.write_at(frame, packet).unwrap();
            frame += (packet.len() / 8) as u64;
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while !fs::metadata(&output).is_ok_and(|m| m.len() > 0) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            fs::metadata(&output).is_ok_and(|m| m.len() > 0),
            "Microphone processing waited for recording to end"
        );
        sink.finish().unwrap();
        let raw = samples(&input);
        let clean = samples(&fs::read(output).unwrap());
        let noise_in = rms(&raw[48000 * 2..80000 * 2]);
        let noise_out = rms(&clean[48000 * 2..80000 * 2]);
        assert!(
            noise_out < noise_in * 0.65,
            "Noise was not reduced: {noise_in} -> {noise_out}"
        );
        assert!(
            rms(&clean[110000 * 2..130000 * 2]) > 0.02,
            "The voice was removed"
        );
        assert!(clean.iter().all(|s| s.is_finite() && s.abs() <= 0.9));
    }
    #[test]
    fn live_compressor_controls_peaks_and_raw_bypass_preserves_samples() {
        let work = WorkDir::new(&std::env::temp_dir()).unwrap();
        let mut input = Vec::new();
        for frame in 0..48000 {
            let value = (frame as f32 * 2. * std::f32::consts::PI * 440. / 48000.).sin() * 0.8;
            for _ in 0..2 {
                input.extend_from_slice(&value.to_le_bytes());
            }
        }
        let mut options = MicrophoneProcessing {
            noise_suppression: false,
            high_pass: false,
            makeup_db: 0.,
            ..Default::default()
        };
        let compressed = work.0.join("compressed.f32");
        let mut sink = PcmSink::new(&compressed, Some(&options)).unwrap();
        sink.write_at(0, &input).unwrap();
        sink.finish().unwrap();
        let clean = samples(&fs::read(compressed).unwrap());
        assert!(
            rms(&clean[24000 * 2..40000 * 2]) < 0.3,
            "Compression did not reduce sustained peaks"
        );
        options.compressor = false;
        let bypass = work.0.join("bypass.f32");
        let mut sink = PcmSink::new(&bypass, Some(&options)).unwrap();
        sink.write_at(0, &input).unwrap();
        sink.finish().unwrap();
        assert_eq!(fs::read(bypass).unwrap(), input);
    }
}
