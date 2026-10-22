import AppKit
import AVFoundation
import CoreImage

func require(_ condition: @autoclosure () -> Bool, _ message: String = "Export assertion failed") {
    if !condition() { fputs(message + "\n", stderr); exit(1) }
}
@main struct Check {
    static func main() async throws {
        let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let duration = try await asset.load(.duration).seconds
        let track = try await asset.loadTracks(withMediaType: .video).first!
        let size = try await track.load(.naturalSize)
        let durationFlag = CommandLine.arguments.firstIndex(of: "--duration")
        let expectedDuration = durationFlag.map { Double(CommandLine.arguments[$0 + 1])! } ?? 2.2
        require(abs(duration - expectedDuration) < 0.07, "Unexpected trimmed duration: \(duration)")
        require(size.width > 0 && size.height > 0)
        let fps = try await track.load(.nominalFrameRate)
        if let flag = CommandLine.arguments.firstIndex(of: "--format") {
            let width = Int(CommandLine.arguments[flag + 1])!, height = Int(CommandLine.arguments[flag + 2])!, expectedFps = Int(CommandLine.arguments[flag + 3])!
            require(Int(size.width) == width && Int(size.height) == height, "Unexpected export resolution: \(size)")
            require(abs(Double(fps) - Double(expectedFps)) < 0.1, "Unexpected frame rate: \(fps)")
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
            reader.add(output); require(reader.startReading())
            var timestamps: [Double] = []
            while let sample = output.copyNextSampleBuffer() {
                let time = CMSampleBufferGetPresentationTimeStamp(sample).seconds
                timestamps.append(time)
            }
            require(reader.status == .completed)
            require(timestamps.count == Int(ceil(expectedDuration * Double(expectedFps) - 0.000001)), "Unexpected frame count: \(timestamps.count)")
            for (index, time) in timestamps.sorted().enumerated() {
                require(abs(time - Double(index) / Double(expectedFps)) < 0.002, "Irregular frame timestamp: \(time)")
            }
        }
        let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true; generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
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
            for i in 0..<3 { require(abs(Int(expected[i]) - Int(actual[i])) <= 18, "Export camera center differs from preview trajectory: \(expected) vs \(actual)") }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--cuts") {
            let job = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))) as! [String: Any]
            let ranges = job["ranges"] as! [[String: Double]]
            for time in [0.1, 0.6, 0.8, 1.2, 1.5] {
                var remaining = time, sourceTime = 0.0
                for range in ranges {
                    let speed = range["speed"] ?? 1
                    let length = (range["end"]! - range["start"]!) / speed
                    if remaining < length { sourceTime = range["start"]! + remaining * speed; break }
                    remaining -= length
                }
                let frame = try await generator.image(at: CMTime(seconds: time, preferredTimescale: 600)).image
                let fixtureFrame = Int(floor(sourceTime * 30 + 0.00001))
                var pixel = [UInt8](repeating: 0, count: 4)
                let scale = Double(frame.width) / 1280
                let point = CGRect(x: Int(Double(65 + fixtureFrame * 10) * scale), y: Int(774 * scale), width: 1, height: 1)
                CIContext().render(CIImage(cgImage: frame), toBitmap: &pixel, rowBytes: 4, bounds: point, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
                require(pixel[0] > 210 && pixel[1] > 210 && pixel[2] > 210, "Deleted interval or wrong frame after cut: output \(time), source \(sourceTime), pixel \(pixel)")
            }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--different-cursor") {
            let other = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
            let otherGenerator = AVAssetImageGenerator(asset: other)
            let otherImage = try await otherGenerator.image(at: CMTime(seconds: 1, preferredTimescale: 600)).image
            let region = CGRect(x: image.width / 2 - 45, y: image.height / 2 - 60, width: 90, height: 120)
            func pixels(_ image: CGImage) -> [UInt8] {
                var bytes = [UInt8](repeating: 0, count: 90 * 120 * 4)
                CIContext().render(CIImage(cgImage: image), toBitmap: &bytes, rowBytes: 90 * 4, bounds: region, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
                return bytes
            }
            let a = pixels(image), b = pixels(otherImage)
            let changed = zip(a, b).filter { abs(Int($0) - Int($1)) > 30 }.count
            require(changed > 60, "Selected cursor did not change the video pixels")
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--different-frame") {
            let other = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
            let otherGenerator = AVAssetImageGenerator(asset: other)
            otherGenerator.requestedTimeToleranceBefore = .zero; otherGenerator.requestedTimeToleranceAfter = .zero
            let otherImage = try await otherGenerator.image(at: CMTime(seconds: 1, preferredTimescale: 600)).image
            func pixels(_ image: CGImage) -> [UInt8] {
                var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
                CIContext().render(CIImage(cgImage: image), toBitmap: &bytes, rowBytes: image.width * 4, bounds: CGRect(x: 0, y: 0, width: image.width, height: image.height), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
                return bytes
            }
            let a = pixels(image), b = pixels(otherImage)
            require(a.count == b.count)
            let changed = zip(a, b).filter { abs(Int($0) - Int($1)) > 20 }.count
            require(changed > 60, "Effect did not change composed frame pixels")
        }
        if CommandLine.arguments.contains("--cursor-transition") {
            func pixels(_ at: Double) async throws -> [UInt8] {
                let frame = try await generator.image(at: CMTime(seconds: at, preferredTimescale: 600)).image
                var bytes = [UInt8](repeating: 0, count: 90 * 120 * 4)
                CIContext().render(CIImage(cgImage: frame), toBitmap: &bytes, rowBytes: 90 * 4, bounds: CGRect(x: frame.width / 2 - 45, y: frame.height / 2 - 60, width: 90, height: 120), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
                return bytes
            }
            let arrow = try await pixels(0.1), hand = try await pixels(1), text = try await pixels(1.9)
            for other in [arrow, text] {
                require(zip(hand, other).filter { abs(Int($0) - Int($1)) > 30 }.count > 60, "Cursor theme did not change with recorded context")
            }
        }
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        if CommandLine.arguments.contains("--audio") {
            require(audioTracks.count == 1, "Missing exported audio")
            let audioDuration = try await audioTracks[0].load(.timeRange).duration.seconds
            require(abs(audioDuration - duration) < 0.1, "Audio duration mismatch: \(audioDuration) vs \(duration)")
        }
        if CommandLine.arguments.contains("--no-audio") {
            require(audioTracks.isEmpty, "Unexpected audio when click sounds are disabled")
        }
        print("Export validated: \(size.width)×\(size.height), \(duration)s, \(fps) fps")
    }
}
