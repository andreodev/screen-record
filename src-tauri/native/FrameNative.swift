import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreImage

struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
let emitLock = NSLock()
func emit(_ value: [String: Any]) {
    emitLock.lock(); defer { emitLock.unlock() }
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) }
}
struct Pointer: Codable { var t: Double; var x: Double; var y: Double; var down: Bool; var kind: String? = nil; var rightDown: Bool? = nil; var middleDown: Bool? = nil; var typing: Bool? = nil }
struct Media: Codable { var path: String; var duration: Double; var width: Int; var height: Int; var cursor: [Pointer]; var cursorCaptured: Bool }
func metadata(_ path: String) async throws -> Media {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "O arquivo não contém vídeo.") }
    let duration = try await asset.load(.duration).seconds
    let size = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let rect = CGRect(origin: .zero, size: size).applying(transform)
    guard duration.isFinite, duration > 0 else { throw Failure(message: "Duração de vídeo inválida.") }
    var media = Media(path: path, duration: duration, width: Int(abs(rect.width)), height: Int(abs(rect.height)), cursor: [], cursorCaptured: false)
    let sidecar = URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("cursor.json")
    if let attributes = try? FileManager.default.attributesOfItem(atPath: sidecar.path), let bytes = attributes[.size] as? NSNumber, bytes.intValue <= 50_000_000, let data = try? Data(contentsOf: sidecar), let events = try? JSONDecoder().decode([Pointer].self, from: data), events.allSatisfy({ $0.t.isFinite && $0.x.isFinite && $0.y.isFinite && $0.t >= 0 && (0...1).contains($0.x) && (0...1).contains($0.y) }), zip(events, events.dropFirst()).allSatisfy({ $0.t <= $1.t }) {
        media.cursor = events; media.cursorCaptured = true
    }
    return media
}
func emitMedia(_ media: Media) throws { let data = try JSONEncoder().encode(media); emit(["event": "media", "media": try JSONSerialization.jsonObject(with: data)]) }

func cursorSignature(_ cursor: NSCursor) -> Data? {
    guard let image = cursor.image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    var bytes = [UInt8](repeating: 0, count: 32 * 32 * 4)
    let rendered = bytes.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(data: buffer.baseAddress, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: 32, height: 32)); return true
    }
    return rendered ? Data(bytes) : nil
}

func captureSize(width: Int, height: Int) -> (Int, Int) {
    let landscape = width >= height
    let maxWidth = landscape ? 3840.0 : 2160.0, maxHeight = landscape ? 2160.0 : 3840.0
    let scale = min(1, maxWidth / Double(width), maxHeight / Double(height))
    return (max(2, Int(floor(Double(width) * scale / 2)) * 2), max(2, Int(floor(Double(height) * scale / 2)) * 2))
}
func videoBitrate(width: Int, height: Int, fps: Int) -> Int {
    let pixelRate = Double(width) * Double(height) * Double(fps)
    return Int(pixelRate * (12_000_000.0 / 62_208_000.0))
}

final class CameraPreview: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "frame.camera.preview")
    let context = CIContext(options: [.useSoftwareRenderer: false])
    var lastFrame = Date.distantPast
    func start() throws {
        guard let device = AVCaptureDevice.default(for: .video) else { throw Failure(message: "Nenhuma webcam disponível.") }
        session.beginConfiguration()
        if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddInput(input), session.canAddOutput(output) else { throw Failure(message: "A webcam não pode iniciar neste Mac.") }
        session.addInput(input); session.addOutput(output); session.commitConfiguration()
        session.startRunning()
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date()
        guard now.timeIntervalSince(lastFrame) >= 0.12, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        let image = CIImage(cvPixelBuffer: buffer)
        guard let cgImage = context.createCGImage(image, from: image.extent),
              let data = NSBitmapImageRep(cgImage: cgImage).representation(using: .jpeg, properties: [.compressionFactor: 0.58]) else { return }
        emit(["event": "camera-frame", "data": data.base64EncodedString()])
    }
}

