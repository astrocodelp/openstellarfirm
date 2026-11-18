import type { OpenApi } from "../../shared/types";

declare global {
  interface Window {
    /** Set by the preload in the app. Missing when the page runs in a plain browser. */
    stellarOpen?: OpenApi;
  }
}
