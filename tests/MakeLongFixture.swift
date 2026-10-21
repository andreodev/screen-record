import AVFoundation

@main struct LongFixture {
    static func main() async throws {
        let source = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let seconds = Double(CommandLine.arguments[3])!
        let sourceDuration = try await source.load(.duration)
        let sourceTrack = try await source.loadTracks(withMediaType: .video).first!
        let composition = AVMutableComposition()
        let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
        var position = 0.0
        while position < seconds {
            let length = min(sourceDuration.seconds, seconds - position)
            try track.insertTimeRange(CMTimeRange(start: .zero, duration: CMTime(seconds: length, preferredTimescale: 600)), of: sourceTrack, at: CMTime(seconds: position, preferredTimescale: 600))
            position += length
        }
        let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough)!
        try await exporter.export(to: URL(fileURLWithPath: CommandLine.arguments[2]), as: .mov)
        print("Long fixture: \(seconds)s")
    }
}
