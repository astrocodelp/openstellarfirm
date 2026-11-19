import { type ReactNode, useEffect, useRef } from "react";
import { COLORS, PETS } from "../../shared/catalog";
import type { PetColor, PetId } from "../../shared/types";
import { announce, motionReduced } from "./a11y";

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
  busy = false,
}: {
  pet: PetId;
  color: PetColor;
  size?: number;
  /** True while this assistant answers: the pet breathes, slowly and rarely. */
  busy?: boolean;
}) {
  const shape = PETS.find((p) => p.id === pet) ?? PETS[0];
  if (!shape) return null;
  return (
    <svg
      className={busy ? "pet pet-busy" : "pet"}
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
  down: <path d="M12 5v14M5 12l7 7 7-7" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  alert: <path d="M12 4 3 20h18zM12 10v5M12 17.5h.01" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: <path d="M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5" />,
  speaker: (
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  ),
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
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
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
      data-icon={name}
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * The head every screen starts with: a way back, the title, and a lede that
 * says what the screen is for. One pattern keeps the screens the same.
 */
export function ScreenHead({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="screen-head">
      {onBack ? (
        <button type="button" className="btn back-btn" onClick={onBack}>
          Back to chats
        </button>
      ) : null}
      <h1 className="screen-title">{title}</h1>
      {children ? <p className="dim">{children}</p> : null}
    </header>
  );
}

/**
 * An error, always as an icon and a sentence, told to a screen reader through
 * the app's one live region. Pass `id` to tie it to the field it is about.
 */
export function ErrorLine({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  useEffect(() => {
    if (typeof children === "string" && children)
      announce(`Error: ${children}`);
  }, [children]);
  if (!children) return null;
  return (
    <p className="error" id={id}>
      <Icon name="alert" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Success is teal, with a check and a word. Lime never means "it worked".
 *
 * It is a status of its own, so a screen reader says it. Inside a region that
 * already does (`aria-live`), pass `parentAnnounces`: two live regions, one in
 * the other, read the same sentence twice.
 */
export function OkLine({
  children,
  parentAnnounces = false,
}: {
  children: ReactNode;
  parentAnnounces?: boolean;
}) {
  return (
    <span className="ok-line" role={parentAnnounces ? undefined : "status"}>
      <Icon name="check" size={14} />
      {children}
    </span>
  );
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** True when the page shows less motion, by the person's choice or the computer's. */
export function reducedMotion(): boolean {
  return motionReduced();
}

/**
 * The page's light or dark scheme comes from the main process, so a theme
 * change lands a moment after the call that asks for it. This resolves once
 * the scheme differs from `was`, or after `wait` when it does not change. It
 * reads the query rather than waiting for its change event, which does not
 * fire while a view transition holds the page still.
 */
function schemeChange(was: boolean, wait: number): Promise<void> {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const until = performance.now() + wait;
  return new Promise((resolve) => {
    const look = () => {
      if (query.matches !== was || performance.now() >= until) resolve();
      else setTimeout(look, 8);
    };
    look();
  });
}

/**
 * Changes the theme with one quiet cross-fade of the whole page, instead of
 * every control tweening on its own. With reduced motion it simply switches.
 */
export async function crossFadeTheme(
  next: "system" | "dark" | "light",
  update: () => Promise<void>,
): Promise<void> {
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const same = (next === "dark" && dark) || (next === "light" && !dark);
  if (same) {
    await update();
    return;
  }
  // The controls' own colour transitions are held until the new scheme has
  // landed, so nothing tweens on its own behind the cross-fade.
  root.dataset.themeSwap = "";
  const change = () => schemeChange(dark, next === "system" ? 160 : 400);
  try {
    if (reducedMotion() || !("startViewTransition" in document)) {
      await update();
      await change();
      return;
    }
    const fade = document.startViewTransition(async () => {
      await update();
      await change();
    });
    await fade.updateCallbackDone;
  } finally {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        delete root.dataset.themeSwap;
      }),
    );
  }
}

/**
 * The question before something that cannot be undone, shown in place. Focus
 * moves into it (to the element marked data-autofocus, else its first button),
 * Escape closes it, and when it closes focus goes back to whatever now stands
 * where it was: the button that opened it.
 */
export function useInlineConfirm<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const index = Array.prototype.indexOf.call(parent.children, node);
    const first =
      node.querySelector<HTMLElement>("[data-autofocus]") ??
      node.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus({ preventScroll: true });
    // React has put the opening button back by the time this runs.
    return () => {
      setTimeout(() => {
        const lost =
          !document.activeElement || document.activeElement === document.body;
        if (!lost || !parent.isConnected) return;
        const slot = parent.children[index];
        const target = slot?.matches("button:not(:disabled)")
          ? (slot as HTMLElement)
          : slot?.querySelector<HTMLElement>("button:not(:disabled)");
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  return {
    ref,
    onKeyDown: (event: { key: string }) => {
      if (event.key === "Escape") onClose();
    },
  };
}

/**
 * When the light or dark scheme flips (from Settings or from the system), the
 * controls' colour transitions are held for that frame, so nothing tweens on
 * its own while the page around it has already changed.
 */
export function quietThemeSwaps(): void {
  const root = document.documentElement;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      root.dataset.themeSwap = "";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          delete root.dataset.themeSwap;
        }),
      );
    });
}

/** A question asked in place, with the focus handling of useInlineConfirm. */
export function InlineConfirm({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose(): void;
  children: ReactNode;
}) {
  const confirm = useInlineConfirm<HTMLDivElement>(onClose);
  return (
    <div
      ref={confirm.ref}
      className={className}
      role="alertdialog"
      aria-label={label}
      onKeyDown={confirm.onKeyDown}
    >
      {children}
    </div>
  );
}
