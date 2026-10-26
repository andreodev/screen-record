@main struct FloatingPreviewCapture {
    @MainActor static func main() async throws {
        guard #available(macOS 14.0, *) else { throw Failure(message: "This capture check requires macOS 14.") }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let preview = content.windows.first(where: { isFloatingPreview($0.owningApplication?.processID, $0.title) }) else {
            let own = content.windows.filter { String($0.owningApplication?.processID ?? 0) == ProcessInfo.processInfo.environment["FRAME_PREVIEW_OWNER_PID"] }
            let names = own.map { "\($0.windowID):\($0.title ?? "nil")" }
            let apps = content.applications.filter { $0.applicationName.contains("Frame") }.map { "\($0.processID):\($0.applicationName)" }
            throw Failure(message: "Floating preview missing: \(names), applications \(apps), total \(content.windows.count), permission \(CGPreflightScreenCaptureAccess())")
        }
        guard let display = content.displays.first(where: { $0.frame.contains(CGPoint(x: preview.frame.midX, y: preview.frame.midY)) }) else { throw Failure(message: "Preview monitor unavailable.") }
        let bounds = CGDisplayBounds(display.displayID)
        let area = RecordingArea(x: preview.frame.minX - bounds.minX, y: preview.frame.minY - bounds.minY, width: preview.frame.width, height: preview.frame.height)
        let source = RecordingSource(kind: "area", id: display.displayID, area: area)
        let (filter, _, region, _) = try captureRegion(source, content.displays, content.windows)
        let config = SCStreamConfiguration(); config.width = 560; config.height = 460; config.sourceRect = region!; config.showsCursor = false
        let raw = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: config)
        let clean = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        func magenta(_ image: CGImage) -> Int {
            var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
            CIContext().render(CIImage(cgImage: image), toBitmap: &bytes, rowBytes: image.width * 4, bounds: CGRect(x: 0, y: 0, width: image.width, height: image.height), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
            return stride(from: 0, to: bytes.count, by: 4).filter { bytes[$0] > 220 && bytes[$0 + 1] < 40 && bytes[$0 + 2] > 220 }.count
        }
        let before = magenta(raw), after = magenta(clean)
        let protected = CommandLine.arguments.contains("--protected")
        precondition(protected ? before < 100 : before > 10000, "Unexpected protection state: \(before) marker pixels before filtering")
        precondition(after < 100, "Floating preview leaked into capture: \(after)")
        let destination = CommandLine.arguments.dropFirst().first(where: { !$0.hasPrefix("--") })
        if let path = destination {
            let capture = try Capture(path: path, bounds: preview.frame, width: 560, height: 460, fps: 30)
            let stream = SCStream(filter: filter, configuration: config, delegate: capture)
            capture.stream = stream; try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: capture.queue)
            capture.begin(); try await stream.startCapture()
            try await Task.sleep(nanoseconds: 1_200_000_000); try await capture.finish()
            let video = AVURLAsset(url: URL(fileURLWithPath: path)), generator = AVAssetImageGenerator(asset: video)
            let frame = try await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600)).image
            precondition(magenta(frame) < 100, "Floating preview leaked into recording.mov")
            print("recording.mov excludes the preview while it remains visible on screen.")
        }
        let windowSource = RecordingSource(kind: "window", id: preview.windowID, area: nil)
        do { _ = try captureRegion(windowSource, content.displays, content.windows); preconditionFailure("Preview can be selected as the source") } catch {}
        print("ScreenCaptureKit excluded the visible floating preview: \(before) marker pixels before, \(after) after; source-window rejection passed.")
    }
}
