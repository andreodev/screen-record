/** Verbatim Windows paths (\\?\) require backslashes even for appended files. */
export function assetPath(root: string, file: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return root.replace(/[\\/]+$/, '') + separator + file.replace(/[\\/]/g, separator);
}
