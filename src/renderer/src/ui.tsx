import type { ReactNode } from "react";
import { COLORS, PETS } from "../../shared/catalog";
import type { PetColor, PetId } from "../../shared/types";

/** Small shared pieces: the pets, the icons, and the two status lines. */

/**
 * A pet's colour is a token, so each theme can draw it in a shade that holds
 * its own on the page. The brand's own hex values live in the catalog.
 */
export function petColor(color: PetColor): string {
  const known = COLORS.some((c) => c.id === color);
  return known ? `var(--pet-${color})` : "currentColor";
}

export function Pet({
  pet,
  color,
  size = 36,
}: {
  pet: PetId;
  color: PetColor;
  size?: number;
}) {
  const shape = PETS.find((p) => p.id === pet) ?? PETS[0];
  if (!shape) return null;
  return (
    <svg
      className="pet"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path d={shape.d} fill={petColor(color)} />
      <circle className="eye" cx={shape.eyeLeft} cy={shape.eyeY} r="2.2" />
      <circle className="eye" cx={shape.eyeRight} cy={shape.eyeY} r="2.2" />
    </svg>
  );
}

/** Nova, the app's own pet: an astronaut with a lime glint on the visor. */
export function Nova({ size = 72 }: { size?: number }) {
  return (
    <svg
      className="pet"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Nova, the app's pet"
    >
      <path d="M14 35a10 10 0 0 1 20 0v9H14z" fill="var(--nova-body)" />
      <circle cx="24" cy="19" r="14" fill="var(--nova-body)" />
      <rect
        x="12.5"
        y="12"
        width="23"
        height="13.5"
        rx="6.75"
        fill="var(--nova-visor)"
      />
      <path
        d="M17 17h5.5"
        stroke="var(--nova-glint)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 5 5 9-10" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  alert: <path d="M12 4 3 20h18zM12 10v5M12 17.5h.01" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: <path d="M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5" />,
  cloud: (
    <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 0 8.5z" />
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  sliders: (
    <>
      <path d="M4 7h9M19 7h1M4 17h1M11 17h9" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="8" cy="17" r="2.5" />
    </>
  ),
} as const;

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof ICONS;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** An error, always as an icon and a sentence, announced to a screen reader. */
export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </p>
  );
}

/** Success is teal, with a check and a word. Lime never means "it worked". */
export function OkLine({ children }: { children: ReactNode }) {
  return (
    <span className="ok-line" role="status">
      <Icon name="check" size={14} />
      {children}
    </span>
  );
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
