import { convertFileSrc } from "@tauri-apps/api/core";
import type { ComponentProps, RefObject } from "react";
import { CropDialog } from "../CropDialog";
import type { Appearance } from "../zoom";
import type { Media } from "../editor/types";
import { ExportDialog } from "./ExportDialog";

type EditorDialogsProps = {
  exportSettings: ComponentProps<typeof ExportDialog>;
  cropOpen: boolean;
  media: Media | null;
  video: RefObject<HTMLVideoElement | null>;
  time: number;
  appearance: Appearance;
  closeCrop: () => void;
  changeAppearance: (patch: Partial<Appearance>) => void;
};

export function EditorDialogs({
  exportSettings,
  cropOpen,
  media,
  video,
  time,
  appearance,
  closeCrop,
  changeAppearance,
}: EditorDialogsProps) {
  return (
    <>
      <ExportDialog {...exportSettings} />
      {cropOpen && media && (
        <CropDialog
          src={convertFileSrc(media.path)}
          width={media.width}
          height={media.height}
          time={video.current?.currentTime ?? time}
          initial={appearance.crop}
          close={closeCrop}
          apply={(crop) => {
            changeAppearance({
              crop,
              cropFill: false,
              cropFollowCursor: false,
              aspect: "auto",
            });
            closeCrop();
          }}
        />
      )}
    </>
  );
}
