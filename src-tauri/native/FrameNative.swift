import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreImage
import ImageIO

struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
let emitLock = NSLock()
func emit(_ value: [String: Any]) {
    emitLock.lock(); defer { emitLock.unlock() }
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) }
}
struct Pointer: Codable { var t: Double; var x: Double; var y: Double; var down: Bool; var kind: String? = nil; var rightDown: Bool? = nil; var middleDown: Bool? = nil; var typing: Bool? = nil }
struct Media: Codable { var path: String; var duration: Double; var width: Int; var height: Int; var cursor: [Pointer]; var cursorCaptured: Bool; var hasAudio: Bool = false }
func metadata(_ path: String) async throws -> Media {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "O arquivo não contém vídeo.") }
    let duration = try await asset.load(.duration).seconds
    let size = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let rect = CGRect(origin: .zero, size: size).applying(transform)
    guard duration.isFinite, duration > 0 else { throw Failure(message: "Duração de vídeo inválida.") }
    var media = Media(path: path, duration: duration, width: Int(abs(rect.width)), height: Int(abs(rect.height)), cursor: [], cursorCaptured: false)
    media.hasAudio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
    let sidecar = URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("cursor.json")
    if let attributes = try? FileManager.default.attributesOfItem(atPath: sidecar.path), let bytes = attributes[.size] as? NSNumber, bytes.intValue <= 50_000_000, let data = try? Data(contentsOf: sidecar), let events = try? JSONDecoder().decode([Pointer].self, from: data), events.allSatisfy({ $0.t.isFinite && $0.x.isFinite && $0.y.isFinite && $0.t >= 0 && (0...1).contains($0.x) && (0...1).contains($0.y) }), zip(events, events.dropFirst()).allSatisfy({ $0.t <= $1.t }) {
        media.cursor = events; media.cursorCaptured = true
    }
    return media
}
func analyzeAudio(_ path: String) async throws {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw Failure(message: "Nenhuma faixa de áudio para analisar.") }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    guard reader.canAdd(output) else { throw Failure(message: "Não foi possível analisar este áudio.") }
    reader.add(output); guard reader.startReading() else { throw reader.error ?? Failure(message: "Não foi possível ler o áudio.") }
    let duration = try await asset.load(.duration).seconds, step = 0.1
    guard duration.isFinite, duration > 0, duration <= 14400 else { throw Failure(message: "A análise aceita áudio de até 4 horas.") }
    var sums = [Double](repeating: 0, count: Int(ceil(duration / step))), counts = [Int](repeating: 0, count: Int(ceil(duration / step)))
    while let sample = output.copyNextSampleBuffer() {
        try autoreleasepool {
            guard let block = CMSampleBufferGetDataBuffer(sample), let format = CMSampleBufferGetFormatDescription(sample), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format) else { throw Failure(message: "Amostra de áudio inválida.") }
            let channels = max(1, Int(asbd.pointee.mChannelsPerFrame)), rate = asbd.pointee.mSampleRate, start = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            guard rate > 0, start.isFinite else { throw Failure(message: "Relógio do áudio inválido.") }
            let size = CMBlockBufferGetDataLength(block), frames = size / MemoryLayout<Float>.size / channels
            var values = [Float](repeating: 0, count: frames * channels)
            let status = values.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: $0.count, destination: $0.baseAddress!) }
            guard status == kCMBlockBufferNoErr else { throw Failure(message: "Não foi possível analisar as amostras de áudio.") }
            for frame in 0..<frames {
                let bucket = Int(floor((start + Double(frame) / rate) / step))
                if bucket < 0 || bucket >= sums.count { continue }
                for channel in 0..<channels { let value = Double(values[frame * channels + channel]); sums[bucket] += value.isFinite ? value * value : 0; counts[bucket] += 1 }
            }
        }
    }
    guard reader.status == .completed else { throw reader.error ?? Failure(message: "Falha ao analisar o áudio.") }
    emit(["event": "analysis", "step": step, "duration": duration, "levels": zip(sums, counts).map { $1 > 0 ? sqrt($0 / Double($1)) : 0 }])
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

