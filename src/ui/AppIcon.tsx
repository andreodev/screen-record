import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  folder: <path d="M3 7V5h7l2 3h9v12H3V7h18" />,
  zoom: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6M7 10h6M10 7v6" />
    </>
  ),
  cursor: <path d="m5 2 14 12-7 1 4 7-3 1-4-7-4 5Z" />,
  background: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m3 17 6-7 5 5 3-3 4 5" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  pause: <path d="M9 7v10M15 7v10" />,
  export: <path d="M12 16V2m-4 4 4-4 4 4M5 11H3v11h18V11h-2" />,
  record: (
    <>
      <rect x="2" y="3" width="20" height="15" rx="3" />
      <path d="M8 22h8M12 18v4" />
    </>
  ),
  save: <path d="M3 3h15l3 3v15H3ZM7 3v7h10V3M7 21v-7h10v7" />,
  animations: (
    <>
      <path d="M3 17c3-15 6 15 10 0s5 0 8-10" />
      <path d="m17 6 4 1-1 4" />
    </>
  ),
  settings: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="9" cy="18" r="2" />
    </>
  ),
  audio: <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4" />,
  webcam: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
    </>
  ),
};

export function AppIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] || icons.settings}
    </svg>
  );
}
