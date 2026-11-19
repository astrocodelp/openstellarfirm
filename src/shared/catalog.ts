import type { PetColor, PetId, PresetId, Wire } from "./types";

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

/** The six headings the model choice is grouped under, in this order. */
export const PRESET_GROUPS = [
  { id: "local", name: "On this computer" },
  { id: "makers", name: "Model makers" },
  { id: "fast", name: "Fast inference" },
  { id: "routers", name: "Routers" },
  { id: "clouds", name: "Clouds" },
  { id: "own", name: "Your own address" },
] as const;
export type PresetGroup = (typeof PRESET_GROUPS)[number]["id"];

/** The header a key travels in. Decided here, never by the page. */
export type KeyHeader = "bearer" | "api-key";

/**
 * Where a preset's address comes from. "fixed" is pinned in code; "azure" and
 * "bedrock" are built from one checked part the person types; "own" is the
 * person's own address.
 */
export type AddressRule = "fixed" | "azure" | "bedrock" | "own";

export interface Preset {
  id: PresetId;
  name: string;
  group: PresetGroup;
  /** Empty when the address is built or typed. */
  baseUrl: string;
  address: AddressRule;
  /** How the service is spoken to. */
  wire: Wire;
  /** True when the model runs on this computer and needs no key. */
  local: boolean;
  /** True when saving needs a key. A gateway of your own may not. */
  needsKey: boolean;
  /** The header the key goes in. */
  header: KeyHeader;
  /** True when the service lists its models, so the person can pick one. */
  lists: boolean;
  /** One plain line: where to get a key, and anything to know. */
  note: string;
}

const KEY = "Your own key. You name the model.";

function hosted(
  id: PresetId,
  name: string,
  group: PresetGroup,
  baseUrl: string,
  note: string,
  extra: Partial<Preset> = {},
): Preset {
  return {
    id,
    name,
    group,
    baseUrl,
    address: "fixed",
    wire: "openai",
    local: false,
    needsKey: true,
    header: "bearer",
    lists: false,
    note,
    ...extra,
  };
}

/** Most presets speak the OpenAI-compatible chat completions wire. */
export const PRESETS: Preset[] = [
  hosted(
    "ollama",
    "Ollama",
    "local",
    "http://localhost:11434/v1",
    "Runs on this computer. Free, and nothing leaves this machine.",
    { local: true, needsKey: false, lists: true },
  ),
  hosted(
    "lmstudio",
    "LM Studio",
    "local",
    "http://localhost:1234/v1",
    "Runs on this computer. Free, and nothing leaves this machine.",
    { local: true, needsKey: false, lists: true },
  ),
  hosted(
    "openai",
    "OpenAI",
    "makers",
    "https://api.openai.com/v1",
    "Your own key, from your OpenAI account.",
    { lists: true },
  ),
  hosted(
    "anthropic",
    "Anthropic (Claude)",
    "makers",
    "https://api.anthropic.com/v1",
    "Your own Anthropic key.",
    { wire: "anthropic", lists: true },
  ),
  hosted(
    "gemini",
    "Google (Gemini)",
    "makers",
    "https://generativelanguage.googleapis.com/v1beta",
    "Your own Google AI key.",
    { wire: "gemini", lists: true },
  ),
  hosted(
    "mistral",
    "Mistral",
    "makers",
    "https://api.mistral.ai/v1",
    "Your own key, from your Mistral account.",
    { lists: true },
  ),
  hosted(
    "xai",
    "xAI (Grok)",
    "makers",
    "https://api.x.ai/v1",
    "Your own key, from the xAI console. You name the model.",
  ),
  hosted(
    "deepseek",
    "DeepSeek",
    "makers",
    "https://api.deepseek.com",
    "Your own key, from the DeepSeek platform.",
    { lists: true },
  ),
  hosted(
    "groq",
    "Groq",
    "fast",
    "https://api.groq.com/openai/v1",
    "Your own key, from the Groq console.",
    { lists: true },
  ),
  hosted(
    "cerebras",
    "Cerebras",
    "fast",
    "https://api.cerebras.ai/v1",
    `${KEY} Take the name from Cerebras's model list.`,
  ),
  hosted(
    "nvidia",
    "NVIDIA",
    "fast",
    "https://integrate.api.nvidia.com/v1",
    "Your own key from build.nvidia.com. You name the model.",
  ),
  hosted("together", "Together AI", "fast", "https://api.together.ai/v1", KEY, {
    lists: true,
  }),
  hosted(
    "huggingface",
    "Hugging Face",
    "fast",
    "https://router.huggingface.co/v1",
    "Inference Providers. Use a token that may call them.",
    { lists: true },
  ),
  hosted(
    "openrouter",
    "OpenRouter",
    "routers",
    "https://openrouter.ai/api/v1",
    KEY,
    { lists: true },
  ),
  hosted(
    "requesty",
    "Requesty",
    "routers",
    "https://router.requesty.ai/v1",
    KEY,
  ),
  hosted(
    "requesty-eu",
    "Requesty (Europe)",
    "routers",
    "https://router.eu.requesty.ai/v1",
    `${KEY} Pick its EU models, whose names end in @eu, to keep calls in Europe.`,
  ),
  hosted(
    "vercel",
    "Vercel AI Gateway",
    "routers",
    "https://ai-gateway.vercel.sh/v1",
    "Your own AI Gateway key. Models are named like anthropic/claude-opus-5.",
    { lists: true },
  ),
  hosted("llmapi", "LLM API", "routers", "https://api.llmapi.ai/v1", KEY),
  hosted(
    "ironlane",
    "Ironlane",
    "routers",
    "https://api.ironlane.ai/v1",
    "Your own key. Models are named like openai/gpt-4o-mini.",
  ),
  hosted(
    "orcarouter",
    "OrcaRouter",
    "routers",
    "https://api.orcarouter.ai/v1",
    "Your own key. Models are named like openai/gpt-4o-mini.",
  ),
  hosted(
    "azure",
    "Azure OpenAI",
    "clouds",
    "",
    "Your resource's key. Type the resource name, and the name you gave the deployment as the model.",
    { address: "azure", header: "api-key" },
  ),
  hosted(
    "bedrock",
    "Amazon Bedrock",
    "clouds",
    "",
    "A Bedrock API key, and the region it was made in. You name the model.",
    { address: "bedrock" },
  ),
  hosted(
    "litellm",
    "LiteLLM gateway",
    "own",
    "",
    "Your own LiteLLM gateway: https, or http on this computer. A key only if yours asks for one.",
    { address: "own", needsKey: false, lists: true },
  ),
  hosted(
    "custom",
    "Your own endpoint",
    "own",
    "",
    "Any OpenAI-compatible address. A key only if it asks for one.",
    { address: "own", needsKey: false, lists: true },
  ),
];

export function presetOf(id: PresetId): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error("That model source is not known.");
  return preset;
}

/** The header a saved source's key goes in; a source with no known preset uses Bearer. */
export function headerOf(id: string): KeyHeader {
  return PRESETS.find((p) => p.id === id)?.header ?? "bearer";
}
