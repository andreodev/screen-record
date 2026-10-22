import AppKit

@main struct PrepareStudioAssets {
    static func main() throws {
        let source = URL(fileURLWithPath: CommandLine.arguments[1])
        let destination = URL(fileURLWithPath: CommandLine.arguments[2])
        let fm = FileManager.default
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        var wallpapers = [[String: Any]](), cursors = [[String: Any]]()
        let cursorsOnly = CommandLine.arguments.contains("--cursors-only")
        if cursorsOnly {
            let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: destination.appendingPathComponent("catalog.json"))) as! [String: Any]
            wallpapers = catalog["wallpapers"] as! [[String: Any]]
        }
        func render(_ image: NSImage, limit: CGFloat, jpeg: Bool, vector: Bool = false, to url: URL) throws -> (Int, Int) {
            let scale = vector ? limit / max(image.size.width, image.size.height) : min(1, limit / max(image.size.width, image.size.height))
            let width = max(1, Int((image.size.width * scale).rounded())), height = max(1, Int((image.size.height * scale).rounded()))
            guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw NSError(domain: "Asset rendering failed", code: 3) }
            context.interpolationQuality = .high
            // Draw the original representation at the target size; rasterizing an SVG first loses its edges.
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            image.draw(in: NSRect(x: 0, y: 0, width: width, height: height), from: .zero, operation: .copy, fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high])
            NSGraphicsContext.restoreGraphicsState()
            let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
            guard let data = bitmap.representation(using: jpeg ? .jpeg : .png, properties: [.compressionFactor: 0.87]) else { throw NSError(domain: "Assets", code: 1) }
            try data.write(to: url)
            return (width, height)
        }
        for kind in ["backgrounds", "cursors"] {
            if cursorsOnly && kind == "backgrounds" { continue }
            let directory = source.appendingPathComponent(kind)
            let files = (fm.enumerator(at: directory, includingPropertiesForKeys: nil)?.allObjects as? [URL] ?? []).filter { ["jpg", "jpeg", "png", "svg"].contains($0.pathExtension.lowercased()) }.sorted { $0.path < $1.path }
            for (index, file) in files.enumerated() {
                try autoreleasepool {
                    guard let image = NSImage(contentsOf: file) else { throw NSError(domain: "Cannot decode \(file.path)", code: 2) }
                    let relative = String(file.path.dropFirst(directory.path.count + 1))
                    let id = String(relative.dropLast(file.pathExtension.count + 1))
                    if kind == "backgrounds" {
                        let name = "w\(index).jpg", thumb = "wt\(index).jpg"
                        let (w,h) = try render(image, limit: 1920, jpeg: true, to: destination.appendingPathComponent(name))
                        _ = try render(image, limit: 160, jpeg: true, to: destination.appendingPathComponent(thumb))
                        wallpapers.append(["id": id, "group": file.deletingLastPathComponent().lastPathComponent, "label": file.deletingPathExtension().lastPathComponent, "file": name, "thumb": thumb, "width": w, "height": h])
                    } else {
                        let name = "c\(index).png"
                        let (w,h) = try render(image, limit: 1024, jpeg: false, vector: file.pathExtension.lowercased() == "svg", to: destination.appendingPathComponent(name))
                        let stem = file.deletingPathExtension().lastPathComponent
                        let hotspot = stem.components(separatedBy: "__").last?.split(separator: "-").compactMap { Double($0) } ?? []
                        let hx = hotspot.count == 2 ? hotspot[0] / 100 : 0, hy = hotspot.count == 2 ? hotspot[1] / 100 : 0
                        cursors.append(["id": id, "group": file.deletingLastPathComponent().lastPathComponent, "label": stem.components(separatedBy: "__")[0], "file": name, "width": w, "height": h, "hotspotX": hx, "hotspotY": hy])
                    }
                }
            }
        }
        let data = try JSONSerialization.data(withJSONObject: ["wallpapers": wallpapers, "cursors": cursors], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: destination.appendingPathComponent("catalog.json"))
        print("Prepared \(wallpapers.count) wallpapers and \(cursors.count) cursors")
    }
}
