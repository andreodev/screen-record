import AppKit
import AVFoundation
import CoreImage

@main struct Check {
    static func main() async throws {
        let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let duration = try await asset.load(.duration).seconds
        let track = try await asset.loadTracks(withMediaType: .video).first!
        let size = try await track.load(.naturalSize)
        precondition(abs(duration - 2.2) < 0.07, "Unexpected trimmed duration: \(duration)")
        precondition(size.width > 0 && size.height > 0)
        let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true
        let image = try await generator.image(at: CMTime(seconds: 1, preferredTimescale: 600)).image
        let bitmap = NSBitmapImageRep(cgImage: image)
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]).deletingPathExtension().appendingPathExtension("png"))
        if let flag = CommandLine.arguments.firstIndex(of: "--geometry") {
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
            let job = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            let keys = job["keys"] as! [[String: Double]]
            let sourceTime = (job["start"] as! Double) + 1
            let key = keys.min(by: { abs($0["t"]! - sourceTime) < abs($1["t"]! - sourceTime) })!
            let source = AVURLAsset(url: URL(fileURLWithPath: job["source"] as! String))
            let sourceGenerator = AVAssetImageGenerator(asset: source); sourceGenerator.appliesPreferredTrackTransform = true
            let reference = try await sourceGenerator.image(at: CMTime(seconds: sourceTime, preferredTimescale: 600)).image
            func pixel(_ frame: CGImage, _ x: Int, _ y: Int) -> [UInt8] {
                var result = [UInt8](repeating: 0, count: 4)
                CIContext().render(CIImage(cgImage: frame), toBitmap: &result, rowBytes: 4, bounds: CGRect(x: x, y: frame.height - 1 - y, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
                return result
            }
            let expected = pixel(reference, Int(key["x"]! * Double(reference.width)), Int(key["y"]! * Double(reference.height)))
            let actual = pixel(image, image.width / 2, image.height / 2)
            for i in 0..<3 { precondition(abs(Int(expected[i]) - Int(actual[i])) <= 18, "Export camera center differs from preview trajectory: \(expected) vs \(actual)") }
        }
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        if CommandLine.arguments.contains("--audio") {
            precondition(audioTracks.count == 1, "Missing exported audio")
            let audioDuration = try await audioTracks[0].load(.timeRange).duration.seconds
            precondition(abs(audioDuration - duration) < 0.1, "Audio duration mismatch")
        }
        print("Export validated: \(size.width)×\(size.height), \(duration)s")
    }
}
