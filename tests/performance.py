"""Opt-in macOS benchmark: CPU time + physical footprint of app and its new WebKit services.
Usage: python3 tests/performance.py export|preview|export-desktop OUTPUT_DIR
Prepare the synthetic media/job with MakeFixture.swift, MakeLongFixture.swift and prepare-benchmark.ts first.
"""
import ctypes
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / 'src-tauri/target/debug/bundle/macos/Frame Studio.app/Contents'

class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in [
        'user', 'system', 'idle_wakeups', 'interrupt_wakeups', 'pageins', 'wired', 'resident', 'footprint',
        'start', 'exit', 'child_user', 'child_system', 'child_idle', 'child_interrupt', 'child_pageins', 'child_elapsed', 'read', 'written']]

libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
libproc.proc_pid_rusage.restype = ctypes.c_int

class Timebase(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
base = Timebase()
ctypes.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(ctypes.byref(base))
TICK_NANOSECONDS = base.numer / base.denom

def usage(pid):
    value = Usage()
    if libproc.proc_pid_rusage(pid, 2, ctypes.byref(value)) != 0:
        return None
    return value

def processes():
    output = subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True)
    return {int(line.strip().split(None, 1)[0]): line.strip().split(None, 1)[1] for line in output.splitlines() if len(line.strip().split(None, 1)) == 2}

def percentile(values, p):
    return sorted(values)[min(len(values) - 1, int(len(values) * p))] if values else 0

def summarize(samples):
    return { 'samples': len(samples), 'cpuMeanPercentOfOneCore': statistics.mean(s['cpu'] for s in samples) if samples else 0,
        'cpuP95PercentOfOneCore': percentile([s['cpu'] for s in samples], .95),
        'footprintPeakMiB': max((s['footprint'] for s in samples), default=0),
        'footprintFirstMiB': samples[0]['footprint'] if samples else 0, 'footprintLastMiB': samples[-1]['footprint'] if samples else 0 }

if __name__ == '__main__':
    mode, folder = sys.argv[1], Path(sys.argv[2]).resolve()
    folder.mkdir(exist_ok=True, parents=True)
    before = processes()
    if mode == 'export':
        command = [str(BUNDLE / 'Resources/frame-native'), 'export', str(folder / 'export-job.json')]
        env = os.environ.copy()
        timeout = 900
    elif mode in ['preview', 'export-desktop']:
        report = folder / (mode + '-frames.jsonl')
        report.unlink(missing_ok=True)
        config = folder / (mode + '-config.json')
        config.write_text(json.dumps({'project': str(folder / 'project.frame.json'), 'report': str(report), 'seconds': 600, 'idleSeconds': 20, 'mode': 'export' if mode == 'export-desktop' else 'preview', 'destination': str(folder / 'desktop-export.mp4')}))
        env = dict(os.environ, FRAME_STUDIO_BENCHMARK=str(config))
        command = [str(BUNDLE / 'MacOS/screen-studio')]
        timeout = 960
    else:
        raise SystemExit('Expected export, preview or export-desktop')
    samples, previous, tracked, names = [], {}, set(), {}
    live = folder / (mode + '-resources.jsonl')
    live.write_text('')
    log_path = folder / (mode + '.log')
    start = time.monotonic()
    with log_path.open('w') as log:
        child = subprocess.Popen(command, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log, text=True)
        tracked.add(child.pid)
        try:
            while child.poll() is None:
                now = time.monotonic()
                all_processes = processes()
                tracked.update(pid for pid, name in all_processes.items() if pid not in before and (any(framework in name for framework in ['/WebKit.framework/', '/VideoToolbox.framework/']) or name == str(BUNDLE / 'Resources/frame-native')))
                names.update({pid: name for pid, name in all_processes.items() if pid in tracked})
                cpu, footprint, resident = 0, 0, 0
                per_process = []
                for pid in tracked:
                    value = usage(pid)
                    if value is None: continue
                    cpu_time = (value.user + value.system) * TICK_NANOSECONDS
                    if pid in previous:
                        wall, previous_cpu = previous[pid]
                        cpu += max(0, cpu_time - previous_cpu) / 1e9 / (now - wall) * 100
                    previous[pid] = now, cpu_time
                    per_process.append({"pid": pid, "footprintMiB": value.footprint / 2**20})
                    footprint += value.footprint
                    resident += value.resident
                samples.append({'elapsed': now - start, 'utc': time.time() * 1000, 'cpu': cpu, 'footprint': footprint / 2**20, 'rss': resident / 2**20, 'processes': per_process})
                with live.open('a') as output: output.write(json.dumps(samples[-1]) + '\n')
                if mode in ['preview', 'export-desktop'] and report.exists():
                    reports = [json.loads(line) for line in report.read_text().splitlines()]
                    if any(r['phase'] in ['error', 'paused-after-playback'] for r in reports): break
                if now - start > timeout:
                    raise TimeoutError('Benchmark exceeded timeout')
                time.sleep(1)
        finally:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=10)
            child.stdin.close()
    summary = summarize(samples[2:])
    summary['footprintPeakMiB'] = max((s['footprint'] for s in samples), default=0)
    result = {'mode': mode, 'wallSeconds': time.monotonic() - start, 'returncode': child.returncode,
        'processes': [{'pid': pid, 'name': names.get(pid, 'exited')} for pid in sorted(tracked)],
        'summary': summary, 'samples': samples}
    if mode in ['preview', 'export-desktop'] and report.exists():
        reports = [json.loads(line) for line in report.read_text().splitlines()]
        for phase in reports:
            rows = [s for s in samples if phase.get('startUTC', 0) <= s['utc'] <= phase.get('endUTC', 0)]
            phase['resources'] = summarize(rows)
        result['phases'] = reports
    (folder / (mode + '-performance.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k != 'samples'}, indent=2), flush=True)
    if mode == 'export' and child.returncode != 0:
        raise SystemExit(log_path.read_text()[-4000:])

    if mode in ['preview', 'export-desktop'] and [p['phase'] for p in result.get('phases', [])] != ['idle', 'export' if mode == 'export-desktop' else 'playback', 'paused-after-playback']:
        raise SystemExit('Preview benchmark did not finish all phases')
