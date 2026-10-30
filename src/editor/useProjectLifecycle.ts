import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { autoZooms, defaults, upgradeAutoZooms } from "../zoom";
import { clipRanges } from "../timeline";
import assetCatalog from "../studio-assets.json";
import { storedAppearance } from "./project-utils";
import type { Media, Operation } from "./types";
import type { RecordingOptions } from "../recording-options";
import type { useProjectHistory } from "./useProjectHistory";
import type { Project } from "./types";

type Setter<T> = Dispatch<SetStateAction<T>>;
function recordingPackage(path: string): string {
  const end = path.replaceAll("\\", "/").lastIndexOf(".framestudio/");
  return end >= 0 ? path.slice(0, end + ".framestudio".length) : "";
}
type ProjectLifecycleOptions = Pick<
  ReturnType<typeof useProjectHistory>,
  | "projectRef"
  | "setProject"
  | "setPast"
  | "setFuture"
  | "histories"
  | "operationRef"
  | "edit"
> & {
  media: Media | null;
  video: RefObject<HTMLVideoElement | null>;
  pendingSeek: RefObject<number>;
  desktop: boolean;
  setPlaying: Setter<boolean>;
  setMedia: Setter<Media | null>;
  setProjectPath: Setter<string>;
  setWallpaperGroup: Setter<string>;
  setSelected: Setter<string | null>;
  setSelectedClip: Setter<number | null>;
  setSelectedEffect: Setter<string | null>;
  setTime: Setter<number>;
  setOperation: Setter<Operation>;
  setError: Setter<string>;
  setNotice: Setter<string>;
  setCapturePermissionDenied: Setter<boolean>;
  setElapsed: Setter<number>;
  setRecordWebcam: Setter<boolean>;
  setCameraPreviewError: Setter<string>;
  setRecordingOptions: Setter<RecordingOptions>;
  setProgress: Setter<number>;
  onLoaded: () => void;
};

