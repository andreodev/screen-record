import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreImage

struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) }
}
struct Pointer: Codable { var t: Double; var x: Double; var y: Double; var down: Bool }
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

// shortcut: polling at 120 Hz may miss brief clicks; replace with a mouse-only event tap when integrating its permissions.
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "frame.capture")
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let path: String
    let bounds: CGRect
    var stream: SCStream?
    var timer: DispatchSourceTimer?
    var start: CMTime?
    var last: CMTime?
    var lastSample: CMSampleBuffer?
    var pointers: [Pointer] = []
    var failure: Error?
    init(path: String, bounds: CGRect, width: Int, height: Int) throws {
        self.path = path; self.bounds = bounds
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000]])
        input.expectsMediaDataInRealTime = true
        super.init()
        guard writer.canAdd(input) else { throw Failure(message: "Encoder H.264 indisponível.") }
        writer.add(input)
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failure = error }; emit(["event": "capture-error", "message": error.localizedDescription]) }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid, CMSampleBufferGetImageBuffer(sample) != nil else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]], let raw = attachments.first?[.status] as? Int, raw != SCFrameStatus.complete.rawValue { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if start == nil {
            guard writer.startWriting() else { failure = writer.error; return }
            writer.startSession(atSourceTime: pts); start = pts
            emit(["event": "started"])
        }
        if input.isReadyForMoreMediaData {
            if !input.append(sample) { failure = writer.error }
            last = pts; lastSample = sample
        }
    }
    func begin() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 1.0 / 120)
        timer.setEventHandler { [weak self] in
            guard let self = self, let start = self.start, let event = CGEvent(source: nil) else { return }
            let t = CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), start).seconds
            let p = event.location
            if t >= 0 {
                self.pointers.append(Pointer(t: t, x: min(1, max(0, (p.x - self.bounds.minX) / self.bounds.width)), y: min(1, max(0, (p.y - self.bounds.minY) / self.bounds.height)), down: CGEventSource.buttonState(.combinedSessionState, button: .left)))
            }
        }
        timer.resume(); self.timer = timer
    }
    func finish() async throws {
        try await stream?.stopCapture()
        queue.sync {
            timer?.cancel(); timer = nil
            // ScreenCaptureKit can stop sending complete frames while the screen is static.
            // Extend the last image to the stop time so idle periods are not trimmed away.
            let stop = CMClockGetTime(CMClockGetHostTimeClock())
            if let sample = lastSample, let last = last, stop.seconds - last.seconds > 1.0 / 30, input.isReadyForMoreMediaData {
                var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30), presentationTimeStamp: stop, decodeTimeStamp: .invalid)
                var copy: CMSampleBuffer?
                if CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy) == noErr, let copy = copy {
                    if !input.append(copy) { failure = writer.error }
                }
            }
            if start != nil { writer.endSession(atSourceTime: stop) }
            input.markAsFinished()
        }
        if let failure = queue.sync(execute: { self.failure }) { writer.cancelWriting(); throw failure }
        guard queue.sync(execute: { start != nil }) else { throw Failure(message: "Nenhum frame recebido. Confira a permissão de gravação de tela.") }
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? Failure(message: "Não foi possível finalizar o vídeo.") }
        let events = queue.sync { pointers }
        try JSONEncoder().encode(events).write(to: URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("cursor.json"), options: .atomic)
    }
}

