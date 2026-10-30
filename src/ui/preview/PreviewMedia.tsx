import { convertFileSrc } from "@tauri-apps/api/core";
import { playMedia } from "../../playback";
import type { PreviewBindings } from "./types";
import { clipRanges, sourceToEdited } from "../../timeline";

type PreviewMediaProps = Pick<
  PreviewBindings,
  | "plane"
  | "vw"
  | "sourceCrop"
  | "vh"
  | "video"
  | "media"
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
>;

export function PreviewMedia({
  plane,
  vw,
  sourceCrop,
  vh,
  video,
  media,
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
}: PreviewMediaProps) {
  if (!media) return null;
  return (
    <div
      className="media-plane"
      ref={plane}
      style={{
        width: vw / sourceCrop.width,
        height: vh / sourceCrop.height,
        left: (-sourceCrop.x * vw) / sourceCrop.width,
        top: (-sourceCrop.y * vh) / sourceCrop.height,
      }}
    >
      <video
        ref={video}
        src={convertFileSrc(media.path)}
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          if (video.current) video.current.playbackRate = rate;
          seek(pendingSeek.current);
        }}
        onLoadedData={() => draw(video.current?.currentTime ?? 0)}
        onPlay={(event) => {
          if (event.currentTarget.paused) return;
          setPlaying(true);
          if (projectRef.current?.webcam)
            void playMedia(webcamVideo.current, (e) => setError(String(e)));
          if (projectRef.current?.microphone)
            void playMedia(microphoneAudio.current, (e) => setError(String(e)));
          if (projectRef.current?.backgroundAudio)
            void playMedia(audio.current, (e) => setError(String(e)));
        }}
        onPause={(event) => {
          if (!event.currentTarget.paused) return;
          setPlaying(false);
          audio.current?.pause();
          microphoneAudio.current?.pause();
          webcamVideo.current?.pause();
        }}
        onSeeked={() => draw(video.current?.currentTime || 0)}
        onError={() =>
          setError(
            "Não foi possível reproduzir este codec. Tente um vídeo H.264 em MOV ou MP4.",
          )
        }
      />
      <audio
        ref={audio}
        src={
          project?.backgroundAudio
            ? convertFileSrc(project.backgroundAudio.path)
            : undefined
        }
        loop
        preload="metadata"
        hidden
        onLoadedMetadata={(e) => {
          const a = e.currentTarget,
            kept = projectRef.current
              ? clipRanges(projectRef.current.trim, projectRef.current.clips)
              : [];
          if (a.duration)
            a.currentTime =
              sourceToEdited(video.current?.currentTime ?? time, kept) %
              a.duration;
          a.volume = projectRef.current?.backgroundAudio?.volume ?? 0.25;
        }}
      />
      {project?.microphone && (
        <audio
          ref={microphoneAudio}
          src={convertFileSrc(project.microphone.path)}
          preload="auto"
          aria-label="Áudio do microfone"
          onLoadedMetadata={(e) => {
            const voice = e.currentTarget;
            voice.volume = projectRef.current?.microphone?.volume ?? 1;
            if (video.current) {
              voice.currentTime = video.current.currentTime;
              voice.playbackRate = video.current.playbackRate;
            }
          }}
        />
      )}
      <audio
        ref={clickSoundAudio}
        src={assetURL("mouse-click.wav")}
        preload="auto"
        hidden
      />
      <canvas
        className="preview-proxy"
        ref={qualityCanvas}
        hidden
        aria-hidden="true"
      />
    </div>
  );
}
