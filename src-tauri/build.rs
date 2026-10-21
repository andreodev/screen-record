fn main() {
    println!("cargo:rerun-if-changed=native/FrameNative.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") { "arm64" } else { "x86_64" };
        let swift_target = format!("{arch}-apple-macos13.0");
        let status = std::process::Command::new("xcrun")
            .args(["swiftc", "-swift-version", "5", "-parse-as-library", "-O", "native/FrameNative.swift", "-o", "native/frame-native"])
            .args(["-target", &swift_target])
            .status().expect("Swift compiler required for the native media helper");
        assert!(status.success(), "Native media helper failed to compile");
    }
    tauri_build::build()
}
