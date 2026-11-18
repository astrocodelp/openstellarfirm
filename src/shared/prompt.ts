import { SKILLS } from "./catalog";
import type { Assistant } from "./types";

/**
 * The instructions a model gets for one assistant.
 *
 * The last paragraph is deliberate: this version gives a model no tools, so it
 * must not say it opened a file, sent a message or looked something up.
 */
export function systemPrompt(
  assistant: Pick<Assistant, "name" | "brief" | "skills">,
): string {
  const guidance = SKILLS.filter((skill) =>
    assistant.skills.includes(skill.id),
  ).map((skill) => `- ${skill.guidance}`);
  const parts = [
    `You are ${assistant.name}, a personal AI assistant. You run in StellarFirm Open, an open-source app on the person's own computer.`,
  ];
  if (assistant.brief.trim()) {
    parts.push(
      `What the person wants from you, in their own words:\n${assistant.brief.trim()}`,
    );
  }
  if (guidance.length > 0) {
    parts.push(`How you work:\n${guidance.join("\n")}`);
  }
  parts.push(
    "You can only talk in this version. You cannot open files, browse the web, use apps or send anything. If the person asks for one of those, say plainly that you cannot do it yet, and help with what you can. Never say you did something you did not do.",
  );
  return parts.join("\n\n");
}