// shortcut: polling at 120 Hz may miss brief clicks; replace with a mouse-only event tap when integrating its permissions.
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    let queue = DispatchQueue(label: "frame.capture")
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let path: String
    let bounds: CGRect
    let fps: Int
    let cameraQueue = DispatchQueue(label: "frame.camera.frames")
    let cameraSessionQueue = DispatchQueue(label: "frame.camera.session")
    var cameraSession: AVCaptureSession?
    var cameraWriter: AVAssetWriter?
    var cameraInput: AVAssetWriterInput?
    var cameraAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    var cameraPath: String?
    var cameraFailure: Error?
    let cameraPreviewContext = CIContext(options: [.useSoftwareRenderer: false])
    var lastCameraPreviewTime = Date.distantPast
    var stream: SCStream?
    var timer: DispatchSourceTimer?
    var start: CMTime?
    var last: CMTime?
    var lastSample: CMSampleBuffer?
    var pointers: [Pointer] = []
    var lastReportedTime = -1.0
    var cursorKind: String?
    var cursorTimer: DispatchSourceTimer?
    var keyMonitor: Any?
    var failure: Error?
    init(path: String, bounds: CGRect, width: Int, height: Int, fps: Int = 60, cameraPath: String? = nil) throws {
        self.path = path; self.bounds = bounds; self.fps = fps
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: videoBitrate(width: width, height: height, fps: fps), AVVideoExpectedSourceFrameRateKey: fps, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoAllowFrameReorderingKey: false]])
        input.expectsMediaDataInRealTime = true
        super.init()
        guard writer.canAdd(input) else { throw Failure(message: "Encoder H.264 indisponível.") }
        writer.add(input)
        if let cameraPath = cameraPath {
            guard let device = AVCaptureDevice.default(for: .video) else { throw Failure(message: "Nenhuma webcam disponível.") }
            let session = AVCaptureSession(); session.beginConfiguration(); if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
            let cameraInput = try AVCaptureDeviceInput(device: device), cameraOutput = AVCaptureVideoDataOutput()
            cameraOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            cameraOutput.alwaysDiscardsLateVideoFrames = true; cameraOutput.setSampleBufferDelegate(self, queue: cameraQueue)
            guard session.canAddInput(cameraInput), session.canAddOutput(cameraOutput) else { throw Failure(message: "A webcam não pode iniciar neste Mac.") }
            session.addInput(cameraInput); session.addOutput(cameraOutput); session.commitConfiguration()
            self.cameraSession = session; self.cameraPath = cameraPath
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failure = error }; emit(["event": "capture-error", "message": error.localizedDescription]) }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid, CMSampleBufferGetImageBuffer(sample) != nil else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]], let raw = attachments.first?[.status] as? Int, raw != SCFrameStatus.complete.rawValue { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if start == nil {
            guard writer.startWriting() else { failure = writer.error; return }
            writer.startSession(atSourceTime: pts); start = pts
            if let session = cameraSession { cameraSessionQueue.async { session.startRunning() } }
            emit(["event": "started"])
        }
        if input.isReadyForMoreMediaData {
            if !input.append(sample) { failure = writer.error }
            last = pts; lastSample = sample
        }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let screenStart = start, let image = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let now = Date()
        if now.timeIntervalSince(lastCameraPreviewTime) >= 0.15 {
            lastCameraPreviewTime = now
            let frame = CIImage(cvPixelBuffer: image)
            let preview = frame.transformed(by: CGAffineTransform(scaleX: min(1, 480 / frame.extent.width), y: min(1, 480 / frame.extent.width)))
            if let cgImage = cameraPreviewContext.createCGImage(preview, from: preview.extent),
               let data = NSBitmapImageRep(cgImage: cgImage).representation(using: .jpeg, properties: [.compressionFactor: 0.58]) {
                emit(["event": "camera-frame", "data": data.base64EncodedString()])
            }
        }
        let pts = CMTimeSubtract(CMSampleBufferGetPresentationTimeStamp(sampleBuffer), screenStart)
        guard pts >= .zero else { return }
        if cameraWriter == nil {
            let width = CVPixelBufferGetWidth(image), height = CVPixelBufferGetHeight(image)
            guard let cameraPath = cameraPath, let writer = try? AVAssetWriter(outputURL: URL(fileURLWithPath: cameraPath), fileType: .mov) else { cameraFailure = Failure(message: "Não foi possível criar o arquivo da webcam."); return }
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: videoBitrate(width: width, height: height, fps: 30), AVVideoExpectedSourceFrameRateKey: 30, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]])
            input.expectsMediaDataInRealTime = true
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferIOSurfacePropertiesKey as String: [:]])
            guard writer.canAdd(input) else { cameraFailure = Failure(message: "Encoder H.264 indisponível para a webcam."); return }
            writer.add(input)
            guard writer.startWriting() else { cameraFailure = writer.error ?? Failure(message: "Não foi possível iniciar a gravação da webcam."); return }
            writer.startSession(atSourceTime: .zero); cameraWriter = writer; cameraInput = input; cameraAdaptor = adaptor
        }
        if let adaptor = cameraAdaptor, let input = cameraInput, input.isReadyForMoreMediaData, !adaptor.append(image, withPresentationTime: pts) { cameraFailure = cameraWriter?.error ?? Failure(message: "Falha ao gravar um frame da webcam.") }
    }
    func reportTime(_ now: CMTime, force: Bool = false) {
        guard let start = start else { return }
        let seconds = max(0, CMTimeSubtract(now, start).seconds)
        if force || seconds - lastReportedTime >= 0.1 {
            lastReportedTime = seconds; emit(["event": "recording-time", "seconds": seconds])
        }
    }
    func begin() {
        _ = NSApplication.shared
        let known: [(String, NSCursor)] = [("pointer", .arrow), ("pointinghand", .pointingHand), ("ibeam", .iBeam), ("openhand", .openHand), ("closedhand", .closedHand), ("crosshair", .crosshair), ("notallowed", .operationNotAllowed), ("copy", .dragCopy), ("makealias", .dragLink), ("contextualmenu", .contextualMenu), ("resizeleftright", .resizeLeftRight), ("resizeupdown", .resizeUpDown)]
        let signatures = Dictionary(known.compactMap { kind, cursor in cursorSignature(cursor).map { ($0, kind) } }, uniquingKeysWith: { first, _ in first })
        let cursorTimer = DispatchSource.makeTimerSource(queue: .main)
        cursorTimer.schedule(deadline: .now(), repeating: 1.0 / 30)
        cursorTimer.setEventHandler { [weak self] in
            // shortcut: deprecated public system-cursor API may return nil; never invent missing hover states.
            let kind = NSCursor.currentSystem.flatMap(cursorSignature).flatMap { signatures[$0] }
            self?.queue.async { [weak self] in self?.cursorKind = kind }
        }
        self.cursorTimer = cursorTimer; cursorTimer.resume()
        // A global monitor observes key-down timing only. We intentionally discard
        // the key and never store typed text; the last sampled pointer is the focus hint.
        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] _ in
            guard let self = self, let captureStart = self.start else { return }
            let time = CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), captureStart).seconds
            guard time.isFinite, time >= 0 else { return }
            self.queue.async { [weak self] in
                guard let self = self, let previous = self.pointers.last else { return }
                let event = Pointer(t: time, x: previous.x, y: previous.y, down: previous.down, kind: previous.kind, rightDown: previous.rightDown, middleDown: previous.middleDown, typing: true)
                if let index = self.pointers.firstIndex(where: { $0.t > time }) { self.pointers.insert(event, at: index) }
                else { self.pointers.append(event) }
            }
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 1.0 / 120)
        timer.setEventHandler { [weak self] in
            guard let self = self, let start = self.start else { return }
            let now = CMClockGetTime(CMClockGetHostTimeClock())
            let t = CMTimeSubtract(now, start).seconds
            if t >= 0 {
                self.reportTime(now)
                guard let event = CGEvent(source: nil) else { return }
                let p = event.location
                self.pointers.append(Pointer(t: t, x: min(1, max(0, (p.x - self.bounds.minX) / self.bounds.width)), y: min(1, max(0, (p.y - self.bounds.minY) / self.bounds.height)), down: CGEventSource.buttonState(.combinedSessionState, button: .left), kind: self.cursorKind, rightDown: CGEventSource.buttonState(.combinedSessionState, button: .right), middleDown: CGEventSource.buttonState(.combinedSessionState, button: .center)))
            }
        }
        timer.resume(); self.timer = timer
    }
    func finish() async throws {
        cursorTimer?.cancel(); cursorTimer = nil
        if let keyMonitor = keyMonitor { NSEvent.removeMonitor(keyMonitor); self.keyMonitor = nil }
        try await stream?.stopCapture()
        if let session = cameraSession { cameraSessionQueue.sync { session.stopRunning() }; cameraQueue.sync {} }
        if let cameraFailure = cameraQueue.sync(execute: { self.cameraFailure }) { writer.cancelWriting(); cameraWriter?.cancelWriting(); throw cameraFailure }
        queue.sync {
            timer?.cancel(); timer = nil
            // ScreenCaptureKit can stop sending complete frames while the screen is static.
            // Extend the last image to the stop time so idle periods are not trimmed away.
            let stop = CMClockGetTime(CMClockGetHostTimeClock())
            if let sample = lastSample, let last = last, stop.seconds - last.seconds > 1.0 / Double(fps), input.isReadyForMoreMediaData {
                var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: CMTimeScale(fps)), presentationTimeStamp: stop, decodeTimeStamp: .invalid)
                var copy: CMSampleBuffer?
                if CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy) == noErr, let copy = copy {
                    if !input.append(copy) { failure = writer.error }
                }
            }
            if start != nil { writer.endSession(atSourceTime: stop); reportTime(stop, force: true) }
            input.markAsFinished()
        }
        if let failure = queue.sync(execute: { self.failure }) { writer.cancelWriting(); throw failure }
        guard queue.sync(execute: { start != nil }) else { throw Failure(message: "Nenhum frame recebido. Confira a permissão de gravação de tela.") }
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? Failure(message: "Não foi possível finalizar o vídeo.") }
        cameraInput?.markAsFinished()
        if cameraSession != nil && cameraWriter == nil { throw Failure(message: "Nenhum frame recebido da webcam.") }
        if let cameraWriter = cameraWriter { await cameraWriter.finishWriting(); guard cameraWriter.status == .completed else { throw cameraWriter.error ?? Failure(message: "Não foi possível finalizar a gravação da webcam.") } }
        let events = queue.sync { pointers }
        try JSONEncoder().encode(events).write(to: URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("cursor.json"), options: .atomic)
    }
}

