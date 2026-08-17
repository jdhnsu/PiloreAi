import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageAliases = { telemetry: "pi-telemetry", ai: "pi-ai", agent: "pi-agent-core" };
const repositories = {
  telemetry: "https://github.com/jdhnsu/pilore-pi-telemetry.git",
  ai: "https://github.com/jdhnsu/pilore-pi-ai.git",
  agent: "https://github.com/jdhnsu/pilore-pi-agent-core.git",
};

function parseArgs(argv) {
  const options = { package: "all", output: ".artifacts/runtime-mirrors", clean: false };
  for (const arg of argv) {
    if (arg === "--clean") options.clean = true;
    else if (arg.startsWith("--package=")) options.package = arg.slice(10);
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg.startsWith("--telemetry-ref=")) options.telemetryRef = arg.slice(16);
    else if (arg.startsWith("--ai-ref=")) options.aiRef = arg.slice(9);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(options.package in packageAliases) && options.package !== "all") {
    throw new Error("--package must be telemetry, ai, agent, or all");
  }
  return options;
}

function requireCommit(value, flag, packageName) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? "")) {
    throw new Error(`${packageName} export requires ${flag}=<40-character mirror commit SHA>`);
  }
}

async function exportPackage(key, outputRoot, options) {
  const directory = packageAliases[key];
  if (key === "ai") requireCommit(options.telemetryRef, "--telemetry-ref", "pi-ai");
  if (key === "agent") {
    requireCommit(options.telemetryRef, "--telemetry-ref", "pi-agent-core");
    requireCommit(options.aiRef, "--ai-ref", "pi-agent-core");
  }

  const source = path.join(root, "packages", directory);
  const destination = path.join(outputRoot, directory);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes("node_modules"),
  });

  const manifestPath = path.join(destination, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.repository = { type: "git", url: `git+${repositories[key]}` };
  if (manifest.dependencies?.["@pilore/pi-telemetry"]) {
    manifest.dependencies["@pilore/pi-telemetry"] = `git+${repositories.telemetry}#${options.telemetryRef}`;
  }
  if (manifest.dependencies?.["@pilore/pi-ai"]) {
    manifest.dependencies["@pilore/pi-ai"] = `git+${repositories.ai}#${options.aiRef}`;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(destination, "MIRROR.md"),
    `# Generated mirror\n\nThis tree is exported from \`jdhnsu/PiloreAi/packages/${directory}\`. ` +
      "Do not edit the mirror directly; make changes in PiLore and export again.\n",
  );
  console.log(`${manifest.name} -> ${path.relative(root, destination)}`);
}

const options = parseArgs(process.argv.slice(2));
const outputRoot = path.resolve(root, options.output);
if (options.clean) await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const selected = options.package === "all" ? ["telemetry", "ai", "agent"] : [options.package];
for (const key of selected) await exportPackage(key, outputRoot, options);
