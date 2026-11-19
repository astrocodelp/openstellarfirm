import { delimiter, join, win32 } from "node:path";

/**
 * Finds the `docker` program. An app opened from the Dock or the Start menu
 * gets a short PATH, so the usual places of Docker Desktop, Docker Engine,
 * OrbStack, Colima, Rancher Desktop and Podman's docker command are looked at
 * too. The path is never taken from a setting or a page: only from the
 * system's PATH and this fixed list.
 */

export interface FindDeps {
  platform: string;
  env: NodeJS.ProcessEnv;
  home: string;
  /** True when a regular file that may be run is there. */
  isFile(path: string): boolean;
}

function knownDirs(platform: string, home: string): string[] {
  if (platform === "win32") {
    return [
      win32.join("C:\\Program Files", "Docker", "Docker", "resources", "bin"),
      win32.join(home, ".rd", "bin"),
      win32.join("C:\\Program Files", "RedHat", "Podman"),
    ];
  }
  const dirs = [
    "/usr/local/bin",
    "/usr/bin",
    join(home, ".docker", "bin"),
    join(home, ".rd", "bin"),
  ];
  if (platform === "darwin") {
    dirs.push(
      "/opt/homebrew/bin",
      "/Applications/Docker.app/Contents/Resources/bin",
      join(home, ".orbstack", "bin"),
      "/opt/podman/bin",
    );
  } else {
    dirs.push("/snap/bin", "/var/lib/flatpak/exports/bin");
  }
  return dirs;
}

/** The folders searched, in order: the system's PATH first, then the list. */
export function searchDirs(deps: Omit<FindDeps, "isFile">): string[] {
  const path = deps.env.PATH ?? deps.env.Path ?? "";
  const sep = deps.platform === "win32" ? ";" : delimiter;
  const fromPath = path.split(sep).filter((dir) => dir.trim().length > 0);
  const out: string[] = [];
  for (const dir of [...fromPath, ...knownDirs(deps.platform, deps.home)]) {
    if (!out.includes(dir)) out.push(dir);
  }
  return out;
}

export function findDocker(deps: FindDeps): string | undefined {
  const name = deps.platform === "win32" ? "docker.exe" : "docker";
  const joiner = deps.platform === "win32" ? win32.join : join;
  for (const dir of searchDirs(deps)) {
    const candidate = joiner(dir, name);
    if (deps.isFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The environment `docker` runs with: the app's own, with the folders above
 * on the PATH, so the helpers Docker calls itself (such as its credential
 * helper) are found too.
 */
export function dockerEnv(
  deps: Omit<FindDeps, "isFile">,
  dockerPath: string,
): NodeJS.ProcessEnv {
  const sep = deps.platform === "win32" ? ";" : delimiter;
  const own =
    deps.platform === "win32"
      ? win32.dirname(dockerPath)
      : dockerPath.slice(0, dockerPath.lastIndexOf("/")) || "/";
  const dirs = [own, ...searchDirs(deps).filter((dir) => dir !== own)];
  const env: NodeJS.ProcessEnv = { ...deps.env };
  // On Windows the name is written in any case; one copy of it is kept.
  for (const key of Object.keys(env))
    if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = dirs.join(sep);
  return env;
}