func captureSize(width: Int, height: Int, resolution: Int = 2160) -> (Int, Int) {
    let landscape = width >= height
    let short = Double(resolution), long = short * 16 / 9
    let maxWidth = landscape ? long : short, maxHeight = landscape ? short : long
    let scale = min(1, maxWidth / Double(width), maxHeight / Double(height))
    return (max(2, Int(floor(Double(width) * scale / 2)) * 2), max(2, Int(floor(Double(height) * scale / 2)) * 2))
}
struct RecordingArea: Decodable { let x: Double; let y: Double; let width: Double; let height: Double }
struct RecordingSource: Decodable { let kind: String; let id: UInt32; let area: RecordingArea? }
struct RecordingOptions: Decodable { let source: RecordingSource?; let resolution: Int?; let fps: Int?; let cameraDevice: String? }
func recordingOptions() throws -> RecordingOptions {
    try JSONDecoder().decode(RecordingOptions.self, from: Data((ProcessInfo.processInfo.environment["FRAME_CAPTURE_OPTIONS"] ?? "{}").utf8))
}
func isFloatingPreview(_ owner: Int32?, _ title: String?) -> Bool {
    guard let parent = ProcessInfo.processInfo.environment["FRAME_PREVIEW_OWNER_PID"].flatMap(Int32.init) else { return false }
    return owner == parent && title == "Frame Studio — Webcam"
}
func cameraDevices() -> [AVCaptureDevice] {
    let types: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) { types = [.builtInWideAngleCamera, .external, .continuityCamera] }
    else { types = [.builtInWideAngleCamera, .externalUnknown] }
    return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
}
func cameraDevice(_ id: String?) throws -> AVCaptureDevice {
    if let id = id, !id.isEmpty {
        guard let device = cameraDevices().first(where: { $0.uniqueID == id }) else { throw Failure(message: "A câmera selecionada foi desconectada. Escolha outra webcam.") }
        return device
    }
    guard let device = AVCaptureDevice.default(for: .video) else { throw Failure(message: "Nenhuma webcam disponível.") }
    return device
}
func captureRegion(_ source: RecordingSource?, _ displays: [SCDisplay], _ windows: [SCWindow]) throws -> (SCContentFilter, CGRect, CGRect?, UInt32) {
    if let source = source, source.kind == "window" {
        guard let window = windows.first(where: { $0.windowID == source.id }), window.frame.width >= 32, window.frame.height >= 32 else { throw Failure(message: "A janela selecionada foi fechada ou está indisponível. Selecione outra fonte.") }
        guard !isFloatingPreview(window.owningApplication?.processID, window.title) else { throw Failure(message: "A prévia da webcam não pode ser usada como fonte de captura.") }
        let display = displays.max { $0.frame.intersection(window.frame).width * $0.frame.intersection(window.frame).height < $1.frame.intersection(window.frame).width * $1.frame.intersection(window.frame).height }
        guard let display = display else { throw Failure(message: "Monitor da janela indisponível.") }
        return (SCContentFilter(desktopIndependentWindow: window), window.frame, nil, display.displayID)
    }
    let id = source?.id ?? CGMainDisplayID()
    guard let display = displays.first(where: { $0.displayID == id }) else { throw Failure(message: "O monitor selecionado foi desconectado. Selecione outra fonte.") }
    let bounds = CGDisplayBounds(display.displayID)
    let own = windows.filter { $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier || isFloatingPreview($0.owningApplication?.processID, $0.title) }
    if let source = source, source.kind == "area", let area = source.area {
        let rect = CGRect(x: area.x, y: area.y, width: area.width, height: area.height)
        guard area.x.isFinite, area.y.isFinite, area.width.isFinite, area.height.isFinite, rect.width >= 32, rect.height >= 32, CGRect(origin: .zero, size: bounds.size).contains(rect) else { throw Failure(message: "A área deve ficar dentro do monitor selecionado.") }
        return (SCContentFilter(display: display, excludingWindows: own), rect.offsetBy(dx: bounds.minX, dy: bounds.minY), rect, display.displayID)
    }
    return (SCContentFilter(display: display, excludingWindows: own), bounds, nil, display.displayID)
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
    func start(deviceID: String? = nil) throws {
        let device = try cameraDevice(deviceID)
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

func relativeAudioSample(_ sample: CMSampleBuffer, origin: CMTime) throws -> CMSampleBuffer? {
    let pts = CMTimeSubtract(CMSampleBufferGetPresentationTimeStamp(sample), origin)
    guard pts >= .zero else { return nil }
    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(sample, at: 0, timingInfoOut: &timing) == noErr else { throw Failure(message: "Timestamp de áudio inválido.") }
    timing.presentationTimeStamp = pts
    if timing.decodeTimeStamp.isValid { timing.decodeTimeStamp = CMTimeSubtract(timing.decodeTimeStamp, origin) }
    var result: CMSampleBuffer?
    guard CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &result) == noErr, let result = result else { throw Failure(message: "Não foi possível sincronizar o áudio.") }
    return result
}
final class MicrophoneRecording {
    let path: String
    var writer: AVAssetWriter?
    var input: AVAssetWriterInput?
    var samples = 0
    var pending: [CMSampleBuffer] = []
    init(path: String) { self.path = path }
    func append(_ sample: CMSampleBuffer, origin: CMTime) throws {
        guard let sample = try relativeAudioSample(sample, origin: origin) else { return }
        if writer == nil {
            guard let format = CMSampleBufferGetFormatDescription(sample), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format) else { throw Failure(message: "Formato do microfone inválido.") }
            let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .m4a)
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: asbd.pointee.mSampleRate, AVNumberOfChannelsKey: min(2, max(1, Int(asbd.pointee.mChannelsPerFrame))), AVEncoderBitRateKey: 128000])
            input.expectsMediaDataInRealTime = true
            guard writer.canAdd(input) else { throw Failure(message: "Encoder do microfone indisponível.") }
            writer.add(input)
            guard writer.startWriting() else { throw writer.error ?? Failure(message: "Não foi possível iniciar o áudio do microfone.") }
            writer.startSession(atSourceTime: .zero); self.writer = writer; self.input = input
            // Audio-only M4A normalizes away an empty leading edit. Encode real silence to preserve the screen clock.
            let delay = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            guard delay.isFinite && delay <= 30 else { throw Failure(message: "O microfone iniciou fora do relógio da captura.") }
            let count = Int((delay * asbd.pointee.mSampleRate).rounded())
            if count > 0 {
                let audioFormat = AVAudioFormat(cmAudioFormatDescription: format)
                guard let pcm = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: AVAudioFrameCount(count)) else { throw Failure(message: "Não foi possível sincronizar o início do microfone.") }
                pcm.frameLength = AVAudioFrameCount(count)
                for buffer in UnsafeMutableAudioBufferListPointer(pcm.mutableAudioBufferList) { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } }
                var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: CMTimeScale(asbd.pointee.mSampleRate)), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
                var silence: CMSampleBuffer?
                guard CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: format, sampleCount: count, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &silence) == noErr, let silence = silence,
                    CMSampleBufferSetDataBufferFromAudioBufferList(silence, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: pcm.audioBufferList) == noErr else { throw Failure(message: "Não foi possível criar o silêncio inicial do microfone.") }
                CMSampleBufferSetDataReady(silence); pending.append(silence)
            }
        }
        guard pending.count < 128 else { throw Failure(message: "O encoder do microfone não acompanha a captura.") }
        pending.append(sample); try drain()
    }
    func drain() throws {
        guard let writer = writer, let input = input else { return }
        guard writer.status == .writing else { throw writer.error ?? Failure(message: "O encoder do microfone parou.") }
        while !pending.isEmpty && input.isReadyForMoreMediaData {
            guard input.append(pending.removeFirst()) else { throw writer.error ?? Failure(message: "Falha ao gravar o microfone.") }
            samples += 1
        }
    }
    func finish(at duration: CMTime) async throws {
        guard let writer = writer, let input = input else { throw Failure(message: "Nenhum áudio recebido do microfone.") }
        let deadline = Date().addingTimeInterval(10)
        while !pending.isEmpty {
            try drain()
            if !pending.isEmpty { guard Date() < deadline else { throw Failure(message: "O encoder do microfone não finalizou o áudio.") }; try await Task.sleep(nanoseconds: 1_000_000) }
        }
        guard samples > 0 else { throw Failure(message: "Nenhum áudio recebido do microfone.") }
        writer.endSession(atSourceTime: duration); input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? Failure(message: "Falha ao finalizar o áudio do microfone.") }
    }
}

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    let queue = DispatchQueue(label: "frame.capture")
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let path: String
    var bounds: CGRect
    var windowID: UInt32?
    let fps: Int
    var systemAudioInput: AVAssetWriterInput?
    var microphoneSession: AVCaptureSession?
    let microphoneSessionQueue = DispatchQueue(label: "frame.microphone.session")
    var microphoneRecording: MicrophoneRecording?
    var microphoneFailure: Error?
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
    var lastWindowUpdate = -1.0
    var lastReportedTime = -1.0
    var cursorKind: String?
    var cursorTimer: DispatchSourceTimer?
    var mouseMonitor: Any?
    var keyMonitor: Any?
    var failure: Error?
    init(path: String, bounds: CGRect, width: Int, height: Int, fps: Int = 60, cameraPath: String? = nil, systemAudio: Bool = false, microphone: Bool = false) throws {
        self.path = path; self.bounds = bounds; self.fps = fps
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: videoBitrate(width: width, height: height, fps: fps), AVVideoExpectedSourceFrameRateKey: fps, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoAllowFrameReorderingKey: false]])
        input.expectsMediaDataInRealTime = true
        super.init()
        guard writer.canAdd(input) else { throw Failure(message: "Encoder H.264 indisponível.") }
        writer.add(input)
        if systemAudio {
            let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000])
            audio.expectsMediaDataInRealTime = true
            guard writer.canAdd(audio) else { throw Failure(message: "Encoder de áudio do sistema indisponível.") }
            writer.add(audio); systemAudioInput = audio
        }
        if microphone {
            guard let device = AVCaptureDevice.default(for: .audio) else { throw Failure(message: "Nenhum microfone disponível.") }
            let session = AVCaptureSession(), input = try AVCaptureDeviceInput(device: device), output = AVCaptureAudioDataOutput()
            session.beginConfiguration(); output.setSampleBufferDelegate(self, queue: queue)
            guard session.canAddInput(input), session.canAddOutput(output) else { throw Failure(message: "O microfone não pode iniciar neste Mac.") }
            session.addInput(input); session.addOutput(output); session.commitConfiguration()
            microphoneSession = session
            microphoneRecording = MicrophoneRecording(path: URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("microphone.m4a").path)
        }
        if let cameraPath = cameraPath {
            let device = try cameraDevice(recordingOptions().cameraDevice)
            let session = AVCaptureSession(); session.beginConfiguration(); if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
            let cameraInput = try AVCaptureDeviceInput(device: device), cameraOutput = AVCaptureVideoDataOutput()
            cameraOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            cameraOutput.alwaysDiscardsLateVideoFrames = true; cameraOutput.setSampleBufferDelegate(self, queue: cameraQueue)
            guard session.canAddInput(cameraInput), session.canAddOutput(cameraOutput) else { throw Failure(message: "A webcam não pode iniciar neste Mac.") }
            session.addInput(cameraInput); session.addOutput(cameraOutput); session.commitConfiguration()
            self.cameraSession = session; self.cameraPath = cameraPath
        }
    }
    func appendSystemAudio(_ sample: CMSampleBuffer) {
        guard sample.isValid, let start = start, CMSampleBufferGetPresentationTimeStamp(sample) >= start, let audio = systemAudioInput, audio.isReadyForMoreMediaData else { return }
        if !audio.append(sample) { failure = writer.error ?? Failure(message: "Falha ao gravar o áudio do sistema.") }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failure = error }; emit(["event": "capture-error", "message": error.localizedDescription]) }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio {
            appendSystemAudio(sample)
            return
        }
        guard type == .screen, sample.isValid, CMSampleBufferGetImageBuffer(sample) != nil else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]], let raw = attachments.first?[.status] as? Int, raw != SCFrameStatus.complete.rawValue { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if start == nil {
            guard writer.startWriting() else { failure = writer.error; return }
            writer.startSession(atSourceTime: pts); start = pts
            if let session = cameraSession { cameraSessionQueue.async { session.startRunning() } }
            if let session = microphoneSession { microphoneSessionQueue.async { session.startRunning() } }
            emit(["event": "started"])
        }
        if input.isReadyForMoreMediaData {
            if !input.append(sample) { failure = writer.error }
            last = pts; lastSample = sample
        }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output is AVCaptureAudioDataOutput {
            guard let start = start, sampleBuffer.isValid else { return }
            do { try microphoneRecording?.append(sampleBuffer, origin: start) }
            catch { microphoneFailure = error; emit(["event": "capture-error", "message": error.localizedDescription]) }
            return
        }
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
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp]) { [weak self] event in
            guard let self = self, let cg = event.cgEvent else { return }
            let location = cg.location, timestamp = Double(cg.timestamp) / 1_000_000_000
            let type = event.type
            self.queue.async { [weak self] in
                guard let self = self, let start = self.start else { return }
                let t = timestamp - start.seconds
                guard t >= 0, t.isFinite else { return }
                let previous = self.pointers.last
                let down = type == .leftMouseDown ? true : type == .leftMouseUp ? false : previous?.down ?? false
                let right = type == .rightMouseDown ? true : type == .rightMouseUp ? false : previous?.rightDown ?? false
                let middle = type == .otherMouseDown ? true : type == .otherMouseUp ? false : previous?.middleDown ?? false
                let point = Pointer(t: t, x: max(0, min(1, (location.x - self.bounds.minX) / self.bounds.width)), y: max(0, min(1, (location.y - self.bounds.minY) / self.bounds.height)), down: down, kind: self.cursorKind, rightDown: right, middleDown: middle)
                if let index = self.pointers.firstIndex(where: { $0.t > t }) { self.pointers.insert(point, at: index) } else { self.pointers.append(point) }
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
                if let id = self.windowID, t - self.lastWindowUpdate >= 0.1 {
                    self.lastWindowUpdate = t
                    if let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]])?.first,
                       let raw = info[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: raw as CFDictionary), rect.width > 0, rect.height > 0 { self.bounds = rect }
                }
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
        if let mouseMonitor = mouseMonitor { NSEvent.removeMonitor(mouseMonitor); self.mouseMonitor = nil }
        try await stream?.stopCapture()
        if let session = cameraSession { cameraSessionQueue.sync { session.stopRunning() }; cameraQueue.sync {} }
        if let session = microphoneSession { microphoneSessionQueue.sync { session.stopRunning() }; queue.sync {} }
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
            input.markAsFinished(); systemAudioInput?.markAsFinished()
        }
        if let failure = queue.sync(execute: { self.failure }) { writer.cancelWriting(); throw failure }
        guard queue.sync(execute: { start != nil }) else { throw Failure(message: "Nenhum frame recebido. Confira a permissão de gravação de tela.") }
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? Failure(message: "Não foi possível finalizar o vídeo.") }
        if let error = microphoneFailure { throw error }
        if let microphone = microphoneRecording, let start = start {
            let duration = CMTime(seconds: max(0, lastReportedTime), preferredTimescale: start.timescale)
            try await microphone.finish(at: duration)
        }
        cameraInput?.markAsFinished()
        if cameraSession != nil && cameraWriter == nil { throw Failure(message: "Nenhum frame recebido da webcam.") }
        if let cameraWriter = cameraWriter { await cameraWriter.finishWriting(); guard cameraWriter.status == .completed else { throw cameraWriter.error ?? Failure(message: "Não foi possível finalizar a gravação da webcam.") } }
        let events = queue.sync { pointers }
        try JSONEncoder().encode(events).write(to: URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("cursor.json"), options: .atomic)
    }
}

