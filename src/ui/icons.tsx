import type { ReactNode, SVGProps } from 'react';

function point(angle: number, radius: number): string {
  return `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
}

function gearOutline(teeth: number, outer: number, inner: number): string {
  const step = (Math.PI * 2) / teeth;
  const half = step / 4;
  const parts: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const center = tooth * step;
    parts.push(
      point(center - step / 2 + half / 2, inner),
      point(center - half, outer),
      point(center + half, outer),
      point(center + step / 2 - half / 2, inner),
    );
  }
  return `M${parts.join('L')}Z`;
}

const GEAR = gearOutline(8, 9.5, 7.2);

const PATHS = {
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  settings: (
    <>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'rotate-left': <path d="M3.5 4v5h5M4.2 9A8.5 8.5 0 1 1 3.5 13" />,
  'rotate-right': <path d="M20.5 4v5h-5M19.8 9A8.5 8.5 0 1 0 20.5 13" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  upload: (
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
  ),
  download: (
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
  ),
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7M10 11v5M14 11v5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5" />
      <path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  file: <path d="M6.5 3h7.5l4.5 4.5V21h-12zM14 3v4.5h4.5" />,
  table: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M3.5 10h17M9.5 10v9" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  cloud: <path d="M7.5 18h9.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7.5 18z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  readonly name: IconName;
  readonly size?: number;
}

export function Icon({ name, size = 16, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className === undefined ? 'icon' : `icon ${className}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
