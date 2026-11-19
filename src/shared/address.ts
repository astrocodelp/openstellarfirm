import { presetOf } from "./catalog";
import { checkEndpoint } from "./endpoint";
import type { PresetId } from "./types";

/**
 * The regions Amazon lists for its Bedrock runtime endpoints
 * (`bedrock-runtime.<region>.amazonaws.com`). Government regions are left
 * out: they need their own kind of account.
 */
export const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-south-1",
  "ap-south-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-south-1",
  "eu-south-2",
  "eu-north-1",
  "sa-east-1",
] as const;

/** The only domains an Azure resource's address may end in. */
export const AZURE_DOMAINS = ["openai.azure.com", "services.ai.azure.com"];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Reads what a person typed for an Azure resource: a resource name, or its
 * host, with an optional leading https://. Nothing else is taken: no sign-in,
 * port, path, query or other domain.
 */
function azureHost(part: string): string {
  let text = part.trim().toLowerCase();
  if (text.startsWith("https://")) text = text.slice(8);
  text = text.replace(/\/+$/, "");
  const bad = () =>
    new Error(
      "Type the resource's name, such as my-resource, or its address ending in openai.azure.com.",
    );
  if (!text || /[^a-z0-9.-]/.test(text)) throw bad();
  if (!text.includes(".")) {
    if (!LABEL.test(text)) throw bad();
    return `${text}.openai.azure.com`;
  }
  const domain = AZURE_DOMAINS.find((d) => text.endsWith(`.${d}`));
  if (!domain) throw bad();
  const label = text.slice(0, text.length - domain.length - 1);
  if (!LABEL.test(label)) throw bad();
  return text;
}

/**
 * The one place a model address is decided. A hosted preset's address is
 * pinned in code and whatever the page sends is ignored; a cloud preset is
 * built from one checked part; only the "own" presets take a typed address.
 */
export function resolveAddress(
  presetId: PresetId,
  input: { baseUrl?: string; part?: string },
): string {
  const preset = presetOf(presetId);
  switch (preset.address) {
    case "fixed":
      return checkEndpoint(preset.baseUrl);
    case "own":
      return checkEndpoint(input.baseUrl ?? "");
    case "azure":
      return checkEndpoint(`https://${azureHost(input.part ?? "")}/openai/v1`);
    case "bedrock": {
      const region = (input.part ?? "").trim();
      if (!(BEDROCK_REGIONS as readonly string[]).includes(region))
        throw new Error("Pick one of the regions in the list.");
      return checkEndpoint(
        `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
      );
    }
  }
}

/** The part a saved cloud address was built from, so the form can show it. */
export function partOf(presetId: PresetId, baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const preset = presetOf(presetId);
    if (preset.address === "azure") return url.hostname;
    if (preset.address === "bedrock")
      return (
        /^bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com$/.exec(
          url.hostname,
        )?.[1] ?? ""
      );
  } catch {
    // An address that does not read leaves the part empty.
  }
  return "";
}
