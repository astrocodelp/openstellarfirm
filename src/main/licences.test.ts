import { describe, expect, it } from "vitest";
import { licenceEntries, licencesText } from "../../scripts/licences.mjs";

/**
 * The licence file the build writes: every piece of other people's work that
 * ships in the app has its full text, read from the package that ships it.
 */
describe("THIRD-PARTY-LICENSES.txt", () => {
  const text = licencesText();

  it("has the full text of each licence kind it ships", () => {
    // MIT, BSD and the SIL Open Font License each ask for the text itself.
    expect(text).toContain("Permission is hereby granted, free of charge");
    expect(text).toContain("Redistribution and use in source and binary forms");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toContain(
      "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    );
  });

  it("names every part THIRD-PARTY-NOTICES.md lists", () => {
    const titles = licenceEntries().map((entry) => entry.title);
    for (const part of [
      "Geist (font)",
      "Geist Mono (font)",
      "React ",
      "React DOM",
      "scheduler",
      "Electron",
      "PDF.js (pdfjs-dist)",
      "Adobe CMaps",
      "JBIG2",
      "JPEG 2000",
      "colour profiles",
      "Tesseract.js ",
      "regenerator-runtime",
      "zlib.js",
      "bmp-js",
      "idb-keyval",
      "wasm-feature-detect",
      "buffer",
      "ieee754",
      "Tesseract.js Core",
    ])
      expect(
        titles.some((title) => title.startsWith(part) || title.includes(part)),
        part,
      ).toBe(true);
  });

  it("reads each text from a file that exists, or carries its own", () => {
    for (const entry of licenceEntries())
      expect(Boolean(entry.file ?? entry.text), entry.title).toBe(true);
  });
});
