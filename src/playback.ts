/** Pausing or replacing a source cancels an in-flight play request. */
export function playbackInterrupted(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && error.name === "AbortError";
}

export async function playMedia(
  media: Pick<HTMLMediaElement, "play"> | null,
  reportError: (error: unknown) => void,
): Promise<void> {
  if (!media) return;
  try {
    await media.play();
  } catch (error) {
    if (!playbackInterrupted(error)) reportError(error);
  }
}