struct Key: Codable { let t: Double; let x: Double; let y: Double; let scale: Double; var cut: Bool? = nil }
struct Look: Codable { let background: Int; let padding: Double; let radius: Double; let shadow: Double; let cursorSize: Double; let smooth: Bool; let aspect: String; let cropFill: Bool?; let cropFollowCursor: Bool?; let cameraMode: String?; let colors: [String]?; let backgroundMode: String?; let cursorSmooth: Bool?; let wallpaper: String?; let cursorAsset: String?; let cursorTheme: String?; let backgroundBlur: Double?; let motionBlur: MotionBlur?; let clickSounds: Bool?; let clickSoundVolume: Double? }
struct MotionBlur: Codable { let cursor: Double; let zoom: Double; let pan: Double }
struct Effect: Codable { let id: String; let kind: String; let start: Double; let end: Double; let x: Double; let y: Double; let width: Double; let height: Double; let opacity: Double }
struct BackgroundAudio: Codable { let path: String; let volume: Double }
struct WebcamKeyframe: Codable { let t: Double; let x: Double; let y: Double; let size: Double; let opacity: Double?; let borderRadius: Double?; let easing: String? }
struct Webcam: Codable { let path: String; let x: Double; let y: Double; let size: Double; let shape: String; let keyframes: [WebcamKeyframe]?; let mode: String?; let opacity: Double?; let border: Double?; let shadow: Double?; let borderRadius: Double? }
struct ClipRange: Codable { let start: Double; let end: Double; var speed: Double? = nil; var hideCursor: Bool? = nil; var cursorOriginal: Bool? = nil; var rate: Double { speed ?? 1 }; var duration: Double { (end - start) / rate } }
struct ExportJob: Codable { let source: String; let destination: String; let start: Double; let end: Double; let appearance: Look; let keys: [Key]; let cursor: [Pointer]; let cursorCaptured: Bool; let assetsRoot: String?; let resolution: Int?; let fps: Int?; let ranges: [ClipRange]?; let rawCursor: [Pointer]?; let effects: [Effect]?; let backgroundAudio: BackgroundAudio?; let webcam: Webcam? }
final class Cancellation: @unchecked Sendable { let lock = NSLock(); var value = false; func cancel() { lock.lock(); value = true; lock.unlock() }; var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return value } }
func mix(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
func camera(_ time: Double, _ keys: [Key]) -> Key {
    guard !keys.isEmpty else { return Key(t: time, x: 0.5, y: 0.5, scale: 1) }
    var low = 0, high = keys.count
    while low < high { let m = (low + high) / 2; if keys[m].t <= time { low = m + 1 } else { high = m } }
    let a = keys[max(0, low - 1)], b = keys[min(low, keys.count - 1)]
    let u = b.t > a.t && b.cut != true ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    return Key(t: time, x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), scale: mix(a.scale, b.scale, u))
}
func webcamState(_ webcam: Webcam, _ time: Double) -> WebcamKeyframe {
    let opacity = webcam.opacity ?? 1, radius = webcam.borderRadius ?? (webcam.shape == "circle" ? 0.5 : webcam.shape == "rounded" ? 0.18 : 0)
    if webcam.mode == "static" { return WebcamKeyframe(t: time, x: webcam.x, y: webcam.y, size: webcam.size, opacity: opacity, borderRadius: radius, easing: "linear") }
    let keys = webcam.keyframes ?? []
    guard !keys.isEmpty else { return WebcamKeyframe(t: time, x: webcam.x, y: webcam.y, size: webcam.size, opacity: opacity, borderRadius: radius, easing: "linear") }
    guard let next = keys.firstIndex(where: { $0.t >= time }) else { return keys[keys.count - 1] }
    if next == 0 { return keys[0] }
    let a = keys[next - 1], b = keys[next], raw = b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    let amount = webcamEase(raw, a.easing ?? "ease-in-out")
    return WebcamKeyframe(t: time, x: mix(a.x, b.x, amount), y: mix(a.y, b.y, amount), size: mix(a.size, b.size, amount), opacity: mix(a.opacity ?? opacity, b.opacity ?? opacity, amount), borderRadius: mix(a.borderRadius ?? radius, b.borderRadius ?? radius, amount), easing: a.easing)
}
func webcamEase(_ value: Double, _ easing: String) -> Double {
    let t = max(0, min(1, value))
    switch easing { case "linear": return t; case "ease-out": return 1 - pow(1 - t, 3); default: return t * t * (3 - 2 * t) }
}
func plannedWebcamState(_ state: WebcamKeyframe, _ mode: String?, _ cameraScale: Double, _ aspect: String, _ sizeFactor: Double) -> WebcamKeyframe {
    guard mode == "auto" || mode == "hybrid" else { return state }
    let side = state.size * sizeFactor
    let overlappingFocus = abs(state.x - 0.5) < side / 2 + 0.025 && abs(state.y - 0.5) < side / 2 + 0.025
    let margin = max(state.size / 2, side / 2 + 0.025)
    let candidates = [(1 - margin, 1 - margin), (margin, 1 - margin), (1 - margin, margin), (margin, margin)]
    let target = overlappingFocus ? candidates.max { hypot($0.0 - 0.5, $0.1 - 0.5) < hypot($1.0 - 0.5, $1.1 - 0.5) }! : (state.x, state.y)
    let raw = mode == "auto" ? max(0, min(1, (cameraScale - 1.05) / 0.45)) : overlappingFocus ? max(0, min(1, (cameraScale - 1.08) / 0.42)) : 0
    let amount = webcamEase(raw, "ease-in-out")
    return WebcamKeyframe(t: state.t, x: mix(state.x, target.0, amount), y: mix(state.y, target.1, amount), size: mode == "auto" ? state.size * (1 - amount * 0.16) : state.size, opacity: state.opacity, borderRadius: state.borderRadius, easing: state.easing)
}
func pointer(_ time: Double, _ events: [Pointer]) -> Pointer? {
    guard !events.isEmpty else { return nil }
    var low = 0, high = events.count
    while low < high { let m = (low + high) / 2; if events[m].t <= time { low = m + 1 } else { high = m } }
    let a = events[max(0, low - 1)], b = events[min(low, events.count - 1)]
    let u = b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    return Pointer(t: time, x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), down: a.down, kind: a.kind, rightDown: a.rightDown, middleDown: a.middleDown, typing: a.typing)
}
func motionFrames(_ t: Double, keys: [Key], events: [Pointer], range: ClipRange, blur: MotionBlur?, cuts: [Double], spanX: Double = 1, spanY: Double = 1) -> [(Key, Pointer?)] {
    let current = camera(t, keys), point = range.hideCursor == true ? nil : pointer(t, events)
    guard let blur = blur, blur.cursor > 0 || blur.zoom > 0 || blur.pan > 0 else { return [(current, point)] }
    var low = 0, high = cuts.count
    while low < high { let m = (low + high) / 2; if cuts[m] <= t { low = m + 1 } else { high = m } }
    let start = max(range.start, low > 0 ? cuts[low - 1] : 0), past = max(start, t - range.rate / 60)
    let samples: [(Key, Pointer?)] = (0..<5).map { index in
        let time = max(start, t - (t - past) * Double(index) / 4)
        let previous = camera(time, keys), scale = mix(current.scale, previous.scale, blur.zoom), halfX = spanX / (2 * scale), halfY = spanY / (2 * scale)
        let cam = Key(t: t, x: max(halfX, min(1 - halfX, mix(current.x, previous.x, blur.pan))), y: max(halfY, min(1 - halfY, mix(current.y, previous.y, blur.pan))), scale: scale)
        var cursor: Pointer?
        if let point = point, let other = pointer(time, events) { cursor = Pointer(t: point.t, x: mix(point.x, other.x, blur.cursor), y: mix(point.y, other.y, blur.cursor), down: point.down, kind: point.kind) }
        return (cam, cursor)
    }
    return samples.allSatisfy { $0.0.x == current.x && $0.0.y == current.y && $0.0.scale == current.scale && $0.1?.x == point?.x && $0.1?.y == point?.y } ? [(current, point)] : samples
}
func color(_ hex: String) -> CIColor {
    let n = UInt32(hex, radix: 16)!
    return CIColor(red: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255)
}
let palettes = [("25243d", "7c6a9e"), ("112e3b", "45a7ac"), ("512e53", "eb9a89"), ("182b33", "538367"), ("171719", "35353c"), ("6b3e81", "d574ae")]
func visualAsset(_ id: String, kind: String, root: String?) throws -> (CIImage, [String: Any]) {
    guard let root = root else { throw Failure(message: "Biblioteca visual indisponível.") }
    let directory = URL(fileURLWithPath: root)
    let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("catalog.json"))) as? [String: Any]
    guard let entries = catalog?[kind] as? [[String: Any]], let entry = entries.first(where: { $0["id"] as? String == id }), let file = entry["file"] as? String, !file.contains("/"), let image = CIImage(contentsOf: directory.appendingPathComponent(file)) else { throw Failure(message: "Recurso visual não encontrado: \(id)") }
    return (image, entry)
}
func exportVideo(_ job: ExportJob, cancel: Cancellation) async throws {
    let resolution = job.resolution ?? 1080, fps = job.fps ?? 30
    guard [480, 720, 1080, 1440, 2160].contains(resolution), [24, 30, 60].contains(fps) else { throw Failure(message: "Resolução ou taxa de quadros inválida.") }
    guard job.start.isFinite, job.end.isFinite, job.start >= 0, job.end > job.start else { throw Failure(message: "Trecho de exportação inválido.") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: job.source))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "Vídeo não encontrado.") }
    let ranges = job.ranges ?? [ClipRange(start: job.start, end: job.end)]
    let sourceDuration = try await asset.load(.duration).seconds
    guard !ranges.isEmpty, ranges.count <= 10000, ranges.allSatisfy({ $0.start.isFinite && $0.end.isFinite && $0.start >= job.start && $0.end <= min(job.end, sourceDuration) + 0.000001 && $0.end > $0.start && $0.rate.isFinite && $0.rate >= 0.25 && $0.rate <= 4 }), zip(ranges, ranges.dropFirst()).allSatisfy({ $0.end <= $1.start }) else { throw Failure(message: "Cortes inválidos.") }
    let duration = ranges.reduce(0) { $0 + $1.duration }
    if let blur = job.appearance.motionBlur { guard [blur.cursor, blur.zoom, blur.pan].allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else { throw Failure(message: "Intensidade de motion blur inválida.") } }
    if let webcam = job.webcam { guard webcam.size.isFinite && (0.08...0.6).contains(webcam.size) && webcam.x.isFinite && ((webcam.size / 2)...(1 - webcam.size / 2)).contains(webcam.x) && webcam.y.isFinite && ((webcam.size / 2)...(1 - webcam.size / 2)).contains(webcam.y) && ["circle", "rounded", "square"].contains(webcam.shape) else { throw Failure(message: "Configuração da webcam inválida.") } }
    guard duration >= 0.1 else { throw Failure(message: "Mantenha pelo menos 0,1 segundo de vídeo.") }
    let composition = AVMutableComposition()
    var insertionTime = CMTime.zero
    for range in ranges {
        let timeRange = CMTimeRange(start: CMTime(seconds: range.start, preferredTimescale: 60000), duration: CMTime(seconds: range.end - range.start, preferredTimescale: 60000))
        try await composition.insertTimeRange(timeRange, of: asset, at: insertionTime)
        let scaled = CMTime(seconds: range.duration, preferredTimescale: 60000)
        composition.scaleTimeRange(CMTimeRange(start: insertionTime, duration: timeRange.duration), toDuration: scaled)
        insertionTime = CMTimeAdd(insertionTime, scaled)
    }
    var musicTrack: AVMutableCompositionTrack?
    if let music = job.backgroundAudio {
        guard music.volume.isFinite && (0...1).contains(music.volume) else { throw Failure(message: "Volume da trilha de fundo inválido.") }
        let musicAsset = AVURLAsset(url: URL(fileURLWithPath: music.path))
        guard let sourceMusic = try await musicAsset.loadTracks(withMediaType: .audio).first else { throw Failure(message: "O arquivo escolhido não contém áudio.") }
        let sourceDuration = try await musicAsset.load(.duration)
        guard sourceDuration.seconds.isFinite && sourceDuration.seconds > 0 else { throw Failure(message: "Duração da trilha inválida.") }
        guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failure(message: "Não foi possível criar a faixa de música.") }
        var position = CMTime.zero
        while position < insertionTime {
            let remaining = CMTimeSubtract(insertionTime, position)
            let segment = CMTimeMinimum(sourceDuration, remaining)
            try track.insertTimeRange(CMTimeRange(start: .zero, duration: segment), of: sourceMusic, at: position)
            position = CMTimeAdd(position, segment)
        }
        musicTrack = track
    }
    var clickTracks: [AVMutableCompositionTrack] = []
    let clickVolume = job.appearance.clickSoundVolume ?? 0.3
    if job.appearance.clickSounds != false, clickVolume > 0, let root = job.assetsRoot {
        let clickURL = URL(fileURLWithPath: root).appendingPathComponent("mouse-click.wav")
        guard FileManager.default.fileExists(atPath: clickURL.path) else { throw Failure(message: "Som de clique não encontrado na biblioteca do aplicativo.") }
        let clickAsset = AVURLAsset(url: clickURL)
        guard let sourceClick = try await clickAsset.loadTracks(withMediaType: .audio).first else { throw Failure(message: "O efeito de clique não contém áudio.") }
        let availableClickDuration = try await clickAsset.load(.duration).seconds
        guard availableClickDuration.isFinite && availableClickDuration > 0 else { throw Failure(message: "Duração do efeito de clique inválida.") }
        let cursorEvents = job.rawCursor.flatMap { $0.isEmpty ? nil : $0 } ?? job.cursor
        var clickTimes: [Double] = [], wasPressed = false
        for point in cursorEvents {
            let pressed = point.down || point.rightDown == true || point.middleDown == true
            if pressed && !wasPressed { clickTimes.append(point.t) }
            wasPressed = pressed
        }
        var clickTrackEnds: [Double] = [], outputOffset = 0.0
        for range in ranges {
            for sourceTime in clickTimes where sourceTime >= range.start && sourceTime < range.end {
                let outputTime = outputOffset + (sourceTime - range.start) / range.rate
                let sampleDuration = min(availableClickDuration, max(0, duration - outputTime))
                guard sampleDuration > 0 else { continue }
                let trackIndex: Int
                if let reusable = clickTrackEnds.firstIndex(where: { $0 <= outputTime + 0.000001 }) {
                    trackIndex = reusable
                } else {
                    guard let newTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failure(message: "Não foi possível criar a faixa de efeitos sonoros.") }
                    clickTracks.append(newTrack); clickTrackEnds.append(0)
                    trackIndex = clickTracks.count - 1
                }
                let at = CMTime(seconds: outputTime, preferredTimescale: 60000)
                let segment = CMTimeRange(start: .zero, duration: CMTime(seconds: sampleDuration, preferredTimescale: 60000))
                try clickTracks[trackIndex].insertTimeRange(segment, of: sourceClick, at: at)
                clickTrackEnds[trackIndex] = outputTime + sampleDuration
            }
            outputOffset += range.duration
        }
    }
    guard let composedTrack = try await composition.loadTracks(withMediaType: .video).first else { throw Failure(message: "Cortes sem vídeo.") }
    let transform = try await track.load(.preferredTransform)
    let natural = try await track.load(.naturalSize)
    let oriented = CGRect(origin: .zero, size: natural).applying(transform)
    let sw = abs(oriented.width), sh = abs(oriented.height)
    let aspect = job.appearance.aspect == "16:9" ? 16.0 / 9 : job.appearance.aspect == "9:16" ? 9.0 / 16 : job.appearance.aspect == "1:1" ? 1 : sw / sh
    let shortEdge = Double(resolution), longEdge = shortEdge * 16 / 9
    let maxWidth = aspect >= 1 ? longEdge : shortEdge, maxHeight = aspect >= 1 ? shortEdge : longEdge
    let width = max(2, Int((min(maxWidth, maxHeight * aspect) / 2).rounded()) * 2)
    let height = max(2, Int((Double(width) / aspect / 2).rounded()) * 2)
    let w = CGFloat(width), h = CGFloat(height), canvas = CGRect(x: 0, y: 0, width: w, height: h)
    let padding = min(w, h) * job.appearance.padding / 100
    let fit = job.appearance.cropFill == true ? max((w - 2 * padding) / sw, (h - 2 * padding) / sh) : min((w - 2 * padding) / sw, (h - 2 * padding) / sh)
    let vw = sw * fit, vh = sh * fit
    let spanX = job.appearance.cropFill == true ? min(1, Double(w - 2 * padding) / Double(vw)) : 1
    let spanY = job.appearance.cropFill == true ? min(1, Double(h - 2 * padding) / Double(vh)) : 1
    let radius = job.appearance.radius * w / 1000
    let palette = palettes[max(0, min(palettes.count - 1, job.appearance.background))]
    let first = job.appearance.colors?.first?.replacingOccurrences(of: "#", with: "") ?? palette.0
    let last = job.appearance.backgroundMode == "color" ? first : job.appearance.colors?.last?.replacingOccurrences(of: "#", with: "") ?? palette.1
    var background = CIFilter(name: "CILinearGradient", parameters: ["inputPoint0": CIVector(x: 0, y: h), "inputPoint1": CIVector(x: w, y: 0), "inputColor0": color(first), "inputColor1": color(last)])!.outputImage!.cropped(to: canvas)
    if job.appearance.backgroundMode == "wallpaper", let id = job.appearance.wallpaper {
        let (image, _) = try visualAsset(id, kind: "wallpapers", root: job.assetsRoot)
        let cover = max(w / image.extent.width, h / image.extent.height)
        background = image.transformed(by: CGAffineTransform(scaleX: cover, y: cover))
        background = background.transformed(by: CGAffineTransform(translationX: (w - background.extent.width) / 2 - background.extent.minX, y: (h - background.extent.height) / 2 - background.extent.minY)).cropped(to: canvas)
    }
    if let blur = job.appearance.backgroundBlur, blur > 0 { background = background.clampedToExtent().applyingGaussianBlur(sigma: blur * w / 1920).cropped(to: canvas) }
    let context = CIContext(options: [.cacheIntermediates: false])
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    // Background stays in composition space; camera shadow follows the transformed recording layer.
    let backgroundImage = CIImage(cgImage: context.createCGImage(background, from: canvas)!)
    let reader = try AVAssetReader(asset: composition)
    reader.timeRange = CMTimeRange(start: .zero, duration: insertionTime)
    let output = AVAssetReaderTrackOutput(track: composedTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false; reader.add(output)
    var webcamReader: AVAssetReader?, webcamOutput: AVAssetReaderTrackOutput?, webcamTransform = CGAffineTransform.identity
    if let webcam = job.webcam {
        let asset = AVURLAsset(url: URL(fileURLWithPath: webcam.path))
        guard let cameraTrack = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "A gravação da webcam não contém vídeo.") }
        webcamTransform = try await cameraTrack.load(.preferredTransform)
        let faceReader = try AVAssetReader(asset: asset), faceOutput = AVAssetReaderTrackOutput(track: cameraTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        faceOutput.alwaysCopiesSampleData = false; faceReader.add(faceOutput); webcamReader = faceReader; webcamOutput = faceOutput
    }
    let audioTracks = try await composition.loadTracks(withMediaType: .audio)
    var audioOutput: AVAssetReaderAudioMixOutput?
    if !audioTracks.isEmpty {
        let ao = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM]); ao.audioTimePitchAlgorithm = .spectral
        var parameters: [AVAudioMixInputParameters] = []
        if let musicTrack = musicTrack, let music = job.backgroundAudio {
            let musicParameters = AVMutableAudioMixInputParameters(track: musicTrack); musicParameters.setVolume(Float(music.volume), at: .zero)
            parameters.append(musicParameters)
        }
        for clickTrack in clickTracks {
            let clickParameters = AVMutableAudioMixInputParameters(track: clickTrack); clickParameters.setVolume(Float(clickVolume), at: .zero)
            parameters.append(clickParameters)
        }
        if !parameters.isEmpty { let mix = AVMutableAudioMix(); mix.inputParameters = parameters; ao.audioMix = mix }
        reader.add(ao); audioOutput = ao
    }
    let destination = URL(fileURLWithPath: job.destination)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(".frame-\(UUID().uuidString).mp4")
    let writer = try AVAssetWriter(outputURL: temporary, fileType: .mp4)
    defer { if FileManager.default.fileExists(atPath: temporary.path) { try? FileManager.default.removeItem(at: temporary) } }
    let bitrate = videoBitrate(width: width, height: height, fps: fps)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitrate, AVVideoExpectedSourceFrameRateKey: fps, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoAllowFrameReorderingKey: false]])
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferIOSurfacePropertiesKey as String: [:]])
    guard writer.canAdd(input) else { throw Failure(message: "Encoder indisponível para esta resolução e taxa de quadros.") }
    writer.add(input)
    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
        let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000]); writer.add(ai); audioInput = ai
    }
    guard writer.startWriting(), reader.startReading(), webcamReader?.startReading() ?? true else { throw writer.error ?? reader.error ?? webcamReader?.error ?? Failure(message: "Não foi possível iniciar a exportação.") }
    writer.startSession(atSourceTime: .zero)
    var cursorCache: [String: (CIImage, Double, Double)] = [:]
    var cursorCatalog: [[String: Any]] = []
    if let root = job.assetsRoot {
        let data = try Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent("catalog.json"))
        cursorCatalog = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["cursors"] as? [[String: Any]] ?? []
    }
    func cursorStyle(_ kind: String?) throws -> (CIImage, Double, Double) {
        let role = kind ?? "pointer", theme = job.appearance.cursorTheme ?? "macos"
        if let cached = cursorCache[role] { return cached }
        func match(_ group: String, _ role: String) -> String? { cursorCatalog.first { $0["group"] as? String == group && ($0["label"] as? String)?.hasPrefix(role + "-") == true }?["id"] as? String }
        let id = job.appearance.cursorTheme == nil ? job.appearance.cursorAsset ?? match(theme, role) ?? match(theme, "pointer") : match(theme, role) ?? match("macos", role) ?? match(theme, "pointer") ?? match("macos", "pointer")
        guard let id = id else { return (makeCursor(size: job.appearance.cursorSize * w / 1000), 0, 0) }
        let (image, entry) = try visualAsset(id, kind: "cursors", root: job.assetsRoot)
        let visibleHeight = entry["visibleHeight"] as? Double ?? Double(image.extent.height)
        let scale = job.appearance.cursorSize * w / 1000 / max(1, visibleHeight)
        let style = (image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), entry["hotspotX"] as? Double ?? 0, entry["hotspotY"] as? Double ?? 0)
        cursorCache[role] = style; return style
    }
    var progress = -1
    var nextSample = output.copyNextSampleBuffer()
    var heldSample: CMSampleBuffer?
    var nextWebcamSample = webcamOutput?.copyNextSampleBuffer()
    var heldWebcamSample: CMSampleBuffer?
    var frameIndex: Int64 = 0
    let audioSource = audioOutput, audioSink = audioInput
    async let audioResult: Void = writeAudio(audioSource, audioSink, writer: writer, cancel: cancel)
    let cuts = job.keys.filter { $0.cut == true }.map { $0.t }
    var rangeIndex = 0, rangeOffset = 0.0
    while Double(frameIndex) / Double(fps) < duration {
        let time = Double(frameIndex) / Double(fps)
        while rangeIndex < ranges.count - 1 && time >= rangeOffset + ranges[rangeIndex].duration - 0.0000001 {
            rangeOffset += ranges[rangeIndex].duration; rangeIndex += 1
        }
        let sourceTime = min(ranges[rangeIndex].end, ranges[rangeIndex].start + (time - rangeOffset) * ranges[rangeIndex].rate)
        while let next = nextSample, CMSampleBufferGetPresentationTimeStamp(next).seconds <= time + 0.00001 {
            heldSample = next; nextSample = output.copyNextSampleBuffer()
        }
        while let next = nextWebcamSample, CMSampleBufferGetPresentationTimeStamp(next).seconds <= sourceTime + 0.00001 {
            heldWebcamSample = next; nextWebcamSample = webcamOutput?.copyNextSampleBuffer()
        }
        guard let sample = heldSample ?? nextSample else { break }
        let frameTime = CMTime(seconds: time, preferredTimescale: 600)
        if cancel.cancelled { reader.cancelReading(); writer.cancelWriting(); throw Failure(message: "Exportação cancelada.") }
        while !input.isReadyForMoreMediaData {
            if Task.isCancelled || cancel.cancelled || writer.status != .writing { reader.cancelReading(); writer.cancelWriting(); throw Failure(message: "Exportação interrompida.") }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        try autoreleasepool {
            guard let source = CMSampleBufferGetImageBuffer(sample), let pool = adaptor.pixelBufferPool else { throw Failure(message: "Frame inválido.") }
            var buffer: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer = buffer else { throw Failure(message: "Sem memória para o próximo frame.") }
            let pts = frameTime, t = sourceTime
            let range = ranges[rangeIndex]
            let events = range.cursorOriginal == true ? (job.rawCursor ?? job.cursor) : job.cursor
            let original = CIImage(cvPixelBuffer: source).transformed(by: transform)
            let sourceImage = original.transformed(by: CGAffineTransform(translationX: -original.extent.minX, y: -original.extent.minY))
            let samples = motionFrames(t, keys: job.keys, events: events, range: range, blur: job.appearance.motionBlur, cuts: cuts, spanX: spanX, spanY: spanY)
            let count = samples.count
            let frameCam = camera(t, job.keys)
            let frameBounds = CGRect(x: w / 2 - frameCam.x * vw * frameCam.scale, y: h / 2 - (1 - frameCam.y) * vh * frameCam.scale, width: vw * frameCam.scale, height: vh * frameCam.scale)
            var accumulated: CIImage?
            for (sampleCamera, point) in samples {
                var frame = sourceImage
                if job.cursorCaptured, let point = point, job.appearance.cursorSize > 0 {
                    let (cursorImage, hotspotX, hotspotY) = try cursorStyle(point.kind)
                    let cursor = cursorImage.transformed(by: CGAffineTransform(scaleX: 1 / fit, y: 1 / fit)).transformed(by: CGAffineTransform(translationX: point.x * sw - hotspotX * cursorImage.extent.width / fit, y: (1 - point.y) * sh - (1 - hotspotY) * cursorImage.extent.height / fit))
                    frame = cursor.composited(over: frame)
                }
                let scale = fit * sampleCamera.scale
                frame = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                    .transformed(by: CGAffineTransform(translationX: w / 2 - sampleCamera.x * vw * sampleCamera.scale, y: h / 2 - (1 - sampleCamera.y) * vh * sampleCamera.scale))
                    .cropped(to: canvas)
                if count > 1 {
                    let weight = 1 / Double(count)
                    frame = frame.applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: weight, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: weight, z: 0, w: 0), "inputBVector": CIVector(x: 0, y: 0, z: weight, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: weight)])
                }
                accumulated = accumulated.map { frame.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: $0]) } ?? frame
            }
            var frame = accumulated!
            for effect in job.effects ?? [] where t >= effect.start && t < effect.end {
                let effectX = 0.5 + (effect.x - 0.5) * spanX
                let effectY = 0.5 + (effect.y - 0.5) * spanY
                let effectWidth = effect.width * spanX * vw * frameCam.scale
                let effectHeight = effect.height * spanY * vh * frameCam.scale
                let centerX = w / 2 + (effectX - frameCam.x) * vw * frameCam.scale
                let centerY = h / 2 + (frameCam.y - effectY) * vh * frameCam.scale
                let rect = CGRect(x: centerX - effectWidth / 2, y: centerY - effectHeight / 2, width: effectWidth, height: effectHeight).intersection(frameBounds).intersection(canvas)
                guard !rect.isNull && !rect.isEmpty else { continue }
                let shape = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: rect), "inputRadius": 8 * w / 1920 * frameCam.scale, "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
                if effect.kind == "mask" {
                    let blurred = frame.clampedToExtent().applyingGaussianBlur(sigma: 14 * w / 1920).cropped(to: canvas)
                    frame = blurred.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frame, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                } else {
                    let color = CIImage(color: CIColor(red: 1, green: 0.78, blue: 0.16, alpha: effect.opacity)).cropped(to: canvas)
                    frame = color.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frame, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                }
            }
            var frameBackground = backgroundImage
            if job.appearance.backgroundMode == "video-blur" {
                let backgroundScale = max(w / sw, h / sh)
                let backgroundWidth = sw * backgroundScale, backgroundHeight = sh * backgroundScale
                let expanded = sourceImage.transformed(by: CGAffineTransform(scaleX: backgroundScale, y: backgroundScale))
                    .transformed(by: CGAffineTransform(translationX: (w - backgroundWidth) / 2, y: (h - backgroundHeight) / 2))
                let blurred = expanded.clampedToExtent().applyingGaussianBlur(sigma: max(0, (job.appearance.backgroundBlur ?? 18) * w / 1920)).cropped(to: canvas)
                    .applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 0.82, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0.82, z: 0, w: 0), "inputBVector": CIVector(x: 0, y: 0, z: 0.82, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0.9)])
                frameBackground = blurred.composited(over: backgroundImage).cropped(to: canvas)
            }
            let activeMask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: frameBounds), "inputRadius": min(radius * frameCam.scale, min(frameBounds.width, frameBounds.height) / 2), "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
            if job.appearance.shadow > 0 {
                let shadow = activeMask.applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: job.appearance.shadow / 100)]).transformed(by: CGAffineTransform(translationX: 0, y: -12 * w / 1920 * frameCam.scale)).applyingGaussianBlur(sigma: 18 * w / 1920 * frameCam.scale)
                frameBackground = shadow.composited(over: frameBackground).cropped(to: canvas)
            }
            var composed = frame.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frameBackground, kCIInputMaskImageKey: activeMask]).cropped(to: canvas)
            if let webcam = job.webcam, let sample = heldWebcamSample, let cameraBuffer = CMSampleBufferGetImageBuffer(sample) {
                let webcamPosition = plannedWebcamState(webcamState(webcam, sourceTime), webcam.mode, frameCam.scale, job.appearance.aspect, job.appearance.aspect == "9:16" ? 0.65 : 1.0)
                let raw = CIImage(cvPixelBuffer: cameraBuffer).transformed(by: webcamTransform)
                let upright = raw.transformed(by: CGAffineTransform(translationX: -raw.extent.minX, y: -raw.extent.minY))
                let portraitScale = job.appearance.aspect == "9:16" ? 0.65 : 1.0
                let side = min(w, h) * webcamPosition.size * portraitScale
                let centerX = webcamPosition.x * w
                let centerY = (1 - webcamPosition.y) * h
                let cameraRect = CGRect(x: centerX - side / 2, y: centerY - side / 2, width: side, height: side)
                if !cameraRect.intersection(canvas).isNull && !cameraRect.intersection(canvas).isEmpty {
                    let opacity = max(0, min(1, webcamPosition.opacity ?? webcam.opacity ?? 1))
                    let border = max(0, min(side * 0.08, (webcam.border ?? 2) * w / 1000))
                    let radius = webcam.shape == "circle" ? side / 2 : side * max(0, min(0.5, webcamPosition.borderRadius ?? webcam.borderRadius ?? (webcam.shape == "rounded" ? 0.18 : 0)))
                    let outerMask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: cameraRect), "inputRadius": radius, "inputColor": CIColor(red: 1, green: 1, blue: 1, alpha: opacity)])!.outputImage!.cropped(to: canvas)
                    let shadowStrength = max(0, min(1, (webcam.shadow ?? 35) / 100))
                    if shadowStrength > 0 {
                        let shadow = outerMask.transformed(by: CGAffineTransform(translationX: 0, y: -side * 0.025)).applyingGaussianBlur(sigma: side * 0.055).cropped(to: canvas)
                        let shadowColor = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: shadowStrength)).cropped(to: canvas)
                        composed = shadowColor.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: composed, kCIInputMaskImageKey: shadow]).cropped(to: canvas)
                    }
                    let borderColor = CIImage(color: CIColor.white).cropped(to: cameraRect).applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: composed, kCIInputMaskImageKey: outerMask])
                    let inset = border
                    let innerRect = cameraRect.insetBy(dx: inset, dy: inset)
                    let innerRadius = max(0, radius - inset)
                    let innerMask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: innerRect), "inputRadius": innerRadius, "inputColor": CIColor(red: 1, green: 1, blue: 1, alpha: opacity)])!.outputImage!.cropped(to: canvas)
                    let cover = max(innerRect.width / upright.extent.width, innerRect.height / upright.extent.height), scaled = upright.transformed(by: CGAffineTransform(scaleX: cover, y: cover))
                    let cameraImage = scaled.transformed(by: CGAffineTransform(translationX: centerX - scaled.extent.midX, y: centerY - scaled.extent.midY)).cropped(to: innerRect.intersection(canvas))
                    composed = cameraImage.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: borderColor, kCIInputMaskImageKey: innerMask]).cropped(to: canvas)
                }
            }
            context.render(composed, to: buffer, bounds: canvas, colorSpace: space)
            guard adaptor.append(buffer, withPresentationTime: pts) else { throw writer.error ?? Failure(message: "Falha ao escrever frame.") }
            let pct = Int(100 * time / duration)
            if pct != progress { progress = pct; emit(["event": "progress", "progress": min(99, pct)]) }
        }
        frameIndex += 1
    }
    input.markAsFinished()
    try await audioResult
    // Drain the last held read buffer so AVAssetReader can reach completed.
    while output.copyNextSampleBuffer() != nil {}
    webcamReader?.cancelReading()
    guard reader.status == .completed else { writer.cancelWriting(); throw reader.error ?? Failure(message: "Falha ao ler o vídeo.") }
    writer.endSession(atSourceTime: insertionTime)
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? Failure(message: "Falha ao finalizar MP4.") }
    if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary) }
    else { try FileManager.default.moveItem(at: temporary, to: destination) }
    emit(["event": "exported", "path": destination.path])
}
func writeAudio(_ output: AVAssetReaderOutput?, _ input: AVAssetWriterInput?, writer: AVAssetWriter, cancel: Cancellation) async throws {
    guard let output = output, let input = input else { return }
    do {
        while let sample = output.copyNextSampleBuffer() {
            while !input.isReadyForMoreMediaData {
                if Task.isCancelled || cancel.cancelled || writer.status != .writing { throw Failure(message: "Exportação interrompida.") }
                try await Task.sleep(nanoseconds: 2_000_000)
            }
            guard input.append(sample) else { throw writer.error ?? Failure(message: "Falha no áudio.") }
        }
        input.markAsFinished()
    } catch { writer.cancelWriting(); throw error }
}
func makeCursor(size: Double) -> CIImage {
    let s = max(1, size), rect = CGRect(x: 0, y: 0, width: s * 0.8, height: s * 1.2)
    let context = CGContext(data: nil, width: Int(ceil(rect.width)), height: Int(ceil(rect.height)), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.translateBy(x: 1, y: rect.height - 1); context.scaleBy(x: s / 24, y: -s / 24)
    context.move(to: CGPoint(x: 0, y: 0)); context.addLine(to: CGPoint(x: 0, y: 23)); context.addLine(to: CGPoint(x: 6, y: 17)); context.addLine(to: CGPoint(x: 10, y: 26)); context.addLine(to: CGPoint(x: 14, y: 24)); context.addLine(to: CGPoint(x: 10, y: 15)); context.addLine(to: CGPoint(x: 18, y: 15)); context.closePath()
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.setStrokeColor(CGColor(gray: 0, alpha: 0.9)); context.setLineWidth(1.3); context.drawPath(using: .fillStroke)
    return CIImage(cgImage: context.makeImage()!)
}

@main struct Main {
    @MainActor static func main() async {
        do {
            let args = CommandLine.arguments
            guard args.count >= 2 else { throw Failure(message: "Comando ausente.") }
            switch args[1] {
            case "camera-preview":
                let status = AVCaptureDevice.authorizationStatus(for: .video)
                let allowed: Bool
                if status == .authorized { allowed = true }
                else if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
                else { allowed = false }
                guard allowed else { throw Failure(message: "Acesso à webcam negado. Autorize a câmera em Ajustes do Sistema > Privacidade e Segurança > Câmera.") }
                let preview = CameraPreview()
                try preview.start()
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.global().async { _ = readLine(); continuation.resume() } }
                preview.session.stopRunning()
            case "preview":
                let source = URL(fileURLWithPath: args[2]), package = URL(fileURLWithPath: args[3])
                let folder = package.appendingPathComponent("QuickLook", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let generator = AVAssetImageGenerator(asset: AVURLAsset(url: source))
                generator.appliesPreferredTrackTransform = true; generator.maximumSize = CGSize(width: 960, height: 600)
                let frame = try await generator.image(at: .zero).image
                let image = NSBitmapImageRep(cgImage: frame)
                let destination = folder.appendingPathComponent("Preview.png")
                try image.representation(using: .png, properties: [:])!.write(to: destination, options: .atomic)
                let icon = NSImage(cgImage: frame, size: .zero)
                let iconSet = NSWorkspace.shared.setIcon(icon, forFile: package.path, options: [])
                emit(["event": "preview", "path": destination.path, "iconSet": iconSet])
            case "inspect": try await emitMedia(metadata(args[2]))
            case "record":
                // ScreenCaptureKit requests authorization itself; its result is authoritative.
                let cameraPath = args.count > 3 ? args[3] : nil
                if cameraPath != nil {
                    let status = AVCaptureDevice.authorizationStatus(for: .video)
                    var allowed = status == .authorized
                    if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
                    guard allowed else { throw Failure(message: "Acesso à webcam negado. Autorize a câmera do Frame Studio em Ajustes do Sistema > Privacidade e Segurança > Câmera.") }
                }
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw Failure(message: "Monitor principal não encontrado.") }
                let ownWindows = content.windows.filter { $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier }
                let config = SCStreamConfiguration()
                let (width, height) = captureSize(width: CGDisplayPixelsWide(display.displayID), height: CGDisplayPixelsHigh(display.displayID))
                config.width = width; config.height = height
                config.minimumFrameInterval = CMTime(value: 1, timescale: 60); config.queueDepth = 3; config.showsCursor = false; config.capturesAudio = false; config.pixelFormat = kCVPixelFormatType_32BGRA
                let capture = try Capture(path: args[2], bounds: CGDisplayBounds(display.displayID), width: config.width, height: config.height, cameraPath: cameraPath)
                let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: ownWindows), configuration: config, delegate: capture)
                capture.stream = stream; try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: capture.queue)
                capture.begin(); try await stream.startCapture()
                // stdin is a private control pipe from Rust; EOF also finalizes the file.
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.global().async { _ = readLine(); continuation.resume() } }
                try await capture.finish(); try await emitMedia(metadata(args[2]))
            case "export":
                let job = try JSONDecoder().decode(ExportJob.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
                let cancel = Cancellation(); DispatchQueue.global().async { _ = readLine(); cancel.cancel() }
                try await exportVideo(job, cancel: cancel)
            default: throw Failure(message: "Comando desconhecido.")
            }
        } catch {
            let native = error as NSError
            if native.domain == SCStreamErrorDomain && native.code == -3801 {
                emit(["event": "error", "message": "Permissão de gravação de tela bloqueada para o Frame Studio. Nos Ajustes, remova a entrada antiga do Frame Studio e adicione este aplicativo novamente. Autorizar apenas o Screen Studio não autoriza o Frame Studio. Depois, feche e reabra o Frame Studio.", "code": "screen-capture-permission"])
            } else { emit(["event": "error", "message": error.localizedDescription]) }
            exit(1)
        }
    }
}
