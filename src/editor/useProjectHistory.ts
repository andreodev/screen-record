import { useCallback, useRef, useState } from "react";
import type { Operation, Project } from "./types";

export function useProjectHistory(operation: Operation) {
  const [project, setProject] = useState<Project | null>(null);
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const histories = useRef<{ past: Project[]; future: Project[] }>({
    past: [],
    future: [],
  });
  const projectRef = useRef<Project | null>(project);
  projectRef.current = project;
  const operationRef = useRef(operation);
  operationRef.current = operation;

  const edit = useCallback((update: (project: Project) => Project) => {
    const current = projectRef.current;
    if (!current || operationRef.current !== "idle") return;
    histories.current = {
      past: [...histories.current.past.slice(-49), current],
      future: [],
    };
    setPast(histories.current.past);
    setFuture([]);
    const next = update(current);
    projectRef.current = next;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const history = histories.current;
    const previous = history.past.at(-1);
    if (!previous) return;
    histories.current = {
      past: history.past.slice(0, -1),
      future: [projectRef.current, ...history.future],
    };
    setPast(histories.current.past);
    setFuture(histories.current.future);
    projectRef.current = previous;
    setProject(previous);
    return true;
  }, []);

  const redo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const history = histories.current;
    const next = history.future[0];
    if (!next) return;
    histories.current = {
      past: [...history.past, projectRef.current],
      future: history.future.slice(1),
    };
    setPast(histories.current.past);
    setFuture(histories.current.future);
    projectRef.current = next;
    setProject(next);
    return true;
  }, []);

  return {
    project,
    setProject,
    projectRef,
    past,
    setPast,
    future,
    setFuture,
    histories,
    operationRef,
    edit,
    undo,
    redo,
  };
}
