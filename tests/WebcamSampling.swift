@main struct WebcamSampling {
    static func main() {
        let webcam = Webcam(path: "camera.mov", x: 0.5, y: 0.5, size: 0.2, shape: "circle", keyframes: [
            WebcamKeyframe(t: 1, x: 0.2, y: 0.4, size: 0.1, opacity: 0.2, borderRadius: 0.1, easing: "ease-in-out"),
            WebcamKeyframe(t: 3, x: 0.8, y: 0.6, size: 0.3, opacity: 1, borderRadius: 0.4, easing: "linear"),
        ], mode: "manual", opacity: 1, border: 2, shadow: 30, borderRadius: 0.5)
        let before = webcamState(webcam, 0), middle = webcamState(webcam, 2), after = webcamState(webcam, 4)
        precondition(before.x == 0.2 && before.size == 0.1)
        precondition(abs(middle.x - 0.5) < 1e-9 && abs(middle.y - 0.5) < 1e-9 && abs(middle.size - 0.2) < 1e-9 && abs((middle.opacity ?? -1) - 0.6) < 1e-9)
        precondition(after.x == 0.8 && after.size == 0.3)
        let eased = webcamEase(0.5, "ease-in-out")
        precondition(abs(eased - 0.5) < 1e-9)
        let automatic = plannedWebcamState(WebcamKeyframe(t: 0, x: 0.5, y: 0.5, size: 0.2, opacity: 1, borderRadius: 0.5, easing: nil), "auto", 1.5, "9:16", 0.65)
        precondition(automatic.size < 0.2 && automatic.x > 0.5 && automatic.y > 0.5)
        let staticCamera = Webcam(path: "camera.mov", x: 0.5, y: 0.5, size: 0.2, shape: "circle", keyframes: webcam.keyframes, mode: "static", opacity: 1, border: 2, shadow: 30, borderRadius: 0.5)
        precondition(webcamState(staticCamera, 2).x == 0.5)
        print("Webcam easing, variants, automatic focus avoidance and static independence passed.")
    }
}
