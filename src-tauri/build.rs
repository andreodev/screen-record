fn main() {
    println!("cargo:rerun-if-changed=native/FrameNative.swift");
    println!("cargo:rerun-if-changed=native/Info.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") { "arm64" } else { "x86_64" };
        let swift_target = format!("{arch}-apple-macos13.0");
        let output = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"))
            .join("target/frame-native");
        let bundle = output.join("FrameNative.app/Contents");
        std::fs::create_dir_all(bundle.join("MacOS")).expect("Create native helper app bundle");
        std::fs::copy("native/Info.plist", bundle.join("Info.plist")).expect("Write native helper app metadata");
        let executable = bundle.join("MacOS/frame-native");
        let status = std::process::Command::new("xcrun")
            .args(["swiftc", "-swift-version", "5", "-parse-as-library", "-O", "native/FrameNative.swift", "-o"])
            .arg(&executable)
            .args(["-target", &swift_target])
            .status().expect("Swift compiler required for the native media helper");
        assert!(status.success(), "Native media helper failed to compile");
        let signed = std::process::Command::new("codesign").args(["--force", "--deep", "--sign", "-"]).arg(bundle.parent().expect("Helper app bundle")).status().expect("codesign required for the native camera helper");
        assert!(signed.success(), "Native camera helper failed to sign");
        println!("cargo:rustc-env=FRAME_NATIVE_HELPER={}", executable.display());
    }
    tauri_build::build()
}
