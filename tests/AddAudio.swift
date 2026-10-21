import AVFoundation

@main struct AddAudio {
    static func main() async throws {
        let source = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 144000)!
        pcm.frameLength = 144000
        for i in 0..<144000 { pcm.floatChannelData![0][i] = Float(sin(Double(i) * 440 * 2 * .pi / 48000)) * 0.1 }
        let audioURL = URL(fileURLWithPath: CommandLine.arguments[2]).deletingLastPathComponent().appendingPathComponent("tone.caf")
        var file: AVAudioFile? = try AVAudioFile(forWriting: audioURL, settings: format.settings); try file!.write(from: pcm); file = nil
        let audio = AVURLAsset(url: audioURL)
        let composition = AVMutableComposition()
        try composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!.insertTimeRange(CMTimeRange(start: .zero, duration: CMTime(seconds: 3, preferredTimescale: 600)), of: try await source.loadTracks(withMediaType: .video).first!, at: .zero)
        try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!.insertTimeRange(CMTimeRange(start: .zero, duration: CMTime(seconds: 3, preferredTimescale: 600)), of: try await audio.loadTracks(withMediaType: .audio).first!, at: .zero)
        let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality)!
        try await exporter.export(to: URL(fileURLWithPath: CommandLine.arguments[2]), as: .mov)
        print("Audio fixture generated")
    }
}
