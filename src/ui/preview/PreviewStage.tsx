import type { PreviewBindings } from "./types";
import { canvasEffect } from "../../annotations";
import { cursorDimensions, cursorImage } from "../../cursor";
import { EffectOverlay } from "../../EffectOverlay";
import { clamp } from "../../zoom";
import { PreviewMedia } from "./PreviewMedia";
import { WebcamOverlay } from "./WebcamOverlay";
import { EmptyPreview, RecordingOverlay } from "../PreviewStates";

export type PreviewStageProps = Pick<
  PreviewBindings,
  | "previewArea"
  | "scene"
  | "reelMode"
  | "size"
  | "previewScale"
  | "visibleEffects"
  | "selectedEffect"
  | "sceneAspect"
  | "setSelectedEffect"
  | "setSelected"
  | "setSelectedClip"
  | "setPanel"
  | "edit"
  | "dragEffect"
  | "backgroundStyle"
  | "look"
  | "videoBackground"
  | "media"
  | "motionCanvas"
  | "videoViewport"
  | "vw"
  | "vh"
  | "panel"
  | "currentZoom"
  | "busy"
  | "zoomChange"
  | "sourceCrop"
  | "plane"
  | "video"
  | "rate"
  | "seek"
  | "pendingSeek"
  | "draw"
  | "setPlaying"
  | "projectRef"
  | "webcamVideo"
  | "setError"
  | "microphoneAudio"
  | "audio"
  | "project"
  | "time"
  | "clickSoundAudio"
  | "assetURL"
  | "qualityCanvas"
  | "clickRing"
  | "cursor"
  | "canEditCursor"
  | "selectedCursor"
  | "sourceAspect"
  | "focusMarker"
  | "dragFocus"
  | "currentWebcam"
  | "overlayFrame"
  | "webcamContainer"
  | "dragWebcam"
  | "webcamVisual"
  | "webcamSourceAspect"
  | "setWebcamSourceAspect"
  | "webcamChange"
  | "desktop"
  | "importVideo"
  | "operation"
  | "elapsed"
  | "captureQuality"
  | "recordSystemAudio"
  | "recordMicrophone"
  | "stop"
>;

