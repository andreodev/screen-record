import AppKit
import AVFoundation
import CoreVideo

@main struct Fixture {
    static func main() async throws {
        let path = CommandLine.arguments[1]
        let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1280, AVVideoHeightKey: 800])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: 1280, kCVPixelBufferHeightKey as String: 800])
        writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
        for i in 0..<90 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
            var buffer: CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
            let pixel = buffer!; CVPixelBufferLockBaseAddress(pixel, [])
            let cg = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: 1280, height: 800, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
            cg.setFillColor(NSColor(calibratedRed: 0.09, green: 0.10, blue: 0.14, alpha: 1).cgColor); cg.fill(CGRect(x: 0, y: 0, width: 1280, height: 800))
            for y in 0..<3 { for x in 0..<4 {
                let rect = CGRect(x: 50 + x * 300, y: 60 + y * 230, width: 270, height: 190)
                cg.setFillColor(NSColor(calibratedHue: CGFloat(x + y * 4) / 12, saturation: 0.45, brightness: 0.65, alpha: 1).cgColor); cg.fill(rect)
                cg.setFillColor(NSColor.white.withAlphaComponent(0.2).cgColor); cg.fill(CGRect(x: rect.minX + 20, y: rect.minY + 35, width: 170, height: 8)); cg.fill(CGRect(x: rect.minX + 20, y: rect.minY + 60, width: 220, height: 8))
            } }
            cg.setFillColor(NSColor.white.cgColor); cg.fill(CGRect(x: 50 + i * 10, y: 770, width: 30, height: 8))
            CVPixelBufferUnlockBaseAddress(pixel, []); precondition(adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(i), timescale: 30)))
        }
        input.markAsFinished(); await writer.finishWriting(); precondition(writer.status == .completed)
        print(path)
    }
}
