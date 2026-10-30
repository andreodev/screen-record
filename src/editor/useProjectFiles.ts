import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Media, Operation, Project } from "./types";

type HistoryRef = MutableRefObject<{ past: Project[]; future: Project[] }>;
type NativeAction = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<T | undefined>;

type ProjectFilesOptions = {
  action: NativeAction;
  video: RefObject<HTMLVideoElement | null>;
  load: (media: Media, project?: Project, path?: string) => void;
  project: Project | null;
  projectRef: MutableRefObject<Project | null>;
  histories: HistoryRef;
  pendingSeek: MutableRefObject<number>;
  time: number;
  setOperation: Dispatch<SetStateAction<Operation>>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setPast: Dispatch<SetStateAction<Project[]>>;
  setFuture: Dispatch<SetStateAction<Project[]>>;
  setMedia: Dispatch<SetStateAction<Media | null>>;
  setProjectPath: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useProjectFiles(options: ProjectFilesOptions) {
  const {
    action,
    video,
    load,
    project,
    projectRef,
    histories,
    pendingSeek,
    time,
    setOperation,
    setProject,
    setPast,
    setFuture,
    setMedia,
    setProjectPath,
    setNotice,
  } = options;

  const importVideo = useCallback(async () => {
    video.current?.pause();
    setOperation("opening");
    const media = await action<Media | null>("import_video");
    if (media) load(media);
    else setOperation("idle");
  }, [action, load, setOperation, video]);

  const openProject = useCallback(async () => {
    video.current?.pause();
    setOperation("opening");
    const result = await action<{
      media: Media;
      project: Project;
      path: string;
      recovered?: boolean;
    } | null>("open_project");
    if (result) {
      load(result.media, result.project, result.path);
      if (result.recovered)
        setNotice(
          "Projeto recuperado do backup. O manifesto danificado foi preservado no pacote.",
        );
    } else setOperation("idle");
  }, [action, load, setNotice, setOperation, video]);

  const openRecent = useCallback(
    async (path: string) => {
      video.current?.pause();
      setOperation("opening");
      const result = await action<{
        media: Media;
        project: Project;
        path: string;
        recovered?: boolean;
      }>("open_recent_project", { path });
      if (result) {
        load(result.media, result.project, result.path);
        if (result.recovered)
          setNotice(
            "Projeto recuperado do backup. O manifesto danificado foi preservado no pacote.",
          );
      } else setOperation("idle");
    },
    [action, load, setNotice, setOperation, video],
  );

  const saveProject = useCallback(
    async (saveAs = false) => {
      if (!project) return;
      video.current?.pause();
      setOperation("saving");
      const result = await action<{ path: string; media: Media } | null>(
        "save_project",
        { project, saveAs },
      );
      setOperation("idle");
      if (!result) return;
      pendingSeek.current = time;
      const rewrite = (value: Project): Project => ({
        ...value,
        version: value.effects?.length ? 5 : 4,
        mediaPath: result.media.path,
        microphone:
          value.microphone && result.media.microphonePath
            ? { ...value.microphone, path: result.media.microphonePath }
            : value.microphone,
      });
      const next = rewrite(projectRef.current!);
      projectRef.current = next;
      setProject(next);
      histories.current = {
        past: histories.current.past.map(rewrite),
        future: histories.current.future.map(rewrite),
      };
      setPast(histories.current.past);
      setFuture(histories.current.future);
      setMedia(result.media);
      setProjectPath(result.path);
      setNotice(`Projeto salvo com mídia incluída: ${result.path}`);
    },
    [
      action,
      histories,
      pendingSeek,
      project,
      projectRef,
      setFuture,
      setMedia,
      setNotice,
      setOperation,
      setPast,
      setProject,
      setProjectPath,
      time,
      video,
    ],
  );

  return { importVideo, openProject, openRecent, saveProject };
}
