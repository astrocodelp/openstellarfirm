import type { PetColor, PetId, PresetId } from "./types";

/** A pet is one filled shape and two eyes, on a 48 by 48 canvas. */
export interface PetShape {
  id: PetId;
  name: string;
  d: string;
  eyeY: number;
  eyeLeft: number;
  eyeRight: number;
}

export const PETS: PetShape[] = [
  {
    id: "blip",
    name: "Blip",
    d: "M24 11a13 13 0 1 0 0 26a13 13 0 1 0 0-26zM22.5 2h3v7h-3zM22.5 39h3v7h-3z",
    eyeY: 23,
    eyeLeft: 19.5,
    eyeRight: 28.5,
  },
  {
    id: "glim",
    name: "Glim",
    d: "M24 3c2 11 6 15 17 21-11 4-15 8-17 21-2-13-6-17-17-21 11-6 15-10 17-21z",
    eyeY: 24,
    eyeLeft: 20.5,
    eyeRight: 27.5,
  },
  {
    id: "pop",
    name: "Pop",
    d: "M24 4l4.5 9.5L38 10l-3.5 9.5L43 24l-8.5 4.5L38 38l-9.5-3.5L24 44l-4.5-9.5L10 38l3.5-9.5L5 24l8.5-4.5L10 10l9.5 3.5z",
    eyeY: 23.5,
    eyeLeft: 20.5,
    eyeRight: 27.5,
  },
  {
    id: "puff",
    name: "Puff",
    d: "M6 28a9 9 0 1 0 18 0a9 9 0 1 0-18 0zM13 20a11 11 0 1 0 22 0a11 11 0 1 0-22 0zM24 28a9 9 0 1 0 18 0a9 9 0 1 0-18 0zM14 27v10h20V27z",
    eyeY: 25,
    eyeLeft: 20,
    eyeRight: 28,
  },
  {
    id: "tally",
    name: "Tally",
    d: "M12 22a12 12 0 1 1 24 0a12 12 0 1 1-24 0zM3 28c0-2.2 9.4-4 21-4s21 1.8 21 4-9.4 4-21 4-21-1.8-21-4z",
    eyeY: 19,
    eyeLeft: 20,
    eyeRight: 28,
  },
  {
    id: "drift",
    name: "Drift",
    d: "M10 24a14 14 0 0 1 28 0v4H10zM13 30h4v9h-4zM22 30h4v13h-4zM31 30h4v9h-4z",
    eyeY: 21,
    eyeLeft: 20,
    eyeRight: 28,
  },
];

export const COLORS: { id: PetColor; name: string; hex: string }[] = [
  { id: "lime", name: "Lime", hex: "#d9ff3f" },
  { id: "sky", name: "Sky", hex: "#7cc7ff" },
  { id: "nebula", name: "Nebula", hex: "#b79cff" },
  { id: "rose", name: "Rose", hex: "#ff9fb8" },
  { id: "moon", name: "Moon", hex: "#e8e4d8" },
];

/**
 * A skill is a line of guidance added to the assistant's instructions.
 * It is never a permission: this version of the app gives a model no tools.
 */
export const SKILLS: { id: string; name: string; guidance: string }[] = [
  {
    id: "research",
    name: "Research with sources",
    guidance:
      "When you state a fact, say where it comes from. If you are not sure, say so instead of guessing.",
  },
  {
    id: "write",
    name: "Write and edit",
    guidance:
      "Write in plain, short sentences. Offer one clear draft before any alternatives.",
  },
  {
    id: "summarise",
    name: "Summarise",
    guidance:
      "Summaries lead with the conclusion, then the few points that support it.",
  },
  {
    id: "translate",
    name: "Translate",
    guidance:
      "Translate meaning, not word by word, and keep names and numbers exactly as given.",
  },
  {
    id: "plan",
    name: "Plan and organise",
    guidance:
      "Turn a goal into ordered steps, and say which step needs the person's decision.",
  },
  {
    id: "code",
    name: "Explain and write code",
    guidance:
      "Show code in fenced blocks, and say what you have not run or tested.",
  },
];

export interface Preset {
  id: PresetId;
  name: string;
  /** Empty for "custom": the person types the address. */
  baseUrl: string;
  /** True when the model runs on this computer and needs no key. */
  local: boolean;
  note: string;
}

/** Every preset speaks the OpenAI-compatible chat completions wire. */
export const PRESETS: Preset[] = [
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    local: true,
    note: "Runs on this computer. Free, and nothing leaves this machine.",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    local: true,
    note: "Runs on this computer. Free, and nothing leaves this machine.",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    local: false,
    note: "Your own key.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    local: false,
    note: "Your own key. You name the model.",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    local: false,
    note: "Your own key.",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    local: false,
    note: "Your own key. You name the model.",
  },
  {
    id: "custom",
    name: "Your own endpoint",
    baseUrl: "",
    local: false,
    note: "Any OpenAI-compatible address, such as a LiteLLM gateway.",
  },
];

export function presetOf(id: PresetId): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error("That model source is not known.");
  return preset;
}
