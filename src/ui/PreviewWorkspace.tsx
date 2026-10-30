import type { ComponentProps } from "react";
import { EditorTransport } from "./EditorTransport";
import {
  PreviewToolbar,
  type PreviewToolbarProps,
} from "./preview/PreviewToolbar";
import { PreviewStage, type PreviewStageProps } from "./preview/PreviewStage";

export type PreviewWorkspaceProps = {
  toolbar: PreviewToolbarProps;
  stage: PreviewStageProps;
  transport: ComponentProps<typeof EditorTransport>;
};

export function PreviewWorkspace({
  toolbar,
  stage,
  transport,
}: PreviewWorkspaceProps) {
  return (
    <section className="preview-column">
      <PreviewToolbar {...toolbar} />
      <PreviewStage {...stage} />
      <EditorTransport {...transport} />
    </section>
  );
}
