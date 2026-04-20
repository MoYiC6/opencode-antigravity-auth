import { promises as fs } from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve("dist");

const JS_LIKE_EXTENSIONS = [".js", "/index.js"];

const IMPORT_EXPORT_RE = /((?:import|export)\s+(?:[^"'()]*?\s+from\s+)?|import\s*\()(["'])(\.{1,2}\/[^"']*)(\2)/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return [fullPath];
    }),
  );
  return files.flat();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSpecifier(filePath, specifier, extensionCandidates) {
  if (path.extname(specifier)) {
    return specifier;
  }

  const basePath = path.resolve(path.dirname(filePath), specifier);
  for (const suffix of extensionCandidates) {
    if (await exists(`${basePath}${suffix}`)) {
      return `${specifier}${suffix}`;
    }
  }

  return specifier;
}

async function rewriteFile(filePath) {
  const extensionCandidates = JS_LIKE_EXTENSIONS;
  const original = await fs.readFile(filePath, "utf8");

  let changed = false;
  let rewritten = "";
  let lastIndex = 0;

  for (const match of original.matchAll(IMPORT_EXPORT_RE)) {
    const [fullMatch, prefix, quote, specifier, suffixQuote] = match;
    const matchIndex = match.index ?? 0;
    const resolved = await resolveSpecifier(filePath, specifier, extensionCandidates);

    rewritten += original.slice(lastIndex, matchIndex);
    if (resolved !== specifier) {
      changed = true;
      rewritten += `${prefix}${quote}${resolved}${suffixQuote}`;
    } else {
      rewritten += fullMatch;
    }
    lastIndex = matchIndex + fullMatch.length;
  }

  if (!changed) {
    return false;
  }

  rewritten += original.slice(lastIndex);
  await fs.writeFile(filePath, rewritten);
  return true;
}

async function main() {
  const files = await walk(DIST_DIR);
  const targets = files.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"));
  let changedFiles = 0;

  for (const filePath of targets) {
    if (await rewriteFile(filePath)) {
      changedFiles += 1;
    }
  }

  console.log(`Rewrote ESM specifiers in ${changedFiles} files`);
}

main().catch((error) => {
  console.error("Failed to rewrite ESM import specifiers");
  console.error(error);
  process.exitCode = 1;
});
