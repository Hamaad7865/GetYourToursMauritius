import type { SVGProps } from 'react';

/** The assistant's own icons — the ones `@/components/ui/icons` does not carry. Same grammar as
 *  that set (24px grid, 2px round stroke, currentColor) so the two are indistinguishable in use. */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </Svg>
);

export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </Svg>
);

export const IconMap = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m9 4-6 2.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z" />
    <path d="M9 4v13" />
    <path d="M15 7v13" />
  </Svg>
);

export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3.5 6h.01" />
    <path d="M3.5 12h.01" />
    <path d="M3.5 18h.01" />
  </Svg>
);

/** "Continue with…" — the turn arrow in front of a suggested question. */
export const IconReply = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M5 5v6a3 3 0 0 0 3 3h11" />
    <path d="m15 10 4 4-4 4" />
  </Svg>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="m6 7 1 13h10l1-13" />
  </Svg>
);

export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Svg>
);

export const IconArrowDown = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Svg>
);

export const IconFork = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M7 3v7a2 2 0 0 0 2 2v9" />
    <path d="M11 3v7a2 2 0 0 1-2 2" />
    <path d="M9 3v6" />
    <path d="M17 21v-8h-2V7a4 4 0 0 1 2-4v10" />
  </Svg>
);

export const IconColumns = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="M15 4v16" />
  </Svg>
);

export const IconPrinter = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Svg>
);

/** The car that travels the route: the working indicator and the booking bar. Filled, side-on. */
export function CarGlyph({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 14) / 26}
      viewBox="0 0 26 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.2 8.6c0-1.2.9-2.2 2-2.4l2.6-.5 2.3-3c.5-.7 1.3-1.1 2.2-1.1h5.4c.9 0 1.8.4 2.3 1.2l1.9 2.7 2.4.5c1.3.3 2.2 1.4 2.2 2.7V10a1 1 0 0 1-1 1h-1.3a2.7 2.7 0 0 0-5.4 0H9.8a2.7 2.7 0 0 0-5.4 0H3.2a1 1 0 0 1-1-1V8.6Z"
        fill="currentColor"
      />
      <path d="M10.2 5.5 11.8 3.3h2.6v2.2h-4.2Zm5.6 0V3.3h1.2l1.5 2.2h-2.7Z" fill="#fff" />
      <circle cx="7.1" cy="11.1" r="1.9" fill="currentColor" stroke="#fff" strokeWidth="0.8" />
      <circle cx="19.1" cy="11.1" r="1.9" fill="currentColor" stroke="#fff" strokeWidth="0.8" />
    </svg>
  );
}
