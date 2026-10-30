import { convertFileSrc } from "@tauri-apps/api/core";
import { playMedia } from "../../playback";
import type { PreviewBindings } from "./types";
import { webcamFrameStyle } from "../../webcam";
import { clamp } from "../../zoom";

type WebcamOverlayProps = Pick<
  PreviewBindings,
  | "webcamContainer"
  | "panel"
  | "overlayFrame"
  | "dragWebcam"
  | "webcamVisual"
  | "currentWebcam"
  | "size"
  | "webcamSourceAspect"
  | "video"
  | "webcamVideo"
  | "project"
  | "setWebcamSourceAspect"
  | "setError"
  | "webcamChange"
>;

export function WebcamOverlay({
  webcamContainer,
  panel,
  overlayFrame,
  dragWebcam,
  webcamVisual,
  currentWebcam,
  size,
  webcamSourceAspect,
  video,
  webcamVideo,
  project,
  setWebcamSourceAspect,
  setError,
  webcamChange,
}: WebcamOverlayProps) {
  if (!project?.webcam || !currentWebcam || !overlayFrame) return null;
  return (
    <div
      ref={webcamContainer}
      className={`webcam-frame ${panel === "webcam" ? "editing" : ""}`}
      style={{
        left: overlayFrame.left,
        top: overlayFrame.top,
        width: overlayFrame.width,
        height: overlayFrame.height,
        borderRadius: overlayFrame.radius,
      }}
      onPointerDown={(e) => dragWebcam(e)}
    >
      <div
        ref={webcamVisual}
        className="webcam-visual"
        style={{
          ...webcamFrameStyle(
            currentWebcam,
            size.width,
            size.height,
            webcamSourceAspect,
          ),
          left: undefined,
          top: undefined,
          width: "100%",
          height: "100%",
        }}
      >
        <video
          ref={webcamVideo}
          src={convertFileSrc(project.webcam.path)}
          muted
          playsInline
          preload="auto"
          aria-label="Webcam; arraste para reposicionar"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setWebcamSourceAspect(v.videoWidth / v.videoHeight);
            if (video.current) {
              v.currentTime = video.current.currentTime;
              if (!video.current.paused)
                void playMedia(v, (error) => setError(String(error)));
            }
          }}
        />
      </div>
      {panel === "webcam" && (
        <button
          className="webcam-resize"
          aria-label="Redimensionar webcam"
          title="Arraste para redimensionar"
          onPointerDown={(e) => dragWebcam(e, true)}
          onKeyDown={(e) => {
            if (
              ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              e.stopPropagation();
              webcamChange({
                zoomBehavior: "keep",
                size: clamp(
                  currentWebcam.size +
                    (["ArrowUp", "ArrowRight"].includes(e.key) ? 0.01 : -0.01),
                  0.08,
                  0.6,
                ),
              });
            }
          }}
        />
      )}
    </div>
  );
}
