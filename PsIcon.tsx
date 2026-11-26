import type { FaceId } from "../lib/buttons";

const SHAPES = {
  triangle: (
    <path d="M12 5.2 19.4 18H4.6Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
  ),
  square: <rect x="5.5" y="5.5" width="13" height="13" rx="1" fill="none" stroke="currentColor" strokeWidth="2.4" />,
  cross: (
    <path
      d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  ),
  circle: <circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" strokeWidth="2.4" />,
};

/** The four PlayStation action-button symbols, drawn so they look the same on every device */
export default function PsIcon({ id }: { id: FaceId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      {SHAPES[id]}
    </svg>
  );
}
