import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Media, Operation } from "./types";
import type { EditorViewProps } from "./EditorView";
import { usePreviewModel } from "./usePreviewModel";
import { usePreviewSession } from "./usePreviewSession";
import { useStudioAssets } from "./useStudioAssets";
import { useProjectRecovery } from "./useProjectRecovery";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useTimelineCommands } from "./useTimelineCommands";
import { useCaptureSetup } from "./useCaptureSetup";
import { useProjectHistory } from "./useProjectHistory";
import { useEditorSelection } from "./useEditorSelection";
import { usePacingAnalysis } from "./usePacingAnalysis";
import { useExportSettings } from "./useExportSettings";
import { useNativeAction } from "./useNativeAction";
import { useProjectFiles } from "./useProjectFiles";
import { createRecordingOperations } from "./recordingOperations";
import { createVideoExport } from "./videoExport";
import { createEditorMutations } from "./editorMutations";
import { createEditorInteractions } from "./editorInteractions";
import { usePreviewRenderer } from "./usePreviewRenderer";
import { usePlaybackControls } from "./usePlaybackControls";
import { createMediaTools } from "./mediaTools";
import { useWorkspaceFlow } from "../recorder/useWorkspaceFlow";

const windowsDesktop = navigator.userAgent.includes("Windows");
const undoShortcut = windowsDesktop ? "Ctrl+Z" : "⌘Z";