export function useProjectLifecycle({
  media,
  video,
  setPlaying,
  setMedia,
  setProjectPath,
  pendingSeek,
  setWallpaperGroup,
  setProject,
  projectRef,
  setPast,
  setFuture,
  histories,
  setSelected,
  setSelectedClip,
  setSelectedEffect,
  setTime,
  setOperation,
  setError,
  setNotice,
  desktop,
  setCapturePermissionDenied,
  setElapsed,
  setRecordWebcam,
  setCameraPreviewError,
  setRecordingOptions,
  setProgress,
  operationRef,
  onLoaded,
  edit,
}: ProjectLifecycleOptions) {
  const load = useCallback(
    (m: Media, document?: Project, documentPath?: string) => {
      video.current?.pause();
      setPlaying(false);
      setMedia(m);
      const loaded: Project = document || {
        version: 13,
        mediaPath: m.path,
        name: m.path.split("/").pop() || "Novo take",
        zooms: autoZooms(m.cursor, m.duration),
        trim: { start: 0, end: m.duration },
        microphone: m.microphonePath
          ? { path: m.microphonePath, volume: 1 }
          : undefined,
        webcam: m.webcamPath
          ? {
              path: m.webcamPath,
              x: 0.78,
              y: 0.78,
              size: 0.24,
              shape: "circle",
            }
          : undefined,
        appearance: storedAppearance(),
      };
      // Resolve the old camera-dependent default once, then keep the two controls independent.
      const p: Project = {
        ...loaded,
        zooms: m.cursorCaptured ? upgradeAutoZooms(loaded.zooms, m.cursor, m.duration) : loaded.zooms,
        appearance: {
          ...loaded.appearance,
          clickSounds: loaded.appearance.clickSounds ?? defaults.clickSounds,
          clickSoundVolume:
            loaded.appearance.clickSoundVolume ?? defaults.clickSoundVolume,
          cursorMotion:
            loaded.appearance.cursorMotion ??
            ((loaded.appearance.cursorSmooth ?? loaded.appearance.smooth)
              ? "medium"
              : "original"),
        },
      };
      setProjectPath(
        documentPath?.endsWith(".framestudio")
          ? documentPath
          : recordingPackage(m.path),
      );
      pendingSeek.current =
        clipRanges(p.trim, p.clips)[0]?.start ?? p.trim.start;
      setWallpaperGroup(
        assetCatalog.wallpapers.find(
          (item) => item.id === p.appearance.wallpaper,
        )?.group || "macOS",
      );
      const loadedProject = { ...p, effects: p.effects ?? [] };
      setProject(loadedProject);
      projectRef.current = loadedProject;
      setPast([]);
      setFuture([]);
      histories.current = { past: [], future: [] };
      setSelected(null);
      setSelectedClip(null);
      setSelectedEffect(null);
      setTime(clipRanges(p.trim, p.clips)[0]?.start ?? p.trim.start);
      setOperation("idle");
      setError("");
      onLoaded();
      setNotice(
        m.cursorCaptured
          ? `${p.zooms.length} zooms sugeridos pelos cliques. Você pode ajustar cada trecho.`
          : "Vídeo importado. Adicione zooms na faixa roxa; este arquivo não tem eventos de cursor.",
      );
    },
    [onLoaded],
  );
  useEffect(() => {
    const current = projectRef.current;
    const packagePath = media && recordingPackage(media.path);
    if (packagePath) setProjectPath(path => path || packagePath);
    if (media?.cursorCaptured && current && operationRef.current === "idle") {
      const zooms = upgradeAutoZooms(current.zooms, media.cursor, media.duration);
      if (zooms !== current.zooms) {
        edit(project => ({ ...project, zooms }));
        setSelected(null);
        setNotice("Zooms automáticos atualizados com cenas mais longas e aproximação progressiva.");
      }
    }
    if (!desktop) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const register = async <T>(name: string, handler: (data: T) => void) => {
      const off = await listen<T>(name, (e) => {
        if (!disposed) handler(e.payload);
      });
      if (disposed) off();
      else cleanups.push(off);
    };
    void register("screen-capture-permission", () =>
      setCapturePermissionDenied(true),
    );
    void register("recording-started", () => {
      setCapturePermissionDenied(false);
      setOperation("recording");
      setElapsed(0);
    });
    void register("recording-pausing", () => setOperation("pausing"));
    void register("recording-paused", () => setOperation("paused"));
    void register("recording-resuming", () => setOperation("starting"));
    void register("recording-resumed", () => setOperation("recording"));
    void register("recording-stopping", () => setOperation("stopping"));
    void register<string>("recording-control-error", (message) =>
      setError(message),
    );
    void register("camera-preview-closed", () => {
      setRecordWebcam(false);
      setCameraPreviewError("");
    });
    void register("camera-preview-reset", () => {
      setCameraPreviewError("");
      setError("");
    });
    void register<string>("camera-preview-device", (deviceId) =>
      setRecordingOptions((options) =>
        options.cameraDevice === (deviceId || null)
          ? options
          : { ...options, cameraDevice: deviceId || null },
      ),
    );
    void register<string>("camera-preview-error", (message) => {
      setCameraPreviewError(message);
      setError(message);
    });
    void register<{ seconds: number }>("recording-time", (event) =>
      setElapsed(event.seconds),
    );
    void register<Media>("recording-finished", (m) => {
      setRecordWebcam(false);
      load(m);
    });
    void register<{ progress: number }>("export-progress", (e) =>
      setProgress(e.progress),
    );
    void register<{ path: string }>("export-finished", (e) => {
      setOperation("idle");
      setNotice(`Exportação concluída: ${e.path}`);
      setProgress(100);
    });
    void register("project-open-request", () => {
      if (operationRef.current !== "idle") return;
      void invoke<{ media: Media; project: Project; path: string } | null>(
        "take_pending_project",
      )
        .then((result) => {
          if (result) {
            load(result.media, result.project, result.path);
            if ("recovered" in result && result.recovered)
              setNotice(
                "Projeto recuperado do backup. O manifesto danificado foi preservado no pacote.",
              );
          }
        })
        .catch((e) => setError(String(e)));
    });
    void register<string>("operation-error", (message) => {
      setOperation("idle");
      setError(message);
    });
    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
    };
  }, [desktop, load, media, edit, projectRef, operationRef]);
  return load;
}
