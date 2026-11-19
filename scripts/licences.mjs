// Writes THIRD-PARTY-LICENSES.txt: the full licence text of every piece of
// other people's work that ships inside a built app. MIT, BSD and the SIL Open
// Font License ask for the text itself, not only a name, so the build reads
// each text from the package that ships it and fails if one is missing.
// THIRD-PARTY-NOTICES.md is the short list; this file is the texts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = createRequire(join(root, "package.json"));

/** The folder of a package, found from the project or from another package. */
function packageDir(name, from = fromRoot) {
  return dirname(from.resolve(`${name}/package.json`));
}

function requireFrom(dir) {
  return createRequire(join(dir, "package.json"));
}

function licenceFile(dir) {
  const name = readdirSync(dir).find((file) =>
    /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file),
  );
  if (!name) throw new Error(`No licence file in ${dir}`);
  return join(dir, name);
}

function version(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

/**
 * Two small libraries that Tesseract.js's own build bundled into its worker
 * file (dist/worker.min.js) and that are not installed as packages. Their
 * notices are in Tesseract.js's dist/worker.min.js.LICENSE.txt; the texts are
 * the standard ones those notices name.
 */
const BUNDLED_IN_TESSERACT_WORKER = [
  {
    title: "buffer (bundled in Tesseract.js's worker)",
    licence: "MIT",
    source: "https://github.com/feross/buffer",
    text: `The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh, and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`,
  },
  {
    title: "ieee754 (bundled in Tesseract.js's worker)",
    licence: "BSD-3-Clause",
    source: "https://github.com/feross/ieee754",
    text: `Copyright 2008 Fair Oaks Labs, Inc.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
];

/** Every entry, in the order of THIRD-PARTY-NOTICES.md. */
export function licenceEntries() {
  const react = packageDir("react");
  const reactDom = packageDir("react-dom");
  const scheduler = packageDir("scheduler", requireFrom(reactDom));
  const geist = packageDir("@fontsource-variable/geist");
  const geistMono = packageDir("@fontsource-variable/geist-mono");
  const electron = packageDir("electron");
  const pdfjs = packageDir("pdfjs-dist");
  const tesseract = packageDir("tesseract.js");
  const fromTesseract = requireFrom(tesseract);
  const core = packageDir("tesseract.js-core", fromTesseract);

  const pkg = (title, dir, licence, source) => ({
    title: `${title} ${version(dir)}`,
    licence,
    source,
    file: licenceFile(dir),
  });
  const file = (title, path, licence, source) => ({
    title,
    licence,
    source,
    file: path,
  });

  const pdfjsWasm = ["LICENSE_JBIG2", "LICENSE_OPENJPEG", "LICENSE_QCMS"].map(
    (name) => join(pdfjs, "wasm", name),
  );
  const pdfjsBuilds = [
    "LICENSE_PDFJS_JBIG2",
    "LICENSE_PDFJS_OPENJPEG",
    "LICENSE_PDFJS_QCMS",
  ].map((name) => join(pdfjs, "wasm", name));

  return [
    pkg(
      "Geist (font), @fontsource-variable/geist",
      geist,
      "OFL-1.1",
      "https://github.com/vercel/geist-font",
    ),
    pkg(
      "Geist Mono (font), @fontsource-variable/geist-mono",
      geistMono,
      "OFL-1.1",
      "https://github.com/vercel/geist-font",
    ),
    pkg("React", react, "MIT", "https://github.com/facebook/react"),
    pkg("React DOM", reactDom, "MIT", "https://github.com/facebook/react"),
    pkg(
      "scheduler (inside React DOM)",
      scheduler,
      "MIT",
      "https://github.com/facebook/react",
    ),
    pkg(
      "Electron",
      electron,
      "MIT",
      "https://github.com/electron/electron. Chromium's and Node.js's own notices are in LICENSES.chromium.html beside the app",
    ),
    pkg(
      "PDF.js (pdfjs-dist)",
      pdfjs,
      "Apache-2.0",
      "https://github.com/mozilla/pdf.js",
    ),
    file(
      "PDF.js's Adobe CMaps (cmaps/)",
      join(pdfjs, "cmaps", "LICENSE"),
      "BSD-3-Clause",
      "https://github.com/adobe-type-tools/cmap-resources",
    ),
    file(
      "PDF.js's JBIG2 decoder (wasm/jbig2.wasm), from PDFium",
      pdfjsWasm[0],
      "BSD-3-Clause",
      "https://pdfium.googlesource.com/pdfium",
    ),
    file(
      "PDF.js's JBIG2 decoder, Mozilla's build",
      pdfjsBuilds[0],
      "Apache-2.0",
      "https://github.com/mozilla/pdf.js",
    ),
    file(
      "PDF.js's JPEG 2000 decoder (wasm/openjpeg.wasm), from OpenJPEG",
      pdfjsWasm[1],
      "BSD-2-Clause",
      "https://github.com/uclouvain/openjpeg",
    ),
    file(
      "PDF.js's JPEG 2000 decoder, Mozilla's build",
      pdfjsBuilds[1],
      "BSD-2-Clause",
      "https://github.com/mozilla/pdf.js",
    ),
    file(
      "PDF.js's colour profiles (wasm/qcms_bg.wasm), from qcms",
      pdfjsWasm[2],
      "MIT",
      "https://github.com/FirefoxGraphics/qcms",
    ),
    file(
      "PDF.js's colour profiles, Mozilla's build",
      pdfjsBuilds[2],
      "MIT",
      "https://github.com/mozilla/pdf.js",
    ),
    pkg(
      "Tesseract.js",
      tesseract,
      "Apache-2.0",
      "https://github.com/naptha/tesseract.js",
    ),
    pkg(
      "regenerator-runtime (inside Tesseract.js)",
      packageDir("regenerator-runtime", fromTesseract),
      "MIT",
      "https://github.com/facebook/regenerator",
    ),
    pkg(
      "zlib.js (inside Tesseract.js)",
      packageDir("zlibjs", fromTesseract),
      "MIT",
      "https://github.com/imaya/zlib.js",
    ),
    pkg(
      "bmp-js (inside Tesseract.js)",
      packageDir("bmp-js", fromTesseract),
      "MIT",
      "https://github.com/shaozilee/bmp-js",
    ),
    pkg(
      "idb-keyval (inside Tesseract.js)",
      packageDir("idb-keyval", fromTesseract),
      "Apache-2.0",
      "https://github.com/jakearchibald/idb-keyval",
    ),
    pkg(
      "wasm-feature-detect (inside Tesseract.js)",
      packageDir("wasm-feature-detect", fromTesseract),
      "Apache-2.0",
      "https://github.com/GoogleChromeLabs/wasm-feature-detect",
    ),
    ...BUNDLED_IN_TESSERACT_WORKER,
    pkg(
      "Tesseract.js Core: Tesseract and Leptonica compiled to WebAssembly",
      core,
      "Apache-2.0 (Tesseract, Tesseract.js Core); Leptonica and the image libraries it uses carry their own notices",
      "https://github.com/naptha/tesseract.js-core",
    ),
  ];
}

const RULE = "=".repeat(78);

/** The whole file, as text. Throws when a licence text cannot be found. */
export function licencesText() {
  const parts = [
    "OpenStellarFirm: licences of the work of others inside this app",
    "",
    "OpenStellarFirm itself is licensed under the Apache License 2.0 with the",
    "Commons Clause; see LICENSE and NOTICE. This file holds the full licence text",
    "of each piece of other people's work that ships inside the app. The short",
    "list, and where each one comes from, is in THIRD-PARTY-NOTICES.md.",
    "",
    "Tesseract's English trained data (eng.traineddata, from tessdata_fast) and",
    "the reading languages you can download are the Tesseract project's own,",
    "under the Apache License 2.0, the same text as for Tesseract.js below.",
  ];
  for (const entry of licenceEntries()) {
    const text = entry.text ?? readFileSync(entry.file, "utf8");
    if (!text.trim()) throw new Error(`Empty licence text for ${entry.title}`);
    parts.push(
      "",
      RULE,
      entry.title,
      `Licence: ${entry.licence}`,
      `From: ${entry.source}`,
      RULE,
      "",
      text.replace(/\r\n/g, "\n").trimEnd(),
    );
  }
  return `${parts.join("\n")}\n`;
}

/** Writes the file, by default to dist/THIRD-PARTY-LICENSES.txt. */
export async function writeLicences(
  out = join(root, "dist", "THIRD-PARTY-LICENSES.txt"),
) {
  const text = licencesText();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  return out;
}

// Run on its own: node scripts/licences.mjs [out file]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await writeLicences(process.argv[2]);
  if (!existsSync(out)) throw new Error(`Could not write ${out}`);
  console.log(`Wrote ${out}`);
}
