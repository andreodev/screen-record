import type { ComponentProps } from "react";
import { EditorHeader } from "../ui/EditorHeader";
import { PreviewWorkspace } from "../ui/PreviewWorkspace";
import { ToolRail } from "../ui/ToolRail";
import { EditorInspector } from "../ui/EditorInspector";
import { EditorTimeline } from "../ui/EditorTimeline";
import { EditorDialogs } from "../ui/EditorDialogs";
import { EditorStatus } from "../ui/EditorStatus";
import { RecorderLauncher } from "../recorder/RecorderLauncher";
import type { WorkspaceMode } from "../recorder/useWorkspaceFlow";

export type EditorViewProps = {
  mode: WorkspaceMode;
  recorder: ComponentProps<typeof RecorderLauncher>;
  header: ComponentProps<typeof EditorHeader>;
  preview: ComponentProps<typeof PreviewWorkspace>;
  tools: ComponentProps<typeof ToolRail>;
  inspector: ComponentProps<typeof EditorInspector>;
  timeline: ComponentProps<typeof EditorTimeline>;
  dialogs: ComponentProps<typeof EditorDialogs>;
  status: ComponentProps<typeof EditorStatus>;
};

export function EditorView({
  mode,
  recorder,
  header,
  preview,
  tools,
  inspector,
  timeline,
  dialogs,
  status,
}: EditorViewProps) {
  if (mode === "recorder") return <RecorderLauncher {...recorder} />;
  return (
    <main className="editor">
      <EditorDialogs {...dialogs} />
      <EditorHeader {...header} />
      <div className="editor-body">
        <PreviewWorkspace {...preview} />
        <ToolRail {...tools} />
        <EditorInspector {...inspector} />
      </div>
      <EditorTimeline {...timeline} />
      <EditorStatus {...status} />
    </main>
  );
}
