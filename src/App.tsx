import "./App.css";
import "./webcam.css";
import "./timeline.css";
import "./styles/studio.css";
import "./recorder/recorder.css";
import { useEditorController } from "./editor/useEditorController";
import { EditorView } from "./editor/EditorView";
import { LazyMotion, MotionConfig } from "motion/react";

const loadMotionFeatures = () =>
  import("./ui/motion-features").then((module) => module.default);

export default function App() {
  const editor = useEditorController();
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <EditorView {...editor} />
      </MotionConfig>
    </LazyMotion>
  );
}
