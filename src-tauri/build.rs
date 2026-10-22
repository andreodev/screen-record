fn main() {
    println!("cargo:rerun-if-changed=native/FrameNative.swift");
    println!("cargo:rerun-if-changed=native/Info.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") { "arm64" } else { "x86_64" };
        let swift_target = format!("{arch}-apple-macos13.0");
        let bundle = std::path::Path::new("native/FrameNative.app/Contents");
        std::fs::create_dir_all(bundle.join("MacOS")).expect("Create native helper app bundle");
        std::fs::copy("native/Info.plist", bundle.join("Info.plist")).expect("Write native helper app metadata");
        let status = std::process::Command::new("xcrun")
            .args(["swiftc", "-swift-version", "5", "-parse-as-library", "-O", "native/FrameNative.swift", "-o", "native/FrameNative.app/Contents/MacOS/frame-native"])
            .args(["-target", &swift_target])
            .status().expect("Swift compiler required for the native media helper");
        assert!(status.success(), "Native media helper failed to compile");
        let signed = std::process::Command::new("codesign").args(["--force", "--deep", "--sign", "-", "native/FrameNative.app"]).status().expect("codesign required for the native camera helper");
        assert!(signed.success(), "Native camera helper failed to sign");
    }
    tauri_build::build()
}
