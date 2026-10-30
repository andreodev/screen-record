import type { Clip } from "../timeline";
import { clamp } from "../zoom";
import type { Media, Project } from "../editor/types";

type ExportRangeFieldsProps = {
  project: Project | null;
  media: Media | null;
  changeTrim: (trim: Clip) => void;
  seek: (time: number) => void;
};

export function ExportRangeFields({
  project,
  media,
  changeTrim,
  seek,
}: ExportRangeFieldsProps) {
  return (
    <>
      {project && (
        <>
          <div className="section-line" />
          <h3>Trecho de exportação</h3>
          <div className="time-inputs">
            <label>
              De
              <input
                aria-label="Início do trecho"
                type="number"
                min={0}
                max={project.trim.end - 0.1}
                step={0.1}
                value={Number(project.trim.start.toFixed(2))}
                onChange={(e) => {
                  const start = clamp(
                    Number(e.target.value),
                    0,
                    project.trim.end - 0.1,
                  );
                  changeTrim({ ...project.trim, start });
                  seek(start);
                }}
              />
            </label>
            <label>
              Até
              <input
                aria-label="Fim do trecho"
                type="number"
                min={project.trim.start + 0.1}
                max={media?.duration}
                step={0.1}
                value={Number(project.trim.end.toFixed(2))}
                onChange={(e) =>
                  changeTrim({
                    ...project.trim,
                    end: clamp(
                      Number(e.target.value),
                      project.trim.start + 0.1,
                      media?.duration || 1,
                    ),
                  })
                }
              />
            </label>
          </div>
        </>
      )}
    </>
  );
}
