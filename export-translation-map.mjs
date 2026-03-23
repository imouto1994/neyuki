/**
 * Export Translation Map
 *
 * Reads `merged-original.txt` and `merged-translated.txt`, parses them into
 * matching sections, and builds a JSON mapping of every unique original line
 * to its translated counterpart.
 *
 * Speech source lines (＃ in original, # in translated) and their following
 * content lines are merged into a single entry:
 *
 *   Original:  ＃重明                    →  key:   "〈重明〉：華穂、セックスがしたい"
 *              「華穂、セックスがしたい」    value: "Shigeaki: \u201CKaho, I want to have sex\u201D"
 *
 *   Original:  ＃重明                    →  key:   "〈重明〉：え……普段言うような事を、ここで言うのか？"
 *              （え……普段言うような事を…）   value: "Shigeaki: \u201CHuh... we're saying that here?\u201D"
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

const SPEAKER_MAP = new Map([
  ["重明", "Shigeaki"],
  ["くす葉", "Kusuha"],
  ["華穂", "Kaho"],
  ["桔梗", "Kikyou"],
  ["撫子", "Nadeshiko"],
  ["藤子", "Fujiko"],
  ["筋肉質のオッサン", "Muscular Old Man"],
  ["尚人", "Naoto"],
  ["新聞を読むオッサン", "Newspaper Old Man"],
  ["調教師のオッサン", "Trainer Old Man"],
  ["オッサンＢ", "Old Man B"],
  ["オッサンＡ", "Old Man A"],
  ["客席のオッサンＦ", "Audience Old Man F"],
  ["客席のオッサンＥ", "Audience Old Man E"],
  ["客席のオッサンＧ", "Audience Old Man G"],
  ["？？？", "???"],
  ["女生徒", "Female Student"],
  ["客席のオッサンＢ", "Audience Old Man B"],
  ["オッサン", "Old Man"],
  ["客席のオッサンＡ", "Audience Old Man A"],
  ["客席のオッサンＣ", "Audience Old Man C"],
  ["客席のオッサンＤ", "Audience Old Man D"],
  ["オッサンＣ", "Old Man C"],
  ["重明＆華穂", "Shigeaki & Kaho"],
  ["太ったオッサン", "Fat Old Man"],
  ["？？？Ａ", "??? A"],
  ["華穂＆桔梗", "Kaho & Kikyou"],
  ["客席のオッサンＨ", "Audience Old Man H"],
  ["華穂のお父さん", "Kaho's Father"],
  ["華穂のお母さん", "Kaho's Mother"],
  ["？？？Ｂ", "??? B"],
  ["？？？Ｃ", "??? C"],
  ["？？？Ｄ", "??? D"],
  ["？？？Ｅ", "??? E"],
  ["重明＆？？？", "Shigeaki & ???"],
  ["重明＆くす葉", "Shigeaki & Kusuha"],
  ["真面目そうなオッサン", "Serious-looking Old Man"],
  ["撫子＆華穂", "Nadeshiko & Kaho"],
  ["オッサン達", "Old Men"],
  ["アナウンス", "Announcement"],
  ["客席のオッサン達", "Audience Old Men"],
  ["京香", "Kyouka"],
  ["？？？Ｆ", "??? F"],
  ["？？？Ｇ", "??? G"],
  ["桔梗＆くす葉", "Kikyou & Kusuha"],
]);

// Bracket pairs that can wrap speech content in the original.
const JP_BRACKET_PAIRS = [
  ["「", "」"],
  ["（", "）"],
  ["【", "】"],
];

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

/**
 * Strip any of the JP bracket pairs (「」, （）, 【】) from a speech content line.
 */
function stripBracketsJP(line) {
  for (const [open, close] of JP_BRACKET_PAIRS) {
    if (line.startsWith(open) && line.endsWith(close)) {
      return line.slice(1, -1);
    }
  }
  return line;
}

/**
 * Strip the \u201C\u201D curly quotes from an English speech content line.
 */
function stripBracketsEN(line) {
  if (line.startsWith("\u201C") && line.endsWith("\u201D")) {
    return line.slice(1, -1);
  }
  return line;
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
  const unknownSpeakers = new Set();

  // Step 3: Walk through each section, pairing original and translated lines.
  for (const [fileName, origLines] of origSections) {
    // Skip sections without a translated counterpart.
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
      // Original uses full-width ＃, translated uses half-width #.
      if (origLine.startsWith("＃")) {
        const speakerJP = origLine.slice(1);
        const speakerEN = SPEAKER_MAP.get(speakerJP);

        if (!speakerEN) {
          unknownSpeakers.add(speakerJP);
        }

        // Merge speaker + content into a single map entry.
        if (i + 1 < origLines.length && i + 1 < transLines.length) {
          const contentOrig = origLines[i + 1];
          const contentTrans = transLines[i + 1];

          // Key uses 〈name〉：content format, stripping JP brackets from original.
          const key = `〈${speakerJP}〉：${stripBracketsJP(contentOrig)}`;
          // Value uses EN name: \u201Ccontent\u201D, stripping translated quotes.
          const value = `${speakerEN || speakerJP}: \u201C${stripBracketsEN(contentTrans)}\u201D`;

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

  if (unknownSpeakers.size > 0) {
    console.log(
      `\n  Unknown speakers: ${[...unknownSpeakers].join(", ")}`,
    );
  }
}

main().catch(console.error);
