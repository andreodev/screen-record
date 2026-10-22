struct ExpectedCamera: Decodable { let x: Double; let y: Double; let scale: Double }
struct ExpectedMotion: Decodable { let camera: ExpectedCamera; let cursor: Pointer? }
struct MotionCase: Decodable { let t: Double; let keys: [Key]; let cursor: [Pointer]; let range: ClipRange; let blur: MotionBlur; let cuts: [Double]; let expected: [ExpectedMotion] }
@main struct MotionSampling {
    static func main() throws {
        let cases = try JSONDecoder().decode([MotionCase].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        func equal(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-9 }
        for test in cases {
            let actual = motionFrames(test.t, keys: test.keys, events: test.cursor, range: test.range, blur: test.blur, cuts: test.cuts)
            precondition(actual.count == test.expected.count, "Different sample counts at \(test.t)")
            for (sample, expected) in zip(actual, test.expected) {
                precondition(equal(sample.0.x, expected.camera.x) && equal(sample.0.y, expected.camera.y) && equal(sample.0.scale, expected.camera.scale))
                precondition((sample.1 == nil) == (expected.cursor == nil))
                if let a = sample.1, let b = expected.cursor { precondition(equal(a.x, b.x) && equal(a.y, b.y) && equal(a.t, b.t) && a.down == b.down && a.kind == b.kind) }
            }
        }
        print("Preview/native motion sampling matched in \(cases.count) cases.")
    }
}
