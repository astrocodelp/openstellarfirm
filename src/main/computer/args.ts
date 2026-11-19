import { createHash } from "node:crypto";
import type { ComputerSettings } from "../../shared/computer";

/**
 * The argument arrays the app gives `docker`, built in one place so a test
 * can read every one of them. The rules they keep:
 * - no `--privileged`, no added capability, no Docker socket, no host network;
 * - every capability dropped, no new privileges, limits on processes, memory
 *   and processors;
 * - `--network none` unless the person turned the network on;
 * - one folder of this computer mounted: the assistant's own exchange folder.
 */

export const LABEL = "ai.stellarfirm.openstellarfirm.computer";
export const LABEL_ASSISTANT = `${LABEL}.assistant`;
export const LABEL_CONFIG = `${LABEL}.config`;
export const IMAGE_NAME = "openstellarfirm-computer";

export const USER = "assistant";
export const HOME = "/home/assistant";
export const EXCHANGE_INSIDE = `${HOME}/exchange`;
export const PIDS_LIMIT = 512;
export const SHM_SIZE = "512m";

/** Assistant ids are the app's own UUIDs; anything else names no container. */
const ASSISTANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ComputerError extends Error {}

export function containerName(assistantId: string): string {
  if (!ASSISTANT_ID.test(assistantId))
    throw new ComputerError("That assistant is no longer here.");
  return `openstellarfirm-computer-${assistantId}`;
}

/** The user and group the computer's processes run as. */
export interface UserIds {
  uid: number;
  gid: number;
}

export const DEFAULT_IDS: UserIds = { uid: 1000, gid: 1000 };

/** Ids Docker and the image take: whole numbers below 2^31 - 1. */
const MAX_ID = 2 ** 31 - 2;

/**
 * The ids the computer's user gets. With Docker Engine on Linux, the exchange
 * folder is shared as it is on disk: owned by the person's own user, readable
 * by no one else. The computer's user takes the same ids so it can read and
 * write there. Docker Desktop on macOS and Windows hands the folder over
 * itself, so there the ids stay 1000. Never root's: an id below 1000 belongs
 * to the system, and the image keeps 1000.
 */
export function computerIds(
  platform: string,
  uid: number | undefined,
  gid: number | undefined,
): UserIds {
  if (platform !== "linux") return DEFAULT_IDS;
  const fits = (id: number | undefined, min: number): id is number =>
    typeof id === "number" && Number.isInteger(id) && id >= min && id <= MAX_ID;
  if (!fits(uid, 1000) || !fits(gid, 1)) return DEFAULT_IDS;
  return { uid, gid };
}

/**
 * The image's tag follows the files it is built from, and the ids its user is
 * made with, so a change to either rebuilds.
 */
export function imageTag(
  files: { name: string; content: string }[],
  ids: UserIds = DEFAULT_IDS,
): string {
  const hash = createHash("sha256");
  hash.update(`ids\0${ids.uid}:${ids.gid}\0`);
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `${IMAGE_NAME}:${hash.digest("hex").slice(0, 16)}`;
}

/** What a container was made with. A different one means a new container. */
export function configKey(settings: ComputerSettings, image: string): string {
  return [
    settings.network ? "network" : "no-network",
    `${settings.memoryGb}g`,
    `${settings.cpus}cpu`,
    image,
  ].join("|");
}

export function buildArgs(
  tag: string,
  contextDir: string,
  ids: UserIds = DEFAULT_IDS,
): string[] {
  return [
    "build",
    "--label",
    `${LABEL}=image`,
    "--build-arg",
    `ASSISTANT_UID=${ids.uid}`,
    "--build-arg",
    `ASSISTANT_GID=${ids.gid}`,
    "--tag",
    tag,
    contextDir,
  ];
}

export interface RunSpec {
  assistantId: string;
  image: string;
  /** The assistant's exchange folder on this computer. */
  exchange: string;
  settings: ComputerSettings;
  /** The ids the image's user was made with; 1000 when not given. */
  ids?: UserIds;
}

/** The source of a bind mount, quoted the way `--mount` reads it. */
function mountSource(path: string): string {
  if (!path || /["\r\n\0]/.test(path))
    throw new ComputerError("The exchange folder's path cannot be shared.");
  return `"source=${path}"`;
}

export function runArgs(spec: RunSpec): string[] {
  const { settings } = spec;
  const memory = `${settings.memoryGb}g`;
  const ids = spec.ids ?? DEFAULT_IDS;
  return [
    "run",
    "--detach",
    "--name",
    containerName(spec.assistantId),
    "--hostname",
    "computer",
    "--label",
    `${LABEL}=assistant`,
    "--label",
    `${LABEL_ASSISTANT}=${spec.assistantId}`,
    "--label",
    `${LABEL_CONFIG}=${configKey(settings, spec.image)}`,
    "--init",
    "--user",
    `${ids.uid}:${ids.gid}`,
    // With no "--network", the engine's default network is used, which
    // reaches the internet. The person turns that on; it is off by default.
    ...(settings.network ? [] : ["--network", "none"]),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(PIDS_LIMIT),
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--cpus",
    String(settings.cpus),
    "--shm-size",
    SHM_SIZE,
    "--stop-timeout",
    "5",
    "--mount",
    `type=bind,${mountSource(spec.exchange)},target=${EXCHANGE_INSIDE}`,
    spec.image,
  ];
}

/** One program run inside the container, as its own user, in its home. */
export function execArgs(
  assistantId: string,
  command: readonly string[],
): string[] {
  return [
    "exec",
    "--user",
    USER,
    "--workdir",
    HOME,
    containerName(assistantId),
    ...command,
  ];
}

export function inspectArgs(assistantId: string): string[] {
  return [
    "container",
    "inspect",
    "--format",
    `{{.State.Running}}|{{index .Config.Labels "${LABEL_CONFIG}"}}`,
    containerName(assistantId),
  ];
}

/** The ids of the app's running containers, and only those. */
export const LIST_RUNNING_ARGS = [
  "ps",
  "--quiet",
  "--filter",
  `label=${LABEL}=assistant`,
];