struct Key: Codable { let t: Double; let x: Double; let y: Double; let scale: Double }
struct Look: Codable { let background: Int; let padding: Double; let radius: Double; let shadow: Double; let cursorSize: Double; let smooth: Bool; let aspect: String; let colors: [String]?; let backgroundMode: String?; let cursorSmooth: Bool?; let wallpaper: String?; let cursorAsset: String?; let backgroundBlur: Double? }
struct ExportJob: Codable { let source: String; let destination: String; let start: Double; let end: Double; let appearance: Look; let keys: [Key]; let cursor: [Pointer]; let cursorCaptured: Bool; let assetsRoot: String? }
final class Cancellation: @unchecked Sendable { let lock = NSLock(); var value = false; func cancel() { lock.lock(); value = true; lock.unlock() }; var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return value } }
func mix(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
func camera(_ time: Double, _ keys: [Key]) -> Key {
    guard !keys.isEmpty else { return Key(t: time, x: 0.5, y: 0.5, scale: 1) }
    var low = 0, high = keys.count
    while low < high { let m = (low + high) / 2; if keys[m].t <= time { low = m + 1 } else { high = m } }
    let a = keys[max(0, low - 1)], b = keys[min(low, keys.count - 1)]
    let u = b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    return Key(t: time, x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), scale: mix(a.scale, b.scale, u))
}
func pointer(_ time: Double, _ events: [Pointer]) -> Pointer? {
    guard !events.isEmpty else { return nil }
    var low = 0, high = events.count
    while low < high { let m = (low + high) / 2; if events[m].t <= time { low = m + 1 } else { high = m } }
    let a = events[max(0, low - 1)], b = events[min(low, events.count - 1)]
    let u = b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    return Pointer(t: time, x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), down: a.down)
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
    let asset = AVURLAsset(url: URL(fileURLWithPath: job.source))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "Vídeo não encontrado.") }
    let transform = try await track.load(.preferredTransform)
    let natural = try await track.load(.naturalSize)
    let oriented = CGRect(origin: .zero, size: natural).applying(transform)
    let sw = abs(oriented.width), sh = abs(oriented.height)
    let aspect = job.appearance.aspect == "16:9" ? 16.0 / 9 : job.appearance.aspect == "9:16" ? 9.0 / 16 : job.appearance.aspect == "1:1" ? 1 : sw / sh
    let maxWidth = aspect >= 1 ? 1920.0 : 1080.0, maxHeight = aspect >= 1 ? 1080.0 : 1920.0
    let width = max(2, Int((min(maxWidth, maxHeight * aspect) / 2).rounded()) * 2)
    let height = max(2, Int((Double(width) / aspect / 2).rounded()) * 2)
    let w = CGFloat(width), h = CGFloat(height), canvas = CGRect(x: 0, y: 0, width: w, height: h)
    let padding = min(w, h) * job.appearance.padding / 100
    let fit = min((w - 2 * padding) / sw, (h - 2 * padding) / sh)
    let vw = sw * fit, vh = sh * fit, vx = (w - vw) / 2, vy = (h - vh) / 2
    let viewport = CGRect(x: vx, y: vy, width: vw, height: vh)
    let radius = job.appearance.radius * w / 1000
    let mask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: viewport), "inputRadius": radius, "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
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
    let shadow = mask.applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: job.appearance.shadow / 100)]).transformed(by: CGAffineTransform(translationX: 0, y: -12)).applyingGaussianBlur(sigma: 18)
    let base = shadow.composited(over: background).cropped(to: canvas)
    let context = CIContext(options: [.cacheIntermediates: false])
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    // Cache static layers once, not one full-size blur/gradient per video frame.
    let baseImage = CIImage(cgImage: context.createCGImage(base, from: canvas)!)
    let maskImage = CIImage(cgImage: context.createCGImage(mask, from: canvas)!)
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: job.start, preferredTimescale: 600), end: CMTime(seconds: job.end, preferredTimescale: 600))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false; reader.add(output)
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    var audioOutput: AVAssetReaderTrackOutput?
    if let audioTrack = audioTracks.first {
        let ao = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM]); reader.add(ao); audioOutput = ao
    }
    let destination = URL(fileURLWithPath: job.destination)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(".frame-\(UUID().uuidString).mp4")
    let writer = try AVAssetWriter(outputURL: temporary, fileType: .mp4)
    defer { if FileManager.default.fileExists(atPath: temporary.path) { try? FileManager.default.removeItem(at: temporary) } }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000, AVVideoExpectedSourceFrameRateKey: 30]])
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferIOSurfacePropertiesKey as String: [:]])
    writer.add(input)
    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
        let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000]); writer.add(ai); audioInput = ai
    }
    guard writer.startWriting(), reader.startReading() else { throw writer.error ?? reader.error ?? Failure(message: "Não foi possível iniciar a exportação.") }
    writer.startSession(atSourceTime: CMTime(seconds: job.start, preferredTimescale: 600))
    var cursorImage = makeCursor(size: job.appearance.cursorSize * w / 1000)
    var hotspotX = 0.0, hotspotY = 0.0
    if let id = job.appearance.cursorAsset {
        let (image, entry) = try visualAsset(id, kind: "cursors", root: job.assetsRoot)
        let scale = max(1, job.appearance.cursorSize * w / 1000 * 1.2) / image.extent.height
        cursorImage = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        hotspotX = entry["hotspotX"] as? Double ?? 0; hotspotY = entry["hotspotY"] as? Double ?? 0
    }
    var progress = -1
    var nextSample = output.copyNextSampleBuffer()
    var heldSample: CMSampleBuffer?
    var frameIndex: Int64 = 0
    let audioSource = audioOutput, audioSink = audioInput
    async let audioResult: Void = writeAudio(audioSource, audioSink, writer: writer, cancel: cancel)
    while Double(frameIndex) / 30 < job.end - job.start {
        let time = job.start + Double(frameIndex) / 30
        while let next = nextSample, CMSampleBufferGetPresentationTimeStamp(next).seconds <= time + 0.00001 {
            heldSample = next; nextSample = output.copyNextSampleBuffer()
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
            let pts = frameTime, t = time
            let cam = camera(t, job.keys)
            var frame = CIImage(cvPixelBuffer: source).transformed(by: transform)
            frame = frame.transformed(by: CGAffineTransform(translationX: -frame.extent.minX, y: -frame.extent.minY))
            if job.cursorCaptured, let point = pointer(t, job.cursor), job.appearance.cursorSize > 0 {
                let cursor = cursorImage.transformed(by: CGAffineTransform(scaleX: 1 / fit, y: 1 / fit)).transformed(by: CGAffineTransform(translationX: point.x * sw - hotspotX * cursorImage.extent.width / fit, y: (1 - point.y) * sh - (1 - hotspotY) * cursorImage.extent.height / fit))
                frame = cursor.composited(over: frame)
            }
            let scale = fit * cam.scale
            frame = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale)).transformed(by: CGAffineTransform(translationX: vx + vw / 2 - cam.x * sw * scale, y: vy + vh / 2 - (1 - cam.y) * sh * scale))
            let composed = frame.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: baseImage, kCIInputMaskImageKey: maskImage]).cropped(to: canvas)
            context.render(composed, to: buffer, bounds: canvas, colorSpace: space)
            guard adaptor.append(buffer, withPresentationTime: pts) else { throw writer.error ?? Failure(message: "Falha ao escrever frame.") }
            let pct = Int(100 * (t - job.start) / (job.end - job.start))
            if pct != progress { progress = pct; emit(["event": "progress", "progress": min(99, pct)]) }
        }
        frameIndex += 1
    }
    input.markAsFinished()
    try await audioResult
    // Drain the last held read buffer so AVAssetReader can reach completed.
    while output.copyNextSampleBuffer() != nil {}
    guard reader.status == .completed else { writer.cancelWriting(); throw reader.error ?? Failure(message: "Falha ao ler o vídeo.") }
    writer.endSession(atSourceTime: CMTime(seconds: job.end, preferredTimescale: 600))
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? Failure(message: "Falha ao finalizar MP4.") }
    if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary) }
    else { try FileManager.default.moveItem(at: temporary, to: destination) }
    emit(["event": "exported", "path": destination.path])
}
func writeAudio(_ output: AVAssetReaderTrackOutput?, _ input: AVAssetWriterInput?, writer: AVAssetWriter, cancel: Cancellation) async throws {
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
                guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else { throw Failure(message: "O macOS bloqueou a gravação. Autorize Frame Studio (ou frame-native) em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela e Áudio do Sistema e reabra o app.") }
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw Failure(message: "Monitor principal não encontrado.") }
                let config = SCStreamConfiguration(); let ratio = Double(display.width) / Double(display.height)
                config.width = Int((min(1920, 1080 * ratio) / 2).rounded()) * 2; config.height = Int((Double(config.width) / ratio / 2).rounded()) * 2
                config.minimumFrameInterval = CMTime(value: 1, timescale: 30); config.queueDepth = 3; config.showsCursor = false; config.capturesAudio = false; config.pixelFormat = kCVPixelFormatType_32BGRA
                let capture = try Capture(path: args[2], bounds: CGDisplayBounds(display.displayID), width: config.width, height: config.height)
                let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: capture)
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
        } catch { emit(["event": "error", "message": error.localizedDescription]); exit(1) }
    }
}