export function useEditorController(): EditorViewProps {
  const [media, setMedia] = useState<Media | null>(null);
  const [operation, setOperation] = useState<Operation>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [projectPath, setProjectPath] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const desktop = isTauri();
  const busy = operation !== "idle";
  const flow = useWorkspaceFlow(desktop, operation, setError);
  const history = useProjectHistory(operation);
  const selection = useEditorSelection();
  const pacing = usePacingAnalysis(media?.path);
  const capture = useCaptureSetup({ desktop, busy, setError });
  const settings = useExportSettings();
  const session = usePreviewSession(selection.panel, media, flow.mode);
  const common = {
    project: history.project,
    media,
    desktop,
    busy,
    operation,
    setOperation,
    setError,
    setNotice,
  };
  const model = usePreviewModel({ ...common, ...selection, ...session });
  const assets = useStudioAssets(model.look, desktop, setError);
  const action = useNativeAction(setError, setOperation);
  const load = useProjectLifecycle({
    ...common,
    ...history,
    ...selection,
    ...session,
    ...capture,
    setMedia,
    setProjectPath,
    setWallpaperGroup: assets.setWallpaperGroup,
    setElapsed,
    setProgress,
    onLoaded: flow.showEditor,
  });
  const { draw } = usePreviewRenderer({
    ...common,
    ...history,
    ...selection,
    ...session,
    ...model,
    assetRoot: assets.assetRoot,
  });
  useProjectRecovery({ ...common, projectPath, load });
  const { seek, togglePlay, changeRate } = usePlaybackControls({
    ...common,
    ...history,
    ...session,
    draw,
  });
  const mutations = createEditorMutations({
    ...common,
    ...history,
    ...selection,
    ...session,
    ...model,
    seek,
  });
  const tools = createMediaTools({
    ...common,
    ...session,
    ...selection,
    ...pacing,
    ...model,
    action,
    edit: history.edit,
    seek,
  });
  const files = useProjectFiles({
    ...common,
    ...history,
    ...session,
    action,
    load,
    setMedia,
    setProjectPath,
  });
  const recording = createRecordingOperations({
    ...common,
    ...history,
    ...session,
    ...capture,
    action,
    setElapsed,
    prepareWindow: flow.prepareRecording,
  });
  const exportVideo = createVideoExport({
    ...common,
    ...model,
    video: session.video,
    action,
    codec: settings.exportCodec,
    quality: settings.exportQuality,
    resolution: settings.exportResolution,
    fps: settings.exportFps,
    setProgress,
  });
  const undo = useCallback(() => {
    if (!history.undo()) return;
    selection.setSelected(null);
    selection.setSelectedClip(null);
    selection.setSelectedEffect(null);
  }, [
    history.undo,
    selection.setSelected,
    selection.setSelectedClip,
    selection.setSelectedEffect,
  ]);
  const redo = useCallback(() => {
    if (!history.redo()) return;
    selection.setSelected(null);
    selection.setSelectedClip(null);
    selection.setSelectedEffect(null);
  }, [
    history.redo,
    selection.setSelected,
    selection.setSelectedClip,
    selection.setSelectedEffect,
  ]);
  const timeline = useTimelineCommands({
    ...history,
    ...selection,
    ...model,
    ...session,
    toggleWebcamKeyframe: mutations.toggleWebcamKeyframe,
    draw,
    togglePlay,
    undo,
    redo,
    seek,
    setNotice,
    undoShortcut,
  });
  const interactions = createEditorInteractions({
    ...common,
    ...history,
    ...selection,
    ...session,
    ...model,
    seek,
  });
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void invoke<string[]>("recent_projects")
      .then((paths) => {
        if (active) setRecents(paths);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [desktop, projectPath]);
  return {
    mode: flow.mode,
    recorder: {
      desktop,
      operation,
      error,
      permissionDenied: capture.capturePermissionDenied,
      hasProject: !!history.project,
      returnToEditor: flow.showEditor,
      record: recording.record,
      importVideo: files.importVideo,
      openProject: files.openProject,
      recordWebcam: capture.recordWebcam,
      setRecordWebcam: capture.setRecordWebcam,
      recordMicrophone: capture.recordMicrophone,
      setRecordMicrophone: capture.setRecordMicrophone,
      recordSystemAudio: capture.recordSystemAudio,
      setRecordSystemAudio: capture.setRecordSystemAudio,
      recordingOptions: capture.recordingOptions,
      setRecordingOptions: capture.setRecordingOptions,
      recordingDevices: capture.recordingDevices,
      devicesLoading: capture.devicesLoading,
      devicesError: capture.devicesError,
      refreshDevices: capture.refreshDevices,
      openPermissions: () => {
        void action("open_screen_recording_settings");
      },
      windowAction: flow.windowAction,
    },
    dialogs: {
      exportSettings: {
        dialogRef: settings.exportDialog,
        appearance: model.look,
        media: media,
        sourceCrop: model.sourceCrop,
        resolution: settings.exportResolution,
        setResolution: settings.setExportResolution,
        codec: settings.exportCodec,
        setCodec: settings.setExportCodec,
        codecLabels: settings.exportCodecLabels,
        quality: settings.exportQuality,
        setQuality: settings.setExportQuality,
        fps: settings.exportFps,
        setFps: settings.setExportFps,
        busy: busy,
        hasProject: Boolean(history.project),
        onExport: exportVideo,
      },
      cropOpen: capture.cropOpen,
      media,
      video: session.video,
      time: session.time,
      appearance: model.look,
      closeCrop: () => capture.setCropOpen(false),
      changeAppearance: mutations.appearance,
    },
    header: {
      desktop: desktop,
      busy: busy,
      recents: recents,
      projectName: history.project?.name,
      projectPath: projectPath,
      hasProject: Boolean(history.project),
      isWindows: windowsDesktop,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undoShortcut: undoShortcut,
      presetsOpen: presetsOpen,
      setPresetsOpen: setPresetsOpen,
      importVideo: files.importVideo,
      openProject: files.openProject,
      openRecent: files.openRecent,
      undo: undo,
      redo: redo,
      appearance: mutations.appearance,
      saveProject: files.saveProject,
      onOpenExport: () => {
        session.video.current?.pause();
        settings.exportDialog.current?.showModal();
      },
    },
    preview: {
      toolbar: {
        look: model.look,
        project: history.project,
        busy: busy,
        appearance: mutations.appearance,
        cropFill: model.cropFill,
        video: session.video,
        setCropOpen: capture.setCropOpen,
        reelMode: session.reelMode,
        setReelMode: session.setReelMode,
        visibleSpanX: model.visibleSpanX,
        visibleSpanY: model.visibleSpanY,
        followCropCursor: model.followCropCursor,
        media: media,
        previewQuality: session.previewQuality,
        setPreviewQuality: session.setPreviewQuality,
        previewScale: session.previewScale,
        setPreviewScale: session.setPreviewScale,
        recordWebcam: capture.recordWebcam,
        desktop: desktop,
        setRecordWebcam: capture.setRecordWebcam,
        setPanel: selection.setPanel,
        recordMicrophone: capture.recordMicrophone,
        setRecordMicrophone: capture.setRecordMicrophone,
        recordSystemAudio: capture.recordSystemAudio,
        setRecordSystemAudio: capture.setRecordSystemAudio,
        onNewRecording: () => {
          session.video.current?.pause();
          flow.showRecorder();
        },
      },
      stage: {
        previewArea: session.previewArea,
        scene: session.scene,
        reelMode: session.reelMode,
        size: model.size,
        previewScale: session.previewScale,
        visibleEffects: model.visibleEffects,
        selectedEffect: selection.selectedEffect,
        sceneAspect: model.sceneAspect,
        setSelectedEffect: selection.setSelectedEffect,
        setSelected: selection.setSelected,
        setSelectedClip: selection.setSelectedClip,
        setPanel: selection.setPanel,
        edit: history.edit,
        dragEffect: interactions.dragEffect,
        backgroundStyle: assets.backgroundStyle,
        look: model.look,
        videoBackground: session.videoBackground,
        media: media,
        motionCanvas: session.motionCanvas,
        videoViewport: session.videoViewport,
        vw: model.vw,
        vh: model.vh,
        panel: selection.panel,
        currentZoom: model.currentZoom,
        busy: busy,
        zoomChange: mutations.zoomChange,
        sourceCrop: model.sourceCrop,
        plane: session.plane,
        video: session.video,
        rate: session.rate,
        seek: seek,
        pendingSeek: session.pendingSeek,
        draw: draw,
        setPlaying: session.setPlaying,
        projectRef: history.projectRef,
        webcamVideo: session.webcamVideo,
        setError: setError,
        microphoneAudio: session.microphoneAudio,
        audio: session.audio,
        project: history.project,
        time: session.time,
        clickSoundAudio: session.clickSoundAudio,
        assetURL: assets.assetURL,
        qualityCanvas: session.qualityCanvas,
        clickRing: session.clickRing,
        cursor: session.cursor,
        canEditCursor: model.canEditCursor,
        selectedCursor: model.selectedCursor,
        sourceAspect: model.sourceAspect,
        focusMarker: session.focusMarker,
        dragFocus: interactions.dragFocus,
        currentWebcam: model.currentWebcam,
        overlayFrame: model.overlayFrame,
        webcamContainer: session.webcamContainer,
        dragWebcam: interactions.dragWebcam,
        webcamVisual: session.webcamVisual,
        webcamSourceAspect: session.webcamSourceAspect,
        setWebcamSourceAspect: session.setWebcamSourceAspect,
        webcamChange: mutations.webcamChange,
        desktop: desktop,
        importVideo: files.importVideo,
        operation: operation,
        elapsed: elapsed,
        captureQuality: capture.captureQuality,
        recordSystemAudio: capture.recordSystemAudio,
        recordMicrophone: capture.recordMicrophone,
        stop: recording.stop,
      },
      transport: {
        currentTime: model.editedTime,
        duration: model.duration,
        playing: session.playing,
        disabled: !media || busy,
        rate: session.rate,
        onStart: () => seek(model.ranges[0]?.start || 0),
        onTogglePlay: togglePlay,
        onEnd: () => seek(model.ranges[model.ranges.length - 1]?.end || 0),
        onRateChange: changeRate,
      },
    },
    tools: {
      active: selection.panel,
      onChange: selection.setPanel,
    },
    inspector: {
      active: selection.panel,
      inspectorRef: session.inspector,
      disabled:
        busy ||
        (!history.project &&
          selection.panel !== "audio" &&
          selection.panel !== "webcam"),
      panels: {
        background: {
          appearance: mutations.appearance,
          look: model.look,
          wallpaperGroup: assets.wallpaperGroup,
          setWallpaperGroup: assets.setWallpaperGroup,
          assetRoot: assets.assetRoot,
          assetURL: assets.assetURL,
          palette: assets.palette,
          setNotice: setNotice,
          setError: setError,
        },
        zoom: {
          cameraMode: model.cameraMode,
          setCameraMode: mutations.setCameraMode,
          look: model.look,
          appearance: mutations.appearance,
          media: media,
          edit: history.edit,
          setSelected: selection.setSelected,
          addZoom: interactions.addZoom,
          currentZoom: model.currentZoom,
          zoomChange: mutations.zoomChange,
          selected: selection.selected,
        },
        cursor: {
          canEditCursor: model.canEditCursor,
          openProject: files.openProject,
          busy: busy,
          look: model.look,
          appearance: mutations.appearance,
          assetURL: assets.assetURL,
          events: model.events,
          cursorSmooth: model.cursorSmooth,
          media: media,
        },
        animations: {
          look: model.look,
          appearance: mutations.appearance,
          time: session.time,
          canEditCursor: model.canEditCursor,
          seek: seek,
          media: media,
        },
        webcam: {
          desktop: desktop,
          recordingOptions: capture.recordingOptions,
          recordingDevices: capture.recordingDevices,
          busy: busy,
          devicesLoading: capture.devicesLoading,
          setRecordingOptions: capture.setRecordingOptions,
          refreshDevices: capture.refreshDevices,
          devicesError: capture.devicesError,
          recordWebcam: capture.recordWebcam,
          cameraPreviewError: capture.cameraPreviewError,
          project: history.project,
          currentWebcam: model.currentWebcam,
          webcamChange: mutations.webcamChange,
          selectedWebcam: model.selectedWebcam,
          webcamKeyed: model.webcamKeyed,
          toggleWebcamKeyframe: mutations.toggleWebcamKeyframe,
          time: session.time,
          retimeWebcamKeyframe: mutations.retimeWebcamKeyframe,
          webcamKeyTimeDraft: session.webcamKeyTimeDraft,
          setWebcamKeyTimeDraft: session.setWebcamKeyTimeDraft,
          seek: seek,
          webcamClipboard: session.webcamClipboard,
          setWebcamClipboard: session.setWebcamClipboard,
          edit: history.edit,
          setRecordWebcam: capture.setRecordWebcam,
        },
        pacing: {
          analyzing: pacing.analyzing,
          media: media,
          project: history.project,
          analysis: pacing.analysis,
          suggestions: pacing.suggestions,
          includedSuggestions: pacing.includedSuggestions,
          setIncludedSuggestions: pacing.setIncludedSuggestions,
          suggestPacing: tools.suggestPacing,
          seek: seek,
          applyPacing: tools.applyPacing,
        },
        audio: {
          busy: busy,
          recordMicrophone: capture.recordMicrophone,
          setRecordMicrophone: capture.setRecordMicrophone,
          windowsDesktop: windowsDesktop,
          recordingOptions: capture.recordingOptions,
          recordingDevices: capture.recordingDevices,
          devicesLoading: capture.devicesLoading,
          setRecordingOptions: capture.setRecordingOptions,
          recordSystemAudio: capture.recordSystemAudio,
          setRecordSystemAudio: capture.setRecordSystemAudio,
          refreshDevices: capture.refreshDevices,
          devicesError: capture.devicesError,
          microphonePreset: capture.microphonePreset,
          microphoneProcessing: capture.microphoneProcessing,
          updateMicrophoneProcessing: capture.updateMicrophoneProcessing,
          action: action,
          project: history.project,
          media: media,
          edit: history.edit,
          look: model.look,
          canEditCursor: model.canEditCursor,
          appearance: mutations.appearance,
          setClickSoundVolume: mutations.setClickSoundVolume,
          setBackgroundVolume: tools.setBackgroundVolume,
          chooseBackgroundAudio: tools.chooseBackgroundAudio,
        },
        effect: {
          currentEffect: model.currentEffect,
          importSubtitles: tools.importSubtitles,
          addEffect: interactions.addEffect,
          effectChange: mutations.effectChange,
          media: media,
        },
        clip: {
          currentClip: model.currentClip,
          selectedClip: selection.selectedClip,
          clipChange: mutations.clipChange,
          canEditCursor: model.canEditCursor,
        },
      },
      range: {
        project: history.project,
        media,
        changeTrim: mutations.changeTrim,
        seek,
      },
    },
    timeline: {
      project: history.project,
      projectRef: history.projectRef,
      media: media,
      busy: busy,
      duration: model.duration,
      time: session.time,
      ranges: model.ranges,
      isWindows: windowsDesktop,
      selectedZoom: selection.selected,
      selectedClip: selection.selectedClip,
      selectedEffect: selection.selectedEffect,
      selectedWebcam: model.selectedWebcam,
      webcamKeyed: model.webcamKeyed,
      splitAtPlayhead: timeline.splitAtPlayhead,
      addEffect: interactions.addEffect,
      deleteSelection: timeline.deleteSelection,
      edit: history.edit,
      setSelectedZoom: selection.setSelected,
      setSelectedClip: selection.setSelectedClip,
      setSelectedEffect: selection.setSelectedEffect,
      setPanel: selection.setPanel,
      seek: seek,
      toggleWebcamKeyframe: mutations.toggleWebcamKeyframe,
      addZoom: interactions.addZoom,
      dragZoom: interactions.dragZoom,
      dragEffectTiming: interactions.dragEffectTiming,
    },
    status: {
      error,
      notice,
      desktop,
      operation,
      progress,
      capturePermissionDenied: capture.capturePermissionDenied,
      windowsDesktop,
      revealDisabled: !desktop || busy || !media,
      onStop: recording.stop,
      onPermissions: () => {
        void action("open_screen_recording_settings");
      },
      onReveal: () => {
        void action("reveal_clip");
      },
    },
  };
}