export function PreviewStage({
  previewArea,
  scene,
  reelMode,
  size,
  previewScale,
  visibleEffects,
  selectedEffect,
  sceneAspect,
  setSelectedEffect,
  setSelected,
  setSelectedClip,
  setPanel,
  edit,
  dragEffect,
  backgroundStyle,
  look,
  videoBackground,
  media,
  motionCanvas,
  videoViewport,
  vw,
  vh,
  panel,
  currentZoom,
  busy,
  zoomChange,
  sourceCrop,
  plane,
  video,
  rate,
  seek,
  pendingSeek,
  draw,
  setPlaying,
  projectRef,
  webcamVideo,
  setError,
  microphoneAudio,
  audio,
  project,
  time,
  clickSoundAudio,
  assetURL,
  qualityCanvas,
  clickRing,
  cursor,
  canEditCursor,
  selectedCursor,
  sourceAspect,
  focusMarker,
  dragFocus,
  currentWebcam,
  overlayFrame,
  webcamContainer,
  dragWebcam,
  webcamVisual,
  webcamSourceAspect,
  setWebcamSourceAspect,
  webcamChange,
  desktop,
  importVideo,
  operation,
  elapsed,
  captureQuality,
  recordSystemAudio,
  recordMicrophone,
  stop,
}: PreviewStageProps) {
  return (
    <div className="preview-area" ref={previewArea}>
      <div
        ref={scene}
        className={`scene${reelMode ? " reel-preview" : ""}`}
        style={
          {
            width: size.width,
            height: size.height,
            transform: `scale(${previewScale})`,
          } as React.CSSProperties
        }
      >
        {visibleEffects
          .filter((effect) => canvasEffect(effect.kind))
          .map((effect) => (
            <EffectOverlay
              key={effect.id}
              effect={effect}
              selected={selectedEffect === effect.id}
              sourceAspect={sceneAspect}
              select={() => {
                setSelectedEffect(effect.id);
                setSelected(null);
                setSelectedClip(null);
                setPanel("effect");
              }}
              change={(patch) =>
                edit((p) => ({
                  ...p,
                  version: 12,
                  effects: p.effects?.map((item) =>
                    item.id === effect.id ? { ...item, ...patch } : item,
                  ),
                }))
              }
              drag={dragEffect}
            />
          ))}
        {reelMode && (
          <div className="reel-ui" aria-hidden="true">
            <div className="reel-top">
              <span>‹</span>
              <strong>Reels</strong>
              <span>◎</span>
            </div>
            <div className="reel-actions">
              <span>
                ♡<small>24,8 mil</small>
              </span>
              <span>
                ◯<small>128</small>
              </span>
              <span>
                ➤<small>97</small>
              </span>
              <span>•••</span>
            </div>
            <div className="reel-bottom">
              <div className="reel-profile">
                <i /> <strong>screencastudio</strong>
                <em>Seguir</em>
              </div>
              <span>Uma gravação de tela, com zoom e movimento.</span>
              <small>♫ Áudio original</small>
            </div>
          </div>
        )}
        <div
          className="scene-background"
          style={{
            background: backgroundStyle,
            filter: `blur(${((look.backgroundBlur || 0) * size.width) / 1920}px)`,
          }}
        />
        <canvas
          className="video-background"
          ref={videoBackground}
          aria-hidden="true"
        />
        {media ? (
          <>
            <canvas
              className="motion-preview"
              ref={motionCanvas}
              hidden
              aria-hidden="true"
            />
            <div
              className="video-viewport"
              ref={videoViewport}
              style={{
                width: vw,
                height: vh,
                left: (size.width - vw) / 2,
                top: (size.height - vh) / 2,
                borderRadius: (look.radius * size.width) / 1000,
                boxShadow: `0 ${(12 * size.width) / 1920}px ${(36 * size.width) / 1920}px rgba(0,0,0,${look.shadow / 100})`,
              }}
              onClick={(e) => {
                if (panel !== "zoom" || !currentZoom || busy) return;
                const rect = e.currentTarget.getBoundingClientRect();
                zoomChange({
                  x:
                    sourceCrop.x +
                    clamp((e.clientX - rect.left) / rect.width, 0, 1) *
                      sourceCrop.width,
                  y:
                    sourceCrop.y +
                    clamp((e.clientY - rect.top) / rect.height, 0, 1) *
                      sourceCrop.height,
                  follow: false,
                });
              }}
            >
              <PreviewMedia
                plane={plane}
                vw={vw}
                sourceCrop={sourceCrop}
                vh={vh}
                video={video}
                media={media}
                rate={rate}
                seek={seek}
                pendingSeek={pendingSeek}
                draw={draw}
                setPlaying={setPlaying}
                projectRef={projectRef}
                webcamVideo={webcamVideo}
                setError={setError}
                microphoneAudio={microphoneAudio}
                audio={audio}
                project={project}
                time={time}
                clickSoundAudio={clickSoundAudio}
                assetURL={assetURL}
                qualityCanvas={qualityCanvas}
              />
              <div
                className="source-overlays"
                style={{
                  width: vw / sourceCrop.width,
                  height: vh / sourceCrop.height,
                  left: (-sourceCrop.x * vw) / sourceCrop.width,
                  top: (-sourceCrop.y * vh) / sourceCrop.height,
                }}
              >
                <div
                  ref={clickRing}
                  className="click-ring"
                  hidden
                  aria-hidden="true"
                />
                <div
                  className="rendered-cursor"
                  ref={cursor}
                  style={{
                    display:
                      canEditCursor && look.cursorSize > 0 ? "block" : "none",
                    ...cursorDimensions(
                      selectedCursor,
                      look.cursorSize,
                      size.width,
                    ),
                  }}
                >
                  <img
                    src={assetURL(cursorImage(look, null).file)}
                    alt=""
                    onLoad={() => draw(video.current?.currentTime ?? time)}
                    style={{
                      transform: `translate(${-selectedCursor.hotspotX * 100}%,${-selectedCursor.hotspotY * 100}%)`,
                    }}
                  />
                </div>
                {visibleEffects
                  .filter((effect) => !canvasEffect(effect.kind))
                  .map((effect) => (
                    <EffectOverlay
                      key={effect.id}
                      effect={effect}
                      selected={selectedEffect === effect.id}
                      sourceAspect={sourceAspect}
                      select={() => {
                        setSelectedEffect(effect.id);
                        setSelected(null);
                        setSelectedClip(null);
                        setPanel("effect");
                      }}
                      change={(patch) =>
                        edit((p) => ({
                          ...p,
                          version: 12,
                          effects: p.effects?.map((item) =>
                            item.id === effect.id
                              ? { ...item, ...patch }
                              : item,
                          ),
                        }))
                      }
                      drag={dragEffect}
                    />
                  ))}
                {panel === "zoom" && currentZoom && !currentZoom.follow && (
                  <button
                    ref={focusMarker}
                    className="zoom-focus"
                    aria-label="Arrastar foco do zoom"
                    title="Arraste para posicionar o foco; use as setas para ajuste fino"
                    disabled={busy}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={dragFocus}
                    onKeyDown={(e) => {
                      const dx =
                          e.key === "ArrowLeft"
                            ? -0.01
                            : e.key === "ArrowRight"
                              ? 0.01
                              : 0,
                        dy =
                          e.key === "ArrowUp"
                            ? -0.01
                            : e.key === "ArrowDown"
                              ? 0.01
                              : 0;
                      if (dx || dy) {
                        e.preventDefault();
                        e.stopPropagation();
                        zoomChange({
                          x: clamp(currentZoom.x + dx, 0, 1),
                          y: clamp(currentZoom.y + dy, 0, 1),
                        });
                      }
                    }}
                  />
                )}
              </div>
            </div>
            {project?.webcam && currentWebcam && overlayFrame && (
              <WebcamOverlay
                webcamContainer={webcamContainer}
                panel={panel}
                overlayFrame={overlayFrame}
                dragWebcam={dragWebcam}
                webcamVisual={webcamVisual}
                currentWebcam={currentWebcam}
                size={size}
                webcamSourceAspect={webcamSourceAspect}
                video={video}
                webcamVideo={webcamVideo}
                project={project}
                setWebcamSourceAspect={setWebcamSourceAspect}
                setError={setError}
                webcamChange={webcamChange}
              />
            )}
          </>
        ) : (
          <EmptyPreview disabled={!desktop || busy} onImport={importVideo} />
        )}
      </div>
      <RecordingOverlay
        operation={operation}
        elapsed={elapsed}
        resolution={captureQuality.resolution}
        fps={captureQuality.fps}
        hasAudio={recordSystemAudio || recordMicrophone}
        onStop={stop}
      />
    </div>
  );
}
