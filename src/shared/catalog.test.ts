import { describe, expect, it } from "vitest";
import { BEDROCK_REGIONS, partOf, resolveAddress } from "./address";
import { headerOf, PRESET_GROUPS, PRESETS, presetOf } from "./catalog";
import { checkEndpoint } from "./endpoint";
import { PRESET_IDS } from "./types";

describe("the preset catalog", () => {
  it("lists every preset id once, each with a group and a help line", () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual([...PRESET_IDS].sort());
    const groups = new Set<string>(PRESET_GROUPS.map((g) => g.id));
    for (const preset of PRESETS) {
      expect(groups.has(preset.group), preset.id).toBe(true);
      expect(preset.note.trim().length, preset.id).toBeGreaterThan(10);
      expect(preset.note, preset.id).not.toMatch(/\b(bot|robot)s?\b/i);
    }
    for (const group of PRESET_GROUPS) {
      expect(
        PRESETS.some((p) => p.group === group.id),
        group.id,
      ).toBe(true);
    }
  });

  it("pins every hosted preset to a checked address, whatever the page sends", () => {
    for (const preset of PRESETS.filter((p) => p.address === "fixed")) {
      const sent = {
        baseUrl: "https://evil.example.com/v1",
        part: "evil",
      };
      expect(resolveAddress(preset.id, sent), preset.id).toBe(
        checkEndpoint(preset.baseUrl),
      );
      if (!preset.local) expect(preset.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it("uses the address each service's own documentation gives", () => {
    const url = (id: Parameters<typeof presetOf>[0]) => presetOf(id).baseUrl;
    expect(url("xai")).toBe("https://api.x.ai/v1");
    expect(url("deepseek")).toBe("https://api.deepseek.com");
    expect(url("groq")).toBe("https://api.groq.com/openai/v1");
    expect(url("cerebras")).toBe("https://api.cerebras.ai/v1");
    expect(url("nvidia")).toBe("https://integrate.api.nvidia.com/v1");
    expect(url("huggingface")).toBe("https://router.huggingface.co/v1");
    expect(url("requesty")).toBe("https://router.requesty.ai/v1");
    expect(url("requesty-eu")).toBe("https://router.eu.requesty.ai/v1");
    expect(url("vercel")).toBe("https://ai-gateway.vercel.sh/v1");
    expect(url("llmapi")).toBe("https://api.llmapi.ai/v1");
    expect(url("ironlane")).toBe("https://api.ironlane.ai/v1");
    expect(url("orcarouter")).toBe("https://api.orcarouter.ai/v1");
  });

  it("sends the key in api-key only for Azure", () => {
    for (const preset of PRESETS) {
      expect(preset.header, preset.id).toBe(
        preset.id === "azure" ? "api-key" : "bearer",
      );
    }
    expect(headerOf("azure")).toBe("api-key");
    expect(headerOf("a-preset-from-nowhere")).toBe("bearer");
  });

  it("needs a key everywhere except on this computer and at your own address", () => {
    for (const preset of PRESETS) {
      expect(preset.needsKey, preset.id).toBe(
        !(preset.local || preset.address === "own"),
      );
    }
  });
});

describe("Azure OpenAI addresses", () => {
  const azure = (part: string) => resolveAddress("azure", { part });

  it("builds the v1 address from a resource name or an Azure host", () => {
    expect(azure("My-Resource")).toBe(
      "https://my-resource.openai.azure.com/openai/v1",
    );
    expect(azure("my-resource.openai.azure.com")).toBe(
      "https://my-resource.openai.azure.com/openai/v1",
    );
    expect(azure("https://my-resource.services.ai.azure.com/")).toBe(
      "https://my-resource.services.ai.azure.com/openai/v1",
    );
  });

  it("refuses hostile values", () => {
    for (const bad of [
      "",
      "https://user:pw@my-resource.openai.azure.com",
      "https://my-resource.openai.azure.com/openai/v1",
      "my-resource.openai.azure.com?key=1",
      "my-resource.openai.azure.com:8443",
      "my-resource.openai.azure.com#x",
      "evil.example.com",
      "my-resource.openai.azure.com.evil.example.com",
      "openai.azure.com",
      ".openai.azure.com",
      "-bad-.openai.azure.com",
      "a b",
      "http://my-resource.openai.azure.com",
      "my_resource",
    ]) {
      expect(() => azure(bad), bad).toThrow();
    }
  });

  it("gives back the part it was built from", () => {
    const saved = azure("my-resource");
    expect(partOf("azure", saved)).toBe("my-resource.openai.azure.com");
    expect(azure(partOf("azure", saved))).toBe(saved);
  });
});

describe("Amazon Bedrock addresses", () => {
  it("builds the address from a region in the fixed list", () => {
    for (const region of BEDROCK_REGIONS) {
      const url = resolveAddress("bedrock", { part: region });
      expect(url).toBe(
        `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
      );
      expect(partOf("bedrock", url)).toBe(region);
    }
  });

  it("refuses anything that is not in the list", () => {
    for (const bad of [
      "",
      "us-east-9",
      "us-east-1.evil.example.com",
      "us-east-1/../x",
      "https://bedrock-runtime.us-east-1.amazonaws.com",
      "us-east-1?x=1",
      "evil@us-east-1",
    ]) {
      expect(() => resolveAddress("bedrock", { part: bad }), bad).toThrow();
    }
  });
});

describe("your own address", () => {
  it("takes a typed address for a LiteLLM gateway, https or on this computer", () => {
    expect(
      resolveAddress("litellm", { baseUrl: "http://localhost:4000/" }),
    ).toBe("http://localhost:4000");
    expect(
      resolveAddress("litellm", { baseUrl: "https://gw.example.com/v1" }),
    ).toBe("https://gw.example.com/v1");
    expect(() =>
      resolveAddress("litellm", { baseUrl: "http://gw.example.com" }),
    ).toThrow(/https/);
    expect(() => resolveAddress("litellm", {})).toThrow();
  });
});
