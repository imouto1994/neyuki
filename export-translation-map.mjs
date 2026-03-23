/**
 * Export Translation Map
 *
 * Reads original and translated merged chunks, parses them into matching
 * sections, and builds a JSON mapping of every unique original line to its
 * translated counterpart.
 *
 * Speech lines (＃ source + content) are merged into a single entry:
 *
 *   key:   "重明\n「華穂、セックスがしたい」"
 *   value: "Shigeaki: \u201CKaho, I want to have sex\u201D"
 *
 *   key:   "重明\n（え……普段言うような事を、ここで言うのか？）"
 *   value: "Shigeaki: \u201CHuh... we're saying that here?\u201D"
 *
 * Narration lines are mapped directly:
 *
 *   key:   "ぐちょ、ぐちょっと……"
 *   value: "With a squelching sound..."
 *
 * Empty lines are skipped. First occurrence wins for duplicates.
 *
 * Output: `translation-map.json`
 *
 * Usage:
 *   node export-translation-map.mjs
 */

import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";

const ORIGINAL_CHUNKS_DIR = "original-merged-chunks";
const TRANSLATED_CHUNKS_DIR = "translated-merged-chunks";
const OUTPUT_FILE = "translation-map.json";

/**
 * Read and concatenate all chunk files from a directory.
 */
async function readChunks(dir) {
  const files = (await glob(`${dir}/part-*.txt`)).sort();
  const parts = await Promise.all(files.map((f) => readFile(f, "utf-8")));
  return parts.join("\n");
}

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";


/**
 * Parse a merged text file into a Map of { fileName → lines[] },
 * preserving empty lines so indices stay aligned between original and
 * translated.
 */
function parseSections(text) {
  // Step 1: Split file into raw blocks by the section separator line.
  // Each section starts with "--------------------\n" (including the first).
  const raw = text.split(`${SECTION_SEPARATOR}\n`);
  const sections = new Map();

  for (const block of raw) {
    // Step 2: Locate the header separator to split filename from body.
    const headerEnd = block.indexOf(`\n${HEADER_SEPARATOR}\n`);
    if (headerEnd === -1) continue;

    const fileName = block.slice(0, headerEnd).trim();
    const body = block.slice(headerEnd + HEADER_SEPARATOR.length + 2);

    // Step 3: Keep all lines (including empty) to preserve index alignment.
    sections.set(fileName, body.split("\n"));
  }

  return sections;
}

async function main() {
  // Step 1: Read and concatenate all chunks from both directories.
  const originalText = await readChunks(ORIGINAL_CHUNKS_DIR);
  const translatedText = await readChunks(TRANSLATED_CHUNKS_DIR);

  // Step 2: Parse into section maps keyed by filename.
  const origSections = parseSections(originalText);
  const transSections = parseSections(translatedText);

  const map = new Map();
  let totalPairs = 0;
  let duplicates = 0;

  // Step 3: Walk through each section, pairing original and translated lines.
  for (const [fileName, origLines] of origSections) {
    if (!transSections.has(fileName)) continue;
    const transLines = transSections.get(fileName);

    let i = 0;
    while (i < origLines.length && i < transLines.length) {
      const origLine = origLines[i];
      const transLine = transLines[i];

      // Step 3a: Skip empty lines.
      if (origLine.length === 0) {
        i++;
        continue;
      }

      // Step 3b: Handle speech lines (＃ source + content on next line).
      // Key joins original source and content with \n.
      // Value joins translated source and content with ": ".
      if (origLine.startsWith("＃")) {
        if (i + 1 < origLines.length && i + 1 < transLines.length) {
          const key = `${origLine.slice(1)}\n${origLines[i + 1]}`;
          const value = `${transLine.slice(1)}: ${transLines[i + 1]}`;

          if (!map.has(key)) {
            map.set(key, value);
            totalPairs++;
          } else {
            duplicates++;
          }

          i += 2;
        } else {
          i++;
        }
        continue;
      }

      // Step 3c: Handle narration lines — map original directly to translated.
      if (!map.has(origLine)) {
        map.set(origLine, transLine);
        totalPairs++;
      } else {
        duplicates++;
      }

      i++;
    }
  }

  // Step 4: Write the translation map to disk as JSON.
  const obj = Object.fromEntries(map);
  await writeFile(OUTPUT_FILE, JSON.stringify(obj, null, 2), "utf-8");

  // Step 5: Print summary.
  console.log("— Summary —");
  console.log(`  Sections processed: ${origSections.size}`);
  console.log(`  Unique entries:     ${totalPairs}`);
  console.log(`  Duplicates skipped: ${duplicates}`);
  console.log(`  Exported to:        ${OUTPUT_FILE}`);
}

main().catch(console.error);
