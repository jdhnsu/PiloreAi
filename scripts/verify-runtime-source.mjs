import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const runtimePackages = [
  ["pi-telemetry", "@pilore/pi-telemetry"],
  ["pi-ai", "@pilore/pi-ai"],
  ["pi-agent-core", "@pilore/pi-agent-core"],
];
const forbidden = /@earendil-works\/(?:pi-agent-core|pi-ai|pi-telemetry)/g;
const scanRoots = [
  "src",
  "tests",
  "scripts",
  "examples",
  "packages/pi-telemetry/src",
  "packages/pi-telemetry/test",
  "packages/pi-ai/src",
  "packages/pi-ai/test",
  "packages/pi-ai/scripts",
  "packages/pi-agent-core/src",
  "packages/pi-agent-core/test",
  "packages/pi-agent-core/scripts",
];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md"]);
const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (textExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

for (const [directory, expectedName] of runtimePackages) {
  const manifestPath = path.join(root, "packages", directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== expectedName) {
    errors.push(`${path.relative(root, manifestPath)}: expected name ${expectedName}`);
  }
  if (manifest.version !== "0.84.1-pilore.0") {
    errors.push(`${path.relative(root, manifestPath)}: unexpected baseline version ${manifest.version}`);
  }
  for (const required of ["src", "dist", "LICENSE", "UPSTREAM.md"]) {
    try {
      await stat(path.join(root, "packages", directory, required));
    } catch {
      errors.push(`packages/${directory}: missing ${required}; run npm run build:runtime for dist`);
    }
  }
}

for (const scanRoot of scanRoots) {
  for (const file of await walk(path.join(root, scanRoot))) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(forbidden)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      errors.push(`${path.relative(root, file)}:${line}: imports legacy package ${match[0]}`);
    }
  }
}

const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const [, name] of runtimePackages.slice(1)) {
  if (rootManifest.dependencies?.[name] !== "0.84.1-pilore.0") {
    errors.push(`package.json: ${name} must use exact workspace version 0.84.1-pilore.0`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Runtime source workspace verified: package identity, baseline, build output, and imports are consistent.");
}
