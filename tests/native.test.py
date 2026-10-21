"""macOS integration checks. Uses only synthetic media in a temporary directory."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent

def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout

def compile_swift(source, output):
    run("xcrun", "swiftc", "-swift-version", "5", "-parse-as-library", "-O", str(source), "-o", str(output))

with tempfile.TemporaryDirectory(prefix="frame-test-") as folder:
    folder = Path(folder)
    helper, fixture, add_audio, checker = [folder / x for x in ["native", "fixture", "add-audio", "check"]]
    compile_swift(ROOT / "src-tauri/native/FrameNative.swift", helper)
    for source, target in [("MakeFixture.swift", fixture), ("AddAudio.swift", add_audio), ("CheckExport.swift", checker)]:
        compile_swift(ROOT / "tests" / source, target)
    source, audio = folder / "source.mov", folder / "audio.mov"
    run(str(fixture), str(source))
    run(str(add_audio), str(source), str(audio))
    original = hashlib.sha256(source.read_bytes()).digest()
    jobfile, destination = folder / "job.json", folder / "output.mp4"
    run("node", "--experimental-strip-types", "tests/export-fixture.ts", str(source), str(destination), str(jobfile))
    job = json.loads(jobfile.read_text())

    def export_job(settings, cancel=False):
        jobfile.write_text(json.dumps(settings))
        log = folder / "native.log"
        with log.open("w") as output:
            child = subprocess.Popen([str(helper), "export", str(jobfile)], stdin=subprocess.PIPE, stdout=output, stderr=subprocess.PIPE, text=True)
            if cancel:
                child.stdin.write("cancel\n")
                child.stdin.flush()
            try:
                child.wait(timeout=40)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
                raise AssertionError("Native export stalled")
            stderr = child.stderr.read()
            child.stdin.close()
            child.stderr.close()
        if cancel:
            assert child.returncode != 0
        else:
            assert child.returncode == 0, log.read_text() + stderr
        return log.read_text()

    export_job(job)
    print(run(str(checker), str(destination), "--geometry", str(jobfile)).strip(), "with camera geometry checked")
    for aspect in ["9:16", "1:1"]:
        job["appearance"]["aspect"] = aspect
        job["destination"] = str(folder / (aspect.replace(":", "-") + ".mp4"))
        export_job(job)
        info = json.loads(run(str(helper), "inspect", job["destination"]))["media"]
        assert abs(info["duration"] - 2.2) < .07
        assert abs(info["width"] / info["height"] - (9 / 16 if aspect == "9:16" else 1)) < .005
        print("Aspect export passed:", aspect)
    job["appearance"]["aspect"] = "auto"
    job["source"] = str(audio)
    job["destination"] = str(folder / "audio-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--audio").strip(), "with audio")
    protected = folder / "protected.mp4"
    protected.write_bytes(b"previous output")
    job["destination"] = str(protected)
    export_job(job, cancel=True)
    assert protected.read_bytes() == b"previous output", "Cancellation overwrote a previous output"
    assert not list(folder.glob(".frame-*.mp4")), "Temporary files were not cleaned"
    assert hashlib.sha256(source.read_bytes()).digest() == original, "Export changed original media"
    print("Cancellation, cleanup and source preservation passed.")
