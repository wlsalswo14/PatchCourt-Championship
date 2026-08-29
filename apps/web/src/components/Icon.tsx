import type { SVGProps } from "react";

type IconName =
  | "play"
  | "scale"
  | "evidence"
  | "compare"
  | "receipt"
  | "check"
  | "x"
  | "copy"
  | "download"
  | "replay"
  | "lock"
  | "external"
  | "chevron";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    play: <path d="m9 7 8 5-8 5Z" />,
    scale: (
      <>
        <path d="M12 3v18M6 21h12M5 7h14" />
        <path d="m5 7-3 6a4 4 0 0 0 6 0Zm14 0-3 6a4 4 0 0 0 6 0Z" />
      </>
    ),
    evidence: (
      <>
        <path d="M6 3h9l3 3v15H6Z" />
        <path d="M9 11h6M9 15h6M15 3v4h4" />
      </>
    ),
    compare: (
      <>
        <path d="M8 5 4 9l4 4M4 9h14M16 19l4-4-4-4M20 15H6" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    x: <path d="m6 6 12 12M18 6 6 18" />,
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="1" />
        <path d="M16 8V5H5v11h3" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M4 21h16" />
      </>
    ),
    replay: (
      <>
        <path d="M4 11a8 8 0 1 1 2 6" />
        <path d="M4 5v6h6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="1" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    external: <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
