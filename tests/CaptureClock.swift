// Compiled with the production capture implementation; never starts a stream or polls the mouse.
@main struct ClockCheck {
    static func main() throws {
        for (width, height, expectedWidth, expectedHeight) in [(2560, 1600, 2560, 1600), (1920, 1080, 1920, 1080), (5120, 2880, 3840, 2160), (2880, 5120, 2160, 3840)] {
            let size = captureSize(width: width, height: height)
            precondition(size.0 == expectedWidth && size.1 == expectedHeight)
        }
        precondition(videoBitrate(width: 3840, height: 2160, fps: 60) == 96_000_000)
        let capture = try Capture(path: CommandLine.arguments[1], bounds: CGRect(x: 0, y: 0, width: 1280, height: 800), width: 1280, height: 800)
        let compression = capture.input.outputSettings?[AVVideoCompressionPropertiesKey] as! [String: Any]
        precondition(compression[AVVideoExpectedSourceFrameRateKey] as? Int == 60)
        capture.reportTime(CMTime(seconds: 90, preferredTimescale: 60000))
        precondition(capture.lastReportedTime == -1, "Timer started before first frame")
        capture.start = CMTime(seconds: 100, preferredTimescale: 60000)
        for seconds in [100.0, 100.04, 100.125] { capture.reportTime(CMTime(seconds: seconds, preferredTimescale: 60000)) }
        precondition(abs(capture.lastReportedTime - 0.125) < 0.000001)
        capture.reportTime(CMTime(seconds: 105.25, preferredTimescale: 60000), force: true)
        precondition(capture.lastReportedTime == 5.25)
    }
}