struct Key: Codable { let t: Double; let x: Double; let y: Double; let scale: Double; var cut: Bool? = nil }
struct SourceCrop: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
struct Look: Codable { let background: Int; let padding: Double; let radius: Double; let shadow: Double; let cursorSize: Double; let smooth: Bool; let aspect: String; var crop: SourceCrop? = nil; let cropFill: Bool?; let cropFollowCursor: Bool?; let cameraMode: String?; let colors: [String]?; let backgroundMode: String?; let cursorSmooth: Bool?; let wallpaper: String?; let cursorAsset: String?; let cursorTheme: String?; let backgroundBlur: Double?; let motionBlur: MotionBlur?; let clickSounds: Bool?; var hideIdleCursor: Bool? = nil; var clickEffect: String? = nil; let clickSoundVolume: Double?; var cameraMotion: CameraMotion? = nil }
struct CameraMotion: Codable { let intensity: Double; let duration: Double; let frequency: Double; let webcamShake: Bool?; let impacts: [Double]? }
func webcamMotionState(_ state: WebcamKeyframe, _ time: Double, _ motion: CameraMotion?) -> WebcamKeyframe {
    guard let motion = motion, motion.webcamShake == true, let event = motion.impacts?.last(where: { $0 <= time }) else { return state }
    let age = time - event, u = age / motion.duration
    guard u > 0 && u < 1 else { return state }
    let envelope = min(1, 2 * pow(sin(Double.pi * u), 2) * (1 - u)), phase = 2 * Double.pi * motion.frequency * age
    let x = state.x + motion.intensity * envelope * sin(phase), y = state.y + motion.intensity * 0.65 * envelope * sin(phase * 0.85 + 0.7)
    return WebcamKeyframe(t: state.t, x: max(0, min(1,x)), y: max(0,min(1,y)), size: state.size, opacity: state.opacity, borderRadius: state.borderRadius, easing: state.easing)
}
struct MotionBlur: Codable { let cursor: Double; let zoom: Double; let pan: Double }
struct Effect: Codable { let id: String; let kind: String; let start: Double; let end: Double; let x: Double; let y: Double; let width: Double; let height: Double; let opacity: Double }
struct BackgroundAudio: Codable { let path: String; let volume: Double }
struct WebcamKeyframe: Codable { let t: Double; let x: Double; let y: Double; let size: Double; let opacity: Double?; let borderRadius: Double?; let easing: String? }
struct Webcam: Codable { let path: String; let x: Double; let y: Double; let size: Double; let shape: String; let keyframes: [WebcamKeyframe]?; let mode: String?; let opacity: Double?; let border: Double?; let shadow: Double?; let borderRadius: Double?; var zoomBehavior: String? = nil; var zoomSize: Double? = nil; var transitionDuration: Double? = nil }
struct ClipRange: Codable { let start: Double; let end: Double; var speed: Double? = nil; var hideCursor: Bool? = nil; var cursorOriginal: Bool? = nil; var rate: Double { speed ?? 1 }; var duration: Double { (end - start) / rate } }
struct ExportJob: Codable { let source: String; let destination: String; let start: Double; let end: Double; let appearance: Look; let keys: [Key]; let cursor: [Pointer]; let cursorCaptured: Bool; let assetsRoot: String?; let resolution: Int?; let fps: Int?; let ranges: [ClipRange]?; let rawCursor: [Pointer]?; let effects: [Effect]?; let backgroundAudio: BackgroundAudio?; let webcam: Webcam?; var microphone: BackgroundAudio? = nil; var sourceVolume: Double? = nil; var annotationImages: [String: String]? = nil; var cursorActivity: [Double]? = nil; var codec: String? = nil; var quality: String? = nil }
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
    let opacity = webcam.opacity ?? 1, radius = webcam.borderRadius ?? (webcam.shape == "circle" ? 0.5 : webcam.shape == "square" ? 0 : 0.18)
    if webcam.mode == "static" { return WebcamKeyframe(t: time, x: webcam.x, y: webcam.y, size: webcam.size, opacity: opacity, borderRadius: radius, easing: "linear") }
    let keys = webcam.keyframes ?? []
    guard !keys.isEmpty else { return WebcamKeyframe(t: time, x: webcam.x, y: webcam.y, size: webcam.size, opacity: opacity, borderRadius: radius, easing: "linear") }
    let next = keys.firstIndex(where: { $0.t >= time }) ?? keys.count
    let a = keys[max(0, next - 1)], b = keys[min(next, keys.count - 1)], raw = next == 0 ? 0 : next >= keys.count ? 1 : b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    let amount = webcamEase(raw, a.easing ?? "ease-in-out")
    return WebcamKeyframe(t: time, x: mix(a.x, b.x, amount), y: mix(a.y, b.y, amount), size: mix(a.size, b.size, amount), opacity: mix(a.opacity ?? opacity, b.opacity ?? opacity, amount), borderRadius: mix(a.borderRadius ?? radius, b.borderRadius ?? radius, amount), easing: a.easing)
}
func webcamEase(_ value: Double, _ easing: String) -> Double {
    let t = max(0, min(1, value))
    if easing == "cubic-bezier" && t > 0 && t < 1 {
        var low = 0.0, high = 1.0
        for _ in 0..<24 {
            let u = (low + high) / 2, x = 3 * pow(1 - u, 2) * u * 0.42 + 3 * (1 - u) * u * u * 0.58 + pow(u, 3)
            if x < t { low = u } else { high = u }
        }
        let u = (low + high) / 2
        return 3 * (1 - u) * u * u + pow(u, 3)
    }
    switch easing { case "linear": return t; case "ease-out": return 1 - pow(1 - t, 3); default: return t * t * (3 - 2 * t) }
}
func webcamFrameRect(_ state: WebcamKeyframe, _ shape: String, _ sourceAspect: Double, _ width: Double, _ height: Double) -> CGRect {
    let shortEdge = min(width, height), side = shortEdge * state.size
    let aspect = shape == "rectangle" ? max(0.25, min(4, sourceAspect)) : 1
    let frameWidth = side * min(1, aspect), frameHeight = side / max(1, aspect), margin = shortEdge * 0.025
    let cx = max(margin + frameWidth / 2, min(width - margin - frameWidth / 2, state.x * width))
    let cy = max(margin + frameHeight / 2, min(height - margin - frameHeight / 2, state.y * height))
    return CGRect(x: cx - frameWidth / 2, y: height - cy - frameHeight / 2, width: frameWidth, height: frameHeight)
}
func webcamFocusScale(_ time: Double, _ keys: [Key], _ duration: Double = 0.4) -> Double {
    var sum = 0.0
    for i in 0...24 { sum += max(1.02, min(1.35, camera(time - duration * Double(i) / 24, keys).scale)) }
    return sum / 25
}
func webcamZoomSize(_ size: Double, _ cameraScale: Double, _ behavior: String? = nil, _ customSize: Double? = nil) -> Double {
    let amount = webcamEase((cameraScale - 1.02) / 0.33, "ease-in-out")
    let target = behavior == "shrink" ? size * 0.65 : behavior == "grow" ? size * 1.35 : behavior == "custom" ? customSize ?? size : size
    return max(0.08, min(0.6, mix(size, target, amount)))
}
func plannedWebcamState(_ input: WebcamKeyframe, _ mode: String?, _ cameraScale: Double, _ aspect: String, _ behavior: String? = nil, _ customSize: Double? = nil, _ hasManualKeys: Bool = false) -> WebcamKeyframe {
    if mode != "static" && hasManualKeys { return input }
    let state = WebcamKeyframe(t: input.t, x: input.x, y: input.y, size: webcamZoomSize(input.size, cameraScale, behavior, customSize), opacity: input.opacity, borderRadius: input.borderRadius, easing: input.easing)
    guard mode == "auto" || mode == "hybrid" else { return state }
    let webcamFrame = state
    let side = webcamFrame.size
    let overlappingFocus = abs(webcamFrame.x - 0.5) < side / 2 + 0.025 && abs(webcamFrame.y - 0.5) < side / 2 + 0.025
    let margin = max(webcamFrame.size / 2, side / 2 + 0.025)
    let candidates = [(1 - margin, 1 - margin), (margin, 1 - margin), (1 - margin, margin), (margin, margin)]
    let target = overlappingFocus ? candidates.max { hypot($0.0 - 0.5, $0.1 - 0.5) < hypot($1.0 - 0.5, $1.1 - 0.5) }! : (webcamFrame.x, webcamFrame.y)
    let raw = mode == "auto" ? max(0, min(1, (cameraScale - 1.05) / 0.45)) : overlappingFocus ? max(0, min(1, (cameraScale - 1.08) / 0.42)) : 0
    let amount = webcamEase(raw, "ease-in-out")
    return WebcamKeyframe(t: webcamFrame.t, x: mix(webcamFrame.x, target.0, amount), y: mix(webcamFrame.y, target.1, amount), size: webcamFrame.size, opacity: webcamFrame.opacity, borderRadius: webcamFrame.borderRadius, easing: webcamFrame.easing)
}
func pointer(_ time: Double, _ events: [Pointer]) -> Pointer? {
    guard !events.isEmpty else { return nil }
    var low = 0, high = events.count
    while low < high { let m = (low + high) / 2; if events[m].t <= time { low = m + 1 } else { high = m } }
    let a = events[max(0, low - 1)], b = events[min(low, events.count - 1)]
    let u = b.t > a.t ? max(0, min(1, (time - a.t) / (b.t - a.t))) : 0
    return Pointer(t: time, x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), down: a.down, kind: a.kind, rightDown: a.rightDown, middleDown: a.middleDown, typing: a.typing)
}
func lastTimeAt(_ time: Double, _ times: [Double]) -> Double? {
    var low = 0, high = times.count
    while low < high { let mid = (low + high) / 2; if times[mid] <= time { low = mid + 1 } else { high = mid } }
    return low > 0 ? times[low - 1] : nil
}
func idleOpacity(_ time: Double, _ times: [Double]) -> Double { max(0, min(1, 1 - (time - (lastTimeAt(time, times) ?? 0) - 1) / 0.2)) }
func motionFrames(_ t: Double, keys: [Key], events: [Pointer], range: ClipRange, blur: MotionBlur?, cuts: [Double], spanX: Double = 1, spanY: Double = 1) -> [(Key, Pointer?)] {
    let current = camera(t, keys), point = range.hideCursor == true ? nil : pointer(t, events)
    guard let blur = blur, blur.cursor > 0 || blur.zoom > 0 || blur.pan > 0 else { return [(current, point)] }
    var low = 0, high = cuts.count
    while low < high { let m = (low + high) / 2; if cuts[m] <= t { low = m + 1 } else { high = m } }
    let start = max(range.start, low > 0 ? cuts[low - 1] : 0), past = max(start, t - range.rate / 60)
    let count = max(blur.cursor, max(blur.zoom, blur.pan)) > 0.5 ? 5 : 3
    let samples: [(Key, Pointer?)] = (0..<count).map { index in
        let time = max(start, t - (t - past) * Double(index) / Double(count - 1))
        let previous = camera(time, keys), scale = mix(current.scale, previous.scale, blur.zoom), halfX = spanX / (2 * scale), halfY = spanY / (2 * scale)
        let cam = Key(t: t, x: max(halfX, min(1 - halfX, mix(current.x, previous.x, blur.pan))), y: max(halfY, min(1 - halfY, mix(current.y, previous.y, blur.pan))), scale: scale)
        var cursor: Pointer?
        if let point = point, let other = pointer(time, events) {
            cursor = point.down || point.rightDown == true || point.middleDown == true ? point : Pointer(t: point.t, x: mix(point.x, other.x, blur.cursor), y: mix(point.y, other.y, blur.cursor), down: point.down, kind: point.kind, rightDown: point.rightDown, middleDown: point.middleDown, typing: point.typing)
        }
        return (cam, cursor)
    }
    return samples.allSatisfy { abs($0.0.x - current.x) * current.scale < 0.0001 && abs($0.0.y - current.y) * current.scale < 0.0001 && abs($0.0.scale - current.scale) < 0.0001 && ($0.1 == nil || point == nil || hypot($0.1!.x - point!.x, $0.1!.y - point!.y) * current.scale < 0.0001) } ? [(current, point)] : samples
}
func accumulateMotionFrame(_ input: CIImage, _ previous: CIImage?, _ count: Int) -> CIImage {
    guard count > 1 else { return input }
    // Match Canvas2D sRGB mixing; weight alpha once before adding premultiplied samples.
    let weighted = input.applyingFilter("CILinearToSRGBToneCurve").applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1 / Double(count))])
    return previous.map { weighted.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: $0]) } ?? weighted
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
    if let motion = job.appearance.cameraMotion {
        guard motion.intensity.isFinite && (0...0.004).contains(motion.intensity) && motion.duration.isFinite && (0.08...0.18).contains(motion.duration) && motion.frequency.isFinite && (8...16).contains(motion.frequency) && (motion.impacts ?? []).allSatisfy({$0.isFinite && $0 >= 0 && $0 <= sourceDuration}) else { throw Failure(message: "Camera Motion inválido.") }
    }
    if let blur = job.appearance.motionBlur { guard [blur.cursor, blur.zoom, blur.pan].allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else { throw Failure(message: "Intensidade de motion blur inválida.") } }
    if let webcam = job.webcam { guard (webcam.zoomBehavior == nil || ["keep", "shrink", "grow", "custom"].contains(webcam.zoomBehavior!)) && (webcam.zoomSize == nil || (0.08...0.6).contains(webcam.zoomSize!)) && (webcam.transitionDuration == nil || (0.15...2).contains(webcam.transitionDuration!)) && webcam.size.isFinite && (0.08...0.6).contains(webcam.size) && webcam.x.isFinite && (0...1).contains(webcam.x) && webcam.y.isFinite && (0...1).contains(webcam.y) && ["circle", "rounded", "square", "rectangle"].contains(webcam.shape) else { throw Failure(message: "Configuração da webcam inválida.") } }
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
    let sourceAudioTracks = composition.tracks(withMediaType: .audio)
    var microphoneTrack: AVMutableCompositionTrack?
    if let microphone = job.microphone {
        guard microphone.volume.isFinite && (0...1).contains(microphone.volume) else { throw Failure(message: "Volume do microfone inválido.") }
        let asset = AVURLAsset(url: URL(fileURLWithPath: microphone.path))
        guard let source = try await asset.loadTracks(withMediaType: .audio).first, let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failure(message: "Trilha do microfone inválida.") }
        let available = try await source.load(.timeRange)
        var position = 0.0
        for range in ranges {
            let begin = max(range.start, available.start.seconds), end = min(range.end, CMTimeRangeGetEnd(available).seconds)
            if end > begin {
                let destination = CMTime(seconds: position + (begin - range.start) / range.rate, preferredTimescale: 60000)
                let segment = CMTimeRange(start: CMTime(seconds: begin, preferredTimescale: 60000), duration: CMTime(seconds: end - begin, preferredTimescale: 60000))
                try track.insertTimeRange(segment, of: source, at: destination)
                track.scaleTimeRange(CMTimeRange(start: destination, duration: segment.duration), toDuration: CMTime(seconds: (end - begin) / range.rate, preferredTimescale: 60000))
            }
            position += range.duration
        }
        microphoneTrack = track
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
    let crop = job.appearance.crop ?? SourceCrop(x: 0, y: 0, width: 1, height: 1)
    let cw = sw * crop.width, ch = sh * crop.height
    let aspect = job.appearance.aspect == "16:9" ? 16.0 / 9 : job.appearance.aspect == "9:16" ? 9.0 / 16 : job.appearance.aspect == "1:1" ? 1 : cw / ch
    let shortEdge = Double(resolution), longEdge = shortEdge * 16 / 9
    let maxWidth = aspect >= 1 ? longEdge : shortEdge, maxHeight = aspect >= 1 ? shortEdge : longEdge
    let width = max(2, Int((min(maxWidth, maxHeight * aspect) / 2).rounded()) * 2)
    let height = max(2, Int((Double(width) / aspect / 2).rounded()) * 2)
    let w = CGFloat(width), h = CGFloat(height), canvas = CGRect(x: 0, y: 0, width: w, height: h)
    let padding = min(w, h) * job.appearance.padding / 100
    // Layout fit is the base composition. Camera scale is applied once, later,
    // to this fitted frame; the canvas crop is only the final clip rectangle.
    let layoutScale = job.appearance.cropFill == true ? max((w - 2 * padding) / cw, (h - 2 * padding) / ch) : min((w - 2 * padding) / cw, (h - 2 * padding) / ch)
    let vw = sw * layoutScale, vh = sh * layoutScale
    let spanX = job.appearance.cropFill == true ? min(crop.width, Double(w - 2 * padding) / Double(vw)) : crop.width
    let spanY = job.appearance.cropFill == true ? min(crop.height, Double(h - 2 * padding) / Double(vh)) : crop.height
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
    var annotationImages: [String: CIImage] = [:]
    for (id, encoded) in job.annotationImages ?? [:] {
        guard encoded.count <= 4_000_000, let data = Data(base64Encoded: encoded),
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096, width * height <= 8_000_000,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw Failure(message: "Imagem de anotação inválida.") }
        annotationImages[id] = CIImage(cgImage: image)
    }
    for effect in job.effects ?? [] where ["text", "arrow", "rectangle", "ellipse", "caption", "watermark"].contains(effect.kind) {
        guard annotationImages[effect.id] != nil else { throw Failure(message: "Imagem de anotação ausente. Reabra a exportação no editor.") }
    }
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
        guard (job.sourceVolume ?? 1).isFinite && (0...1).contains(job.sourceVolume ?? 1) else { throw Failure(message: "Volume da gravação inválido.") }
        var parameters: [AVAudioMixInputParameters] = sourceAudioTracks.map { track in let p = AVMutableAudioMixInputParameters(track: track); p.setVolume(Float(job.sourceVolume ?? 1), at: .zero); return p }
        if let track = microphoneTrack, let microphone = job.microphone {
            let p = AVMutableAudioMixInputParameters(track: track); p.setVolume(Float(microphone.volume), at: .zero); parameters.append(p)
        }
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
    let codecName = job.codec ?? "h264", quality = job.quality ?? "high"
    let codecs: [String: AVVideoCodecType] = ["h264": .h264, "hevc": .hevc, "prores-lt": .proRes422LT, "prores": .proRes422, "prores-hq": .proRes422HQ, "prores-4444": .proRes4444]
    guard let codec = codecs[codecName], ["web", "balanced", "high"].contains(quality) else { throw Failure(message: "Codec ou qualidade inválidos.") }
    let prores = codecName.hasPrefix("prores")
    let destination = URL(fileURLWithPath: job.destination)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(".frame-\(UUID().uuidString).\(prores ? "mov" : "mp4")")
    let writer = try AVAssetWriter(outputURL: temporary, fileType: prores ? .mov : .mp4)
    defer { if FileManager.default.fileExists(atPath: temporary.path) { try? FileManager.default.removeItem(at: temporary) } }
    let bitrate = Int(Double(videoBitrate(width: width, height: height, fps: fps)) * (quality == "web" ? 0.35 : quality == "balanced" ? 0.65 : 1))
    let outputColors: [String: Any] = [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2, AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2, AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2]
    var videoSettings: [String: Any] = [AVVideoCodecKey: codec, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoColorPropertiesKey: outputColors]
    if !prores {
        var compression: [String: Any] = [AVVideoAverageBitRateKey: bitrate, AVVideoExpectedSourceFrameRateKey: fps, AVVideoAllowFrameReorderingKey: false]
        if codecName == "h264" { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
        videoSettings[AVVideoCompressionPropertiesKey] = compression
    }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
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
        let role = kind == "hand" ? "pointinghand" : kind == "text" ? "ibeam" : kind ?? "pointer", theme = job.appearance.cursorTheme ?? "macos"
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
    var clicks: [Pointer] = [], pressed = false
    for point in job.rawCursor ?? job.cursor {
        let down = point.down || point.rightDown == true || point.middleDown == true
        if down && !pressed { clicks.append(point) }; pressed = down
    }
    let clickTimes = clicks.map { $0.t }

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
            let frameBounds = CGRect(x: w / 2 + (crop.x - frameCam.x) * vw * frameCam.scale, y: h / 2 + (frameCam.y - crop.y - crop.height) * vh * frameCam.scale, width: vw * crop.width * frameCam.scale, height: vh * crop.height * frameCam.scale)
            var accumulated: CIImage?
            for (sampleCamera, point) in samples {
                var frame = sourceImage
                if job.cursorCaptured, let point = point, job.appearance.cursorSize > 0 {
                    let (cursorImage, hotspotX, hotspotY) = try cursorStyle(point.kind)
                    let cursor = cursorImage.transformed(by: CGAffineTransform(scaleX: 1 / layoutScale, y: 1 / layoutScale)).transformed(by: CGAffineTransform(translationX: point.x * sw - hotspotX * cursorImage.extent.width / layoutScale, y: (1 - point.y) * sh - (1 - hotspotY) * cursorImage.extent.height / layoutScale))
                    let opacity = job.appearance.hideIdleCursor == true ? idleOpacity(t, job.cursorActivity ?? []) : 1
                    frame = cursor.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: opacity)]).composited(over: frame)
                }
                let renderedScale = layoutScale * sampleCamera.scale
                frame = frame.transformed(by: CGAffineTransform(scaleX: renderedScale, y: renderedScale))
                    .transformed(by: CGAffineTransform(translationX: w / 2 - sampleCamera.x * vw * sampleCamera.scale, y: h / 2 - (1 - sampleCamera.y) * vh * sampleCamera.scale))
                    .cropped(to: canvas)
                accumulated = accumulateMotionFrame(frame, accumulated, count)
            }
            var frame = count > 1 ? accumulated!.applyingFilter("CISRGBToneCurveToLinear") : accumulated!
            if job.cursorCaptured, range.hideCursor != true, let style = job.appearance.clickEffect, style != "none", job.appearance.cursorSize > 0, let last = lastTimeAt(t, clickTimes), t - last < 0.35, let point = pointer(last, clicks) {
                let age = (t - last) / 0.35, radius = job.appearance.cursorSize * w / 1920 * frameCam.scale * (style == "ripple" ? 0.7 + age * 1.5 : 1)
                let x = w / 2 + (point.x - frameCam.x) * vw * frameCam.scale, y = h / 2 + (frameCam.y - point.y) * vh * frameCam.scale
                let rect = CGRect(x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius)
                let purple = CIColor(red: 173.0 / 255, green: 145.0 / 255, blue: 1, alpha: (1 - age) * 0.65)
                let mask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: rect), "inputRadius": radius, "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
                let color = style == "circle" ? CIImage(color: purple).cropped(to: canvas) : CIFilter(name: "CIRadialGradient", parameters: ["inputCenter": CIVector(x: x, y: y), "inputRadius0": max(0, radius - 2 * w / 1920 * frameCam.scale), "inputRadius1": radius, "inputColor0": CIColor.clear, "inputColor1": purple])!.outputImage!.cropped(to: canvas)
                let ring = color.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage(color: CIColor.clear).cropped(to: canvas), kCIInputMaskImageKey: mask])
                frame = ring.composited(over: frame).cropped(to: canvas)
            }
            for effect in job.effects ?? [] where t >= effect.start && t < effect.end && !["caption", "watermark"].contains(effect.kind) {
                let effectX = effect.x
                let effectY = effect.y
                let effectWidth = effect.width * vw * frameCam.scale
                let effectHeight = effect.height * vh * frameCam.scale
                let centerX = w / 2 + (effectX - frameCam.x) * vw * frameCam.scale
                let centerY = h / 2 + (frameCam.y - effectY) * vh * frameCam.scale
                let rect = CGRect(x: centerX - effectWidth / 2, y: centerY - effectHeight / 2, width: effectWidth, height: effectHeight).intersection(frameBounds).intersection(canvas)
                guard !rect.isNull && !rect.isEmpty else { continue }
                let shape = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: rect), "inputRadius": 8 * w / 1920 * frameCam.scale, "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
                if effect.kind == "mask" {
                    let blurred = frame.clampedToExtent().applyingGaussianBlur(sigma: 14 * w / 1920).cropped(to: canvas)
                    frame = blurred.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frame, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                } else if effect.kind == "spotlight" {
                    let dim = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: effect.opacity)).cropped(to: canvas).composited(over: frame)
                    frame = frame.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: dim, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                } else if effect.kind == "magnifier" {
                    let zoom = 2 * layoutScale * frameCam.scale
                    let enlarged = sourceImage.transformed(by: CGAffineTransform(scaleX: zoom, y: zoom)).transformed(by: CGAffineTransform(translationX: centerX - effect.x * sw * zoom, y: centerY - (1 - effect.y) * sh * zoom))
                    frame = enlarged.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frame, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                } else if let graphic = annotationImages[effect.id] {
                    let layer = graphic.transformed(by: CGAffineTransform(scaleX: effectWidth / graphic.extent.width, y: effectHeight / graphic.extent.height)).transformed(by: CGAffineTransform(translationX: centerX - effectWidth / 2, y: centerY - effectHeight / 2))
                        .applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: effect.opacity)])
                    frame = layer.composited(over: frame).cropped(to: canvas)
                } else {
                    let color = CIImage(color: CIColor(red: 1, green: 0.78, blue: 0.16, alpha: effect.opacity)).cropped(to: canvas)
                    let tinted = color.composited(over: frame)
                    frame = tinted.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: frame, kCIInputMaskImageKey: shape]).cropped(to: canvas)
                }
            }
            var frameBackground = backgroundImage
            if job.appearance.backgroundMode == "video-blur" {
                let backgroundScale = max(w / cw, h / ch)
                let backgroundWidth = cw * backgroundScale, backgroundHeight = ch * backgroundScale
                let croppedSource = sourceImage.cropped(to: CGRect(x: crop.x * sw, y: (1 - crop.y - crop.height) * sh, width: cw, height: ch))
                    .transformed(by: CGAffineTransform(translationX: -crop.x * sw, y: -(1 - crop.y - crop.height) * sh))
                let expanded = croppedSource.transformed(by: CGAffineTransform(scaleX: backgroundScale, y: backgroundScale))
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
                // Match WebKit opacity/shadow compositing in sRGB, isolated to the webcam layer.
                var cameraBackdrop = composed.applyingFilter("CILinearToSRGBToneCurve")
                let webcamPosition = webcamMotionState(plannedWebcamState(webcamState(webcam, sourceTime), webcam.mode, webcamFocusScale(t, job.keys, webcam.transitionDuration ?? 0.4), job.appearance.aspect, webcam.zoomBehavior, webcam.zoomSize, !(webcam.keyframes ?? []).isEmpty), sourceTime, job.appearance.cameraMotion)
                let raw = CIImage(cvPixelBuffer: cameraBuffer).transformed(by: webcamTransform)
                let upright = raw.transformed(by: CGAffineTransform(translationX: -raw.extent.minX, y: -raw.extent.minY)).applyingFilter("CILinearToSRGBToneCurve")
                let cameraRect = webcamFrameRect(webcamPosition, webcam.shape, Double(upright.extent.width / upright.extent.height), Double(w), Double(h))
                let side = max(cameraRect.width, cameraRect.height), shortSide = min(cameraRect.width, cameraRect.height)
                if !cameraRect.intersection(canvas).isNull && !cameraRect.intersection(canvas).isEmpty {
                    let opacity = max(0, min(1, webcamPosition.opacity ?? webcam.opacity ?? 1))
                    let border = max(0, min(shortSide * 0.08, (webcam.border ?? 2) * w / 1000))
                    let radius = webcam.shape == "circle" ? shortSide / 2 : shortSide * max(0, min(0.5, webcamPosition.borderRadius ?? webcam.borderRadius ?? (webcam.shape == "square" ? 0 : 0.18)))
                    let clear = CIImage(color: CIColor.clear).cropped(to: canvas)
                    let outerMask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: cameraRect), "inputRadius": radius, "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
                    let shadowStrength = max(0, min(1, (webcam.shadow ?? 35) / 100)) * opacity
                    if shadowStrength > 0 {
                        let shadow = outerMask.transformed(by: CGAffineTransform(translationX: 0, y: -side * 0.025)).applyingGaussianBlur(sigma: side * 0.055).cropped(to: canvas)
                            .applyingFilter("CISourceOutCompositing", parameters: [kCIInputBackgroundImageKey: outerMask])
                        let shadowColor = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: shadowStrength)).cropped(to: canvas)
                        cameraBackdrop = shadowColor.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: cameraBackdrop, kCIInputMaskImageKey: shadow]).cropped(to: canvas)
                    }
                    let borderLayer = CIImage(color: CIColor.white).cropped(to: cameraRect).applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: outerMask])
                    let innerRect = cameraRect.insetBy(dx: border, dy: border)
                    let innerMask = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: innerRect), "inputRadius": max(0, radius - border), "inputColor": CIColor.white])!.outputImage!.cropped(to: canvas)
                    let cover = max(innerRect.width / upright.extent.width, innerRect.height / upright.extent.height), scaled = upright.transformed(by: CGAffineTransform(scaleX: cover, y: cover))
                    let cameraImage = scaled.transformed(by: CGAffineTransform(translationX: cameraRect.midX - scaled.extent.midX, y: cameraRect.midY - scaled.extent.midY)).cropped(to: innerRect.intersection(canvas))
                    let cameraLayer = cameraImage.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: borderLayer, kCIInputMaskImageKey: innerMask])
                    let opacityMask = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: opacity)).cropped(to: canvas)
                    let fadedCamera = cameraLayer.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: opacityMask])
                    cameraBackdrop = fadedCamera.composited(over: cameraBackdrop).cropped(to: canvas)
                }
                composed = cameraBackdrop.applyingFilter("CISRGBToneCurveToLinear").cropped(to: canvas)
            }
            for effect in job.effects ?? [] where t >= effect.start && t < effect.end && ["caption", "watermark"].contains(effect.kind) {
                guard let graphic = annotationImages[effect.id] else { continue }
                let ew = effect.width * w, eh = effect.height * h
                let layer = graphic.transformed(by: CGAffineTransform(scaleX: ew / graphic.extent.width, y: eh / graphic.extent.height)).transformed(by: CGAffineTransform(translationX: (effect.x - effect.width / 2) * w, y: (1 - effect.y - effect.height / 2) * h))
                    .applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: effect.opacity)])
                composed = layer.composited(over: composed).cropped(to: canvas)
            }
            context.render(composed, to: buffer, bounds: canvas, colorSpace: space)
            // Describe the sRGB pixels so the encoder can convert and tag Rec.709 correctly.
            CVBufferSetAttachment(buffer, kCVImageBufferCGColorSpaceKey, space, .shouldPropagate)
            CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
            CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
            CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
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
            case "audio-status":
                emit(["event": "audio-status", "microphoneAuthorization": AVCaptureDevice.authorizationStatus(for: .audio).rawValue, "screenRecordingAuthorized": CGPreflightScreenCaptureAccess(), "microphone": AVCaptureDevice.default(for: .audio)?.localizedName ?? ""])
            case "camera-preview":
                let status = AVCaptureDevice.authorizationStatus(for: .video)
                let allowed: Bool
                if status == .authorized { allowed = true }
                else if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
                else { allowed = false }
                guard allowed else { throw Failure(message: "Acesso à webcam negado. Autorize a câmera em Ajustes do Sistema > Privacidade e Segurança > Câmera.") }
                let preview = CameraPreview()
                try preview.start(deviceID: args.count > 2 ? args[2] : nil)
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
            case "analyze-audio": try await analyzeAudio(args[2])
            case "inspect": try await emitMedia(metadata(args[2]))
            case "devices":
                let selected = AVCaptureDevice.default(for: .video)?.uniqueID
                let cameras = cameraDevices().map { ["id": $0.uniqueID, "label": $0.localizedName, "isDefault": $0.uniqueID == selected] as [String: Any] }
                emit(["event": "devices", "supported": true, "inputs": [], "outputs": [], "cameras": cameras])
            case "sources":
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                let displays: [[String: Any]] = content.displays.sorted { ($0.displayID == CGMainDisplayID() ? 0 : 1) < ($1.displayID == CGMainDisplayID() ? 0 : 1) }.map { display in ["id": display.displayID, "label": "Monitor \(display.displayID) · \(display.width) × \(display.height)", "width": CGDisplayBounds(display.displayID).width, "height": CGDisplayBounds(display.displayID).height, "kind": "display"] }
                let windows: [[String: Any]] = content.windows.filter { $0.windowLayer == 0 && $0.frame.width >= 32 && $0.frame.height >= 32 && $0.owningApplication?.processID != ProcessInfo.processInfo.processIdentifier && !isFloatingPreview($0.owningApplication?.processID, $0.title) }.map { window in ["id": window.windowID, "label": "\(window.owningApplication?.applicationName ?? "App") — \(window.title ?? "Janela")", "width": window.frame.width, "height": window.frame.height, "kind": "window"] }
                emit(["event": "sources", "displays": displays, "windows": windows])
            case "record":
                // ScreenCaptureKit requests authorization itself; its result is authoritative.
                let cameraPath = args.count > 3 && !args[3].hasPrefix("--") ? args[3] : nil
                let systemAudio = args.contains("--system-audio"), microphone = args.contains("--microphone")
                if microphone {
                    let status = AVCaptureDevice.authorizationStatus(for: .audio)
                    var allowed = status == .authorized
                    if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .audio) }
                    guard allowed else { throw Failure(message: "Acesso ao microfone negado. Autorize o Frame Studio em Ajustes do Sistema > Privacidade e Segurança > Microfone.") }
                }
                if cameraPath != nil {
                    let status = AVCaptureDevice.authorizationStatus(for: .video)
                    var allowed = status == .authorized
                    if status == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
                    guard allowed else { throw Failure(message: "Acesso à webcam negado. Autorize a câmera do Frame Studio em Ajustes do Sistema > Privacidade e Segurança > Câmera.") }
                }
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                let options = try recordingOptions(), source = options.source
                let fps = options.fps ?? 60, resolution = options.resolution ?? 2160
                guard [30, 60].contains(fps), [1080, 2160].contains(resolution) else { throw Failure(message: "Qualidade de captura inválida.") }
                let (filter, bounds, region, displayID) = try captureRegion(source, content.displays, content.windows)
                let pixelScale = Double(CGDisplayPixelsWide(displayID)) / CGDisplayBounds(displayID).width
                let config = SCStreamConfiguration()
                let (width, height) = captureSize(width: Int(bounds.width * pixelScale), height: Int(bounds.height * pixelScale), resolution: resolution)
                config.width = width; config.height = height
                if #available(macOS 14.0, *) { config.ignoreShadowsSingleWindow = true }
                if let region = region { config.sourceRect = region }
                config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps)); config.queueDepth = 3; config.showsCursor = false; config.capturesAudio = systemAudio; config.sampleRate = 48000; config.channelCount = 2; config.excludesCurrentProcessAudio = true; config.pixelFormat = kCVPixelFormatType_32BGRA
                let capture = try Capture(path: args[2], bounds: bounds, width: config.width, height: config.height, fps: fps, cameraPath: cameraPath, systemAudio: systemAudio, microphone: microphone)
                if source?.kind == "window" { capture.windowID = source?.id }
                let stream = SCStream(filter: filter, configuration: config, delegate: capture)
                capture.stream = stream; try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: capture.queue)
                if systemAudio { try stream.addStreamOutput(capture, type: .audio, sampleHandlerQueue: capture.queue) }
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
