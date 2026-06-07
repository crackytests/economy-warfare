/**
 * prepare-art.mjs — copy/optimize source card art into the web bundle.
 *
 * Reads data/cards.json. For each card whose `art` field is set (filled by the
 * art-mapping agent, task A0), it takes the source image at
 * `<repo>/images/<art>` and writes an optimized copy to
 * `apps/web/public/cards/<id>.webp`.
 *
 * Optimization strategy (no required native deps):
 *   - If `sharp` is installed (optional devDependency), transcode → real .webp.
 *   - Otherwise, fall back to a PLAIN COPY preserving the source format, named
 *     `<id>.<ext>`, and record the actual filename in a generated manifest
 *     (public/cards/manifest.json) so the app can resolve the right URL.
 *
 * The script is no-op-safe: cards with `art: null` are skipped, a missing
 * source file is warned about (not fatal), and re-runs are idempotent.
 *
 * Runs automatically on `npm run build` (prebuild). Run manually:
 *   npm run prepare-art --workspace apps/web
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");
const CARDS_JSON = path.join(REPO_ROOT, "data", "cards.json");
const IMAGES_DIR = path.join(REPO_ROOT, "images");
const OUT_DIR = path.join(WEB_DIR, "public", "cards");

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const raw = await fs.readFile(CARDS_JSON, "utf8");
  const { cards } = JSON.parse(raw);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sharp = await loadSharp();
  const manifest = {};
  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const card of cards) {
    if (!card.art) {
      skipped++;
      continue; // no-op-safe: unmapped art
    }
    const srcPath = path.join(IMAGES_DIR, card.art);
    if (!(await exists(srcPath))) {
      console.warn(`[prepare-art] source missing for ${card.id}: ${card.art}`);
      missing++;
      continue;
    }

    if (sharp) {
      const outPath = path.join(OUT_DIR, `${card.id}.webp`);
      await sharp(srcPath)
        .resize({ width: 768, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outPath);
      manifest[card.id] = `${card.id}.webp`;
    } else {
      // Plain copy, preserve format. App resolves via manifest if not .webp.
      const ext = path.extname(card.art).toLowerCase() || ".png";
      const outName = `${card.id}${ext}`;
      await fs.copyFile(srcPath, path.join(OUT_DIR, outName));
      manifest[card.id] = outName;
    }
    copied++;
  }

  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  const mode = sharp ? "sharp→webp" : "plain copy (install sharp for webp)";
  console.log(
    `[prepare-art] ${mode}: copied ${copied}, skipped ${skipped} (null art), ${missing} missing source.`,
  );
}

main().catch((err) => {
  console.error("[prepare-art] failed:", err);
  process.exitCode = 1;
});
