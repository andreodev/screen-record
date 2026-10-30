import { useCallback, useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { assetPath } from "../asset-path";
import { backgrounds, clamp, type Appearance } from "../zoom";
import assetCatalog from "../studio-assets.json";

export function useStudioAssets(
  look: Appearance,
  desktop: boolean,
  setError: (message: string) => void,
) {
  const [assetRoot, setAssetRoot] = useState("");
  const [wallpaperGroup, setWallpaperGroup] = useState("macOS");
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void invoke<string>("studio_asset_root")
      .then((root) => {
        if (active) setAssetRoot(root);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [desktop, setError]);
  const assetURL = useCallback(
    (file: string) =>
      assetRoot ? convertFileSrc(assetPath(assetRoot, file)) : undefined,
    [assetRoot],
  );
  const palette =
    look.colors ||
    backgrounds[clamp(look.background, 0, backgrounds.length - 1)];
  const wallpaper = assetCatalog.wallpapers.find(
    (item) => item.id === look.wallpaper,
  );
  const backgroundStyle =
    look.backgroundMode === "wallpaper" && wallpaper && assetRoot
      ? `url("${assetURL(wallpaper.file)}") center / cover`
      : look.backgroundMode === "color"
        ? palette[0]
        : `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`;
  return {
    assetRoot,
    wallpaperGroup,
    setWallpaperGroup,
    assetURL,
    palette,
    backgroundStyle,
  };
}
