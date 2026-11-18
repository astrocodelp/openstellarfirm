import { desktopCapturer, screen, systemPreferences } from "electron";
import type { Frame, ScreenDeps } from "./screen";

/**
 * The real screen, through Electron's own capture. Nothing here is called
 * until the person has approved a look, and the picture is never written to a
 * file: it is handed on as bytes and dropped when the answer ends.
 */

/** The size the system is asked to scale the screen to. */
const ASK_SIDE = 1568;

/** The main screen first, then the others in the system's order. */
function ordered(): Electron.Display[] {
  const primary = screen.getPrimaryDisplay();
  return [
    primary,
    ...screen.getAllDisplays().filter((display) => display.id !== primary.id),
  ];
}

function sized(display: Electron.Display): { width: number; height: number } {
  const { width, height } = display.size;
  const scale = Math.min(1, ASK_SIDE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function frameOf(image: Electron.NativeImage): Frame {
  return {
    empty: image.isEmpty(),
    encode(maxSide, quality) {
      const { width, height } = image.getSize();
      const scale = Math.min(1, maxSide / Math.max(width, height, 1));
      const shown =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(width * scale)),
              quality: "good",
            })
          : image;
      return shown.toJPEG(quality);
    },
  };
}

export function electronScreen(where: string): ScreenDeps {
  return {
    where,
    platform: process.platform,
    permission: () => {
      try {
        return systemPreferences.getMediaAccessStatus("screen");
      } catch {
        return "unknown";
      }
    },
    // A one-pixel look, thrown away at once: it only makes the system list
    // this app under Screen Recording so the person can allow it.
    askPermission: async () => {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
    },
    screens: () => screen.getAllDisplays().length,
    capture: async (index) => {
      const display = ordered()[index];
      if (!display) return undefined;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: sized(display),
      });
      const source =
        sources.find((s) => s.display_id === String(display.id)) ??
        // Some systems name no display: then the order is the best there is.
        (sources.every((s) => !s.display_id) ? sources[index] : undefined);
      return source ? frameOf(source.thumbnail) : undefined;
    },
  };
}
