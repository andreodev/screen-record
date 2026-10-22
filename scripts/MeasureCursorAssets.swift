import AppKit

// Measure visible pixels without changing the images or their hotspots.
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let catalogURL = root.appendingPathComponent("catalog.json")
var catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: catalogURL)) as! [String: Any]
var cursors = catalog["cursors"] as! [[String: Any]]
for index in cursors.indices {
    let url = root.appendingPathComponent(cursors[index]["file"] as! String)
    let image = NSBitmapImageRep(data: try Data(contentsOf: url))!.cgImage!
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    var top = height, bottom = -1
    pixels.withUnsafeMutableBytes { bytes in
        let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let data = bytes.bindMemory(to: UInt8.self)
        for y in 0..<height {
            for x in 0..<width where data[(y * width + x) * 4 + 3] > 20 {
                top = min(top, y); bottom = max(bottom, y)
            }
        }
    }
    cursors[index]["visibleHeight"] = max(1, bottom - top + 1)
}
catalog["cursors"] = cursors
let data = try JSONSerialization.data(withJSONObject: catalog, options: [.prettyPrinted, .sortedKeys])
try data.write(to: catalogURL, options: .atomic)
if CommandLine.arguments.count > 2 { try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic) }
print("Measured \(cursors.count) cursor images")
