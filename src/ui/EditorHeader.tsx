import type { Dispatch, SetStateAction } from "react";
import { defaults, type Appearance } from "../zoom";
import { storedAppearance } from "../editor/project-utils";
import { AppIcon } from "./AppIcon";

type EditorHeaderProps = {
  desktop: boolean;
  busy: boolean;
  recents: string[];
  projectName?: string;
  projectPath: string | null;
  hasProject: boolean;
  isWindows: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoShortcut: string;
  presetsOpen: boolean;
  setPresetsOpen: Dispatch<SetStateAction<boolean>>;
  importVideo: () => void | Promise<void>;
  openProject: () => void | Promise<void>;
  openRecent: (path: string) => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  appearance: (patch: Partial<Appearance>) => void;
  saveProject: (saveAs?: boolean) => void | Promise<void>;
  onOpenExport: () => void;
};

export function EditorHeader({
  desktop,
  busy,
  recents,
  projectName,
  projectPath,
  hasProject,
  isWindows: windowsDesktop,
  canUndo,
  canRedo,
  undoShortcut,
  presetsOpen,
  setPresetsOpen,
  importVideo,
  openProject,
  openRecent,
  undo,
  redo,
  appearance,
  saveProject,
  onOpenExport,
}: EditorHeaderProps) {
  return (
    <header className="editor-header">
      <div className="header-left">
        <span className="brand-mark">▰</span>
        <strong>Frame Studio</strong>
        <button
          onClick={() => void importVideo()}
          disabled={!desktop || busy}
          title="Importar vídeo"
          aria-label="Importar vídeo"
        >
          <AppIcon name="folder" />
        </button>
        <button onClick={() => void openProject()} disabled={!desktop || busy}>
          Abrir projeto
        </button>
        {!!recents.length && (
          <select
            aria-label="Projetos recentes"
            value=""
            disabled={busy}
            onChange={(event) => void openRecent(event.target.value)}
          >
            <option value="" disabled>
              Recentes
            </option>
            {recents.map((path) => (
              <option key={path} value={path}>
                {path.split(/[/\\]/).pop()}
              </option>
            ))}
          </select>
        )}
      </div>
      <span className="project-name">
        {projectName || "Novo projeto"}
        <small>
          {projectPath
            ? ".framestudio · salvo neste computador"
            : hasProject
              ? "· ainda não salvo"
              : `Local · ${windowsDesktop ? "Windows" : "macOS"}`}
        </small>
      </span>
      <div className="header-actions">
        <button
          disabled={!canUndo || busy}
          onClick={undo}
          title={`Desfazer ${undoShortcut}`}
          aria-label="Desfazer"
        >
          ↶
        </button>
        <button
          disabled={!canRedo || busy}
          onClick={redo}
          title={`Refazer ${windowsDesktop ? "Ctrl+Shift+Z" : "⇧⌘Z"}`}
          aria-label="Refazer"
        >
          ↷
        </button>
        <span className="divider" />
        <div className="preset-control">
          <button
            disabled={!hasProject || busy}
            aria-expanded={presetsOpen}
            onClick={() => setPresetsOpen(!presetsOpen)}
          >
            <AppIcon name="settings" />
            Presets⌄
          </button>
          {presetsOpen && (
            <>
              <button
                className="menu-dismiss"
                aria-label="Fechar presets"
                onClick={() => setPresetsOpen(false)}
              />
              <div className="preset-menu">
                {[
                  {
                    name: "Estúdio",
                    description: "Violeta · movimento suave",
                    value: { ...defaults, cursorSmooth: true },
                  },
                  {
                    name: "Foco",
                    description: "Grafite · enquadramento próximo",
                    value: {
                      ...defaults,
                      background: 4,
                      padding: 4,
                      radius: 8,
                      shadow: 25,
                      smooth: false,
                      cursorSmooth: true,
                    },
                  },
                  {
                    name: "Cinema",
                    description: "Oceano · 16:9 · margem ampla",
                    value: {
                      ...defaults,
                      background: 1,
                      padding: 14,
                      radius: 18,
                      shadow: 55,
                      aspect: "16:9",
                      cursorSmooth: true,
                    },
                  },
                ].map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      appearance({
                        ...preset.value,
                        colors: undefined,
                        backgroundMode: "gradient",
                        wallpaper: undefined,
                        cursorAsset: undefined,
                        cursorMotion: undefined,
                        cameraSpring: false,
                        backgroundBlur: 0,
                        motionBlur: undefined,
                      });
                      setPresetsOpen(false);
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
                <button
                  onClick={() => {
                    appearance(storedAppearance());
                    setPresetsOpen(false);
                  }}
                >
                  Meu padrão salvo
                </button>
              </div>
            </>
          )}
        </div>
        <button
          disabled={!hasProject || busy}
          onClick={() => void saveProject(true)}
          title="Criar uma cópia independente do projeto"
        >
          Salvar como
        </button>
        <button
          disabled={!hasProject || busy}
          onClick={() => void saveProject()}
        >
          <AppIcon name="save" />
          Salvar
        </button>
        <button
          className="export-button"
          disabled={!hasProject || busy}
          onClick={onOpenExport}
        >
          <AppIcon name="export" />
          Exportar
        </button>
      </div>
    </header>
  );
}
