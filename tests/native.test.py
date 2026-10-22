"""macOS integration checks. Uses only synthetic media in a temporary directory."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent

def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, f"Command failed ({result.returncode}): {args}\n{result.stdout}{result.stderr}"
    return result.stdout

def compile_swift(source, output):
    run("xcrun", "swiftc", "-swift-version", "5", "-parse-as-library", "-O", str(source), "-o", str(output))

with tempfile.TemporaryDirectory(prefix="frame-test-") as folder:
    folder = Path(folder)
    helper, fixture, add_audio, checker = [folder / x for x in ["native", "fixture", "add-audio", "check"]]
    compile_swift(ROOT / "src-tauri/native/FrameNative.swift", helper)
    for source, target in [("MakeFixture.swift", fixture), ("AddAudio.swift", add_audio), ("CheckExport.swift", checker)]:
        compile_swift(ROOT / "tests" / source, target)
    clock_source, clock_check = folder / "capture-clock.swift", folder / "capture-clock"
    clock_source.write_text((ROOT / "src-tauri/native/FrameNative.swift").read_text().split("@main struct Main")[0] + (ROOT / "tests/CaptureClock.swift").read_text())
    compile_swift(clock_source, clock_check)
    clock_events = [json.loads(line) for line in run(str(clock_check), str(folder / "clock-unused.mov")).splitlines()]
    assert [event["seconds"] for event in clock_events] == [0, .125, 5.25]
    print("Native recording timer passed: first-frame origin, throttling and final duration.")
    sampling_source, sampling_check, sampling_cases = folder / "motion.swift", folder / "motion-check", folder / "motion.json"
    sampling_source.write_text((ROOT / "src-tauri/native/FrameNative.swift").read_text().split("@main struct Main")[0] + (ROOT / "tests/MotionSampling.swift").read_text())
    compile_swift(sampling_source, sampling_check)
    run("node", "--experimental-strip-types", "tests/motion-parity-fixture.ts", str(sampling_cases))
    print(run(str(sampling_check), str(sampling_cases)).strip())
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
                child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
                raise AssertionError("Native export exceeded the 120 second limit")
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
        print(run(str(checker), job["destination"], "--geometry", str(jobfile)).strip(), "with camera focus checked in", aspect)
        info = json.loads(run(str(helper), "inspect", job["destination"]))["media"]
        assert abs(info["duration"] - 2.2) < .07
        assert abs(info["width"] / info["height"] - (9 / 16 if aspect == "9:16" else 1)) < .005
        print("Aspect export passed:", aspect)
    job.update(resolution=1080, fps=30)
    job["appearance"].update(aspect="9:16", cropFill=False, backgroundMode="video-blur", backgroundBlur=18)
    job["destination"] = str(folder / "vertical-blurred-background.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--different-frame", str(folder / "9-16.mp4"), "--format", "1080", "1920", "30").strip(), "with a full-frame blurred video background")
    job["appearance"]["aspect"] = "auto"
    job["source"] = str(audio)
    job["destination"] = str(folder / "audio-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--audio").strip(), "with audio")
    job["backgroundAudio"] = {"path": str(audio), "volume": .25}
    job["destination"] = str(folder / "background-audio-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--audio").strip(), "with source audio and looped background music mixed")
    job.pop("backgroundAudio")
    # Keep the webcam over the current camera focus so the global camera pass
    # retains the overlay in the composed frame and the pixel check can see it.
    job["webcam"] = {"path": str(audio), "x": .2, "y": .7, "size": .24, "shape": "circle"}
    job["destination"] = str(folder / "webcam-overlay.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--different-frame", str(folder / "audio-output.mp4")).strip(), "with webcam overlay composited")
    job.pop("webcam")
    # Exercise real encodes, including portrait and square 4K, with audio and trimmed timestamps.
    for resolution, fps, aspect, width, height in [
        (2160, 60, "16:9", 3840, 2160),
        (2160, 60, "9:16", 2160, 3840),
        (2160, 60, "1:1", 2160, 2160),
        (720, 24, "16:9", 1280, 720),
        (1440, 30, "16:9", 2560, 1440),
    ]:
        job.update(resolution=resolution, fps=fps)
        job["appearance"]["aspect"] = aspect
        job["destination"] = str(folder / f"output-{resolution}-{fps}-{width}.mp4")
        export_job(job)
        print(run(str(checker), job["destination"], "--audio", "--geometry", str(jobfile), "--format", str(width), str(height), str(fps)).strip())
    # A separate cursor track must change the composed video when the chosen asset changes.
    job.update(resolution=720, fps=30, assetsRoot=str(ROOT / "src-tauri/resources/studio-assets"))
    job["appearance"].update(aspect="16:9", cursorSize=48)
    job["appearance"].pop("cursorTheme", None)
    job["cursor"] = [{"t": 0, "x": .5, "y": .5, "down": False}, {"t": 3, "x": .5, "y": .5, "down": False}]
    job["keys"] = [{"t": 0, "x": .5, "y": .5, "scale": 1}, {"t": 3, "x": .5, "y": .5, "scale": 1}]
    job["destination"] = str(folder / "default-cursor.mp4")
    export_job(job)
    default_cursor = job["destination"]
    job["appearance"]["cursorAsset"] = "sets/custom-1/pointinghand-1__10-17"
    job["destination"] = str(folder / "selected-cursor.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--different-cursor", default_cursor).strip(), "with selected cursor pixels checked")
    job["appearance"].pop("cursorAsset", None)
    job["appearance"]["cursorTheme"] = "macos"
    job["cursor"] = [dict(event, kind=kind) for event, kind in zip([
        {"t": 0, "x": .5, "y": .5, "down": False},
        {"t": .8, "x": .5, "y": .5, "down": False},
        {"t": 1.8, "x": .5, "y": .5, "down": False},
    ], ["pointer", "pointinghand", "ibeam"])]
    job["destination"] = str(folder / "context-cursor.mp4")
    export_job(job)
    context_cursor = job["destination"]
    print(run(str(checker), context_cursor, "--cursor-transition").strip(), "with pointer/hand/text transitions checked")
    job["appearance"]["cursorSize"] = 16
    job["destination"] = str(folder / "small-context-cursor.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--different-cursor", context_cursor).strip(), "with cursor size pixels checked")
    job.update(ranges=[{"start": .3, "end": 1}, {"start": 1.6, "end": 2.5}], resolution=720, fps=60)
    job["appearance"].update(aspect="auto", padding=0, radius=0, shadow=0, cursorSize=0)
    job["destination"] = str(folder / "cut-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--duration", "1.6", "--audio", "--format", "1152", "720", "60", "--cuts", str(jobfile)).strip(), "with deleted interval and source frames checked")
    job["ranges"] = [{"start": .3, "end": 1, "speed": 2}, {"start": 1.6, "end": 2.5, "speed": .5}]
    job["destination"] = str(folder / "speed-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--duration", "2.15", "--audio", "--format", "1152", "720", "60", "--cuts", str(jobfile)).strip(), "with fast/slow segments, source frames and audio checked")
    job.pop("ranges")
    job["appearance"].update(cursorSize=48)
    job["keys"] = [{"t": 0, "x": .5, "y": .5, "scale": 1}, {"t": 3, "x": .5, "y": .5, "scale": 1}]
    job["cursor"] = [{"t": 0, "x": .1, "y": .5, "down": False}, {"t": 3, "x": .9, "y": .5, "down": False}]
    job["rawCursor"] = [{"t": 0, "x": .7, "y": .5, "down": False}, {"t": 3, "x": .7, "y": .5, "down": False}]
    job["destination"] = str(folder / "effects-base.mp4")
    export_job(job)
    effects_base = job["destination"]
    for label, options in [("hidden", {"hideCursor": True}), ("original", {"cursorOriginal": True})]:
        job["ranges"] = [{"start": .3, "end": 2.5, **options}]
        job["destination"] = str(folder / f"cursor-{label}.mp4")
        export_job(job)
        print(run(str(checker), job["destination"], "--different-frame", effects_base).strip(), f"with {label} cursor segment pixels checked")
    job.pop("ranges")
    job["appearance"]["motionBlur"] = {"cursor": 1, "zoom": 0, "pan": 0}
    job["destination"] = str(folder / "cursor-blur.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--different-frame", effects_base).strip(), "with cursor blur pixels checked")
    job["appearance"].update(cursorSize=0, motionBlur={"cursor": 0, "zoom": 0, "pan": 0})
    job["keys"] = [{"t": 0, "x": .5, "y": .5, "scale": 1}, {"t": 3, "x": .6, "y": .5, "scale": 2}]
    job["destination"] = str(folder / "camera-base.mp4")
    export_job(job)
    camera_base = job["destination"]
    for effect in ["zoom", "pan"]:
        job["appearance"]["motionBlur"] = {"cursor": 0, "zoom": int(effect == "zoom"), "pan": int(effect == "pan")}
        job["destination"] = str(folder / f"camera-{effect}-blur.mp4")
        export_job(job)
        print(run(str(checker), job["destination"], "--different-frame", camera_base).strip(), f"with {effect} blur pixels checked")
    job["appearance"].pop("motionBlur")
    job["keys"] = [{"t": 0, "x": .5, "y": .5, "scale": 1}, {"t": 3, "x": .5, "y": .5, "scale": 1}]
    job["effects"] = []
    job["destination"] = str(folder / "effects-base.mp4")
    export_job(job)
    effects_base = job["destination"]
    for kind in ["mask", "highlight"]:
        job["effects"] = [{"id": kind, "kind": kind, "start": .3, "end": 2.5, "x": .5, "y": .5, "width": .35, "height": .32, "opacity": .55}]
        job["destination"] = str(folder / f"{kind}-output.mp4")
        export_job(job)
        print(run(str(checker), job["destination"], "--different-frame", effects_base).strip(), f"with {kind} effect pixels checked")
    job.pop("effects")
    job["keys"] = [{"t": 0, "x": .5, "y": .5, "scale": 1}, {"t": 1.3, "x": .5, "y": .5, "scale": 2, "cut": True}, {"t": 1.8, "x": .5, "y": .5, "scale": 1, "cut": True}, {"t": 3, "x": .5, "y": .5, "scale": 1}]
    job["destination"] = str(folder / "instant-output.mp4")
    export_job(job)
    print(run(str(checker), job["destination"], "--geometry", str(jobfile)).strip(), "with instant zoom geometry checked")
    for invalid_ranges in [[], [{"start": 1, "end": .5}], [{"start": .3, "end": 2}, {"start": 1, "end": 2.5}], [{"start": .3, "end": 2.5, "speed": 0}], [{"start": .3, "end": 2.5, "speed": 5}]]:
        jobfile.write_text(json.dumps(dict(job, ranges=invalid_ranges)))
        failed = subprocess.run([str(helper), "export", str(jobfile)], input="", capture_output=True, text=True)
        assert failed.returncode != 0 and "Cortes inválidos" in failed.stdout
    for field, invalid in [("resolution", 4320), ("fps", 120)]:
        invalid_job = dict(job, **{field: invalid})
        jobfile.write_text(json.dumps(invalid_job))
        failed = subprocess.run([str(helper), "export", str(jobfile)], input="", capture_output=True, text=True)
        assert failed.returncode != 0 and "taxa de quadros inválida" in failed.stdout
    protected = folder / "protected.mp4"
    protected.write_bytes(b"previous output")
    job["destination"] = str(protected)
    export_job(job, cancel=True)
    assert protected.read_bytes() == b"previous output", "Cancellation overwrote a previous output"
    assert not list(folder.glob(".frame-*.mp4")), "Temporary files were not cleaned"
    assert hashlib.sha256(source.read_bytes()).digest() == original, "Export changed original media"
    print("Cancellation, cleanup and source preservation passed.")
