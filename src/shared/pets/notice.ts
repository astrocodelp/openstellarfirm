import { type PetLineId, petDoneTitleLine, petLine, petRoleId } from "./lines";
import type { NOTICE_KINDS } from "./protocol";
import { spokenTitle } from "./spoken";

/** What a notice in the pet's inbox is about. */
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * The line a notice says. It is built from the kind, the assistant's role
 * and, for a `done` notice only, the cleaned work title. Never step text,
 * never an amount, never a digit of a number: an approval line names the role
 * and nothing else, even when a title is passed.
 *
 * `message` notices carry the server's own fixed line; this returns the pack's
 * generic `message` line for a caller that has none. A `settings` notice is
 * silent, so its line is empty.
 */
export function noticeLine(
  kind: NoticeKind,
  role?: string | null,
  workTitle?: string | null,
): string {
  switch (kind) {
    case "done": {
      const title = spokenTitle(workTitle);
      if (title) {
        return petDoneTitleLine(title);
      }
      return roleLine("notice-done", role, "done");
    }
    case "approval":
      return roleLine("notice-approval", role, "needs-approve");
    case "stopped":
      return roleLine("notice-stopped", role, "stopped");
    case "budget":
      return petLine("budget").text;
    case "message":
      return petLine("message").text;
    case "settings":
      return "";
  }
}

/**
 * The clips of the voice pack that say the same line, played one after the
 * other, so the pet needs no network. `null` means the pack has no clip for
 * the line and the pet fetches it spoken (`GET /api/pets/say/<seq>`): a
 * `done` notice with a title, and a `message`. A silent notice has no clips.
 */
export function noticeClips(
  kind: NoticeKind,
  role?: string | null,
  hasTitle = false,
): readonly PetLineId[] | null {
  switch (kind) {
    case "done":
      if (hasTitle) {
        return null;
      }
      return roleClips("notice-done", role, "done");
    case "approval":
      return roleClips("notice-approval", role, "needs-approve");
    case "stopped":
      return roleClips("notice-stopped", role, "stopped");
    case "budget":
      return ["budget"];
    case "message":
      return null;
    case "settings":
      return [];
  }
}

/** "Your <role>" and the suffix, or the whole generic line when there is no role. */
function roleLine(
  suffix: "notice-done" | "notice-approval" | "notice-stopped",
  role: string | null | undefined,
  generic: PetLineId,
): string {
  const id = petRoleId(role);
  if (id === undefined) {
    return petLine(generic).text;
  }
  return `${petLine(`role-${id}`).text} ${petLine(suffix).text}`;
}

function roleClips(
  suffix: "notice-done" | "notice-approval" | "notice-stopped",
  role: string | null | undefined,
  generic: PetLineId,
): readonly PetLineId[] {
  const id = petRoleId(role);
  return id === undefined ? [generic] : [`role-${id}`, suffix];
}
