import type { Operation } from "../editor/types";

type EditorStatusProps = {
  error: string;
  notice: string;
  desktop: boolean;
  operation: Operation;
  progress: number;
  capturePermissionDenied: boolean;
  revealDisabled: boolean;
  windowsDesktop: boolean;
  onStop: () => Promise<void>;
  onPermissions: () => void;
  onReveal: () => void;
};

export function EditorStatus({
  error,
  notice,
  desktop,
  operation,
  progress,
  capturePermissionDenied,
  revealDisabled,
  windowsDesktop,
  onStop,
  onPermissions,
  onReveal,
}: EditorStatusProps) {
  return (
    <footer className="statusbar" role="status" aria-live="polite">
      <span className={error ? "error-text" : ""}>
        {error ||
          notice ||
          (desktop
            ? "Pronto · processamento local"
            : "Abra o desktop Tauri para importar e gravar.")}
      </span>
      {operation === "exporting" ? (
        <div className="export-progress">
          <progress
            max={100}
            value={progress}
            aria-label="Progresso da exportação"
          />
          <span>{progress}%</span>
          <button onClick={() => void onStop()}>Cancelar</button>
        </div>
      ) : capturePermissionDenied ? (
        <button onClick={onPermissions}>Abrir permissões de gravação ↗</button>
      ) : (
        <button onClick={onReveal} disabled={revealDisabled}>
          Mostrar no {windowsDesktop ? "Explorer" : "Finder"} ↗
        </button>
      )}
    </footer>
  );
}
