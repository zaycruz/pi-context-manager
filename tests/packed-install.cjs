#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createJiti } = require("jiti");

const repo = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-context-manager-pack-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function linkHostPeer(consumer, name) {
  const source = path.join(repo, "node_modules", name);
  const destination = path.join(consumer, "node_modules", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.symlinkSync(source, destination, "dir");
}

(async () => {
  try {
    const packOutput = JSON.parse(
      run("npm", ["pack", "--json", "--pack-destination", temp], repo),
    );
    assert.equal(packOutput.length, 1);
    const packedFiles = packOutput[0].files.map((file) => file.path);
    assert.ok(packedFiles.includes("extensions/context-manager.ts"));
    assert.ok(packedFiles.includes("extensions/context-policy.ts"));
    assert.ok(packedFiles.includes("skills/context-manager/SKILL.md"));
    assert.ok(packedFiles.includes("README.md"));
    assert.ok(packedFiles.includes("CHANGELOG.md"));
    assert.ok(packedFiles.includes("LICENSE"));
    assert.ok(packedFiles.includes("package.json"));
    assert.equal(packedFiles.some((file) => file.startsWith("tests/")), false);
    assert.equal(packedFiles.some((file) => file.startsWith("node_modules/")), false);

    const consumer = path.join(temp, "consumer");
    fs.mkdirSync(consumer);
    fs.writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "packed-consumer", private: true }, null, 2),
    );
    const tarball = path.join(temp, packOutput[0].filename);
    run("npm", ["install", "--ignore-scripts", "--omit=peer", tarball], consumer);

    const installed = path.join(consumer, "node_modules", "@zaycruz", "pi-context-manager");
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
    assert.equal(manifest.name, "@zaycruz/pi-context-manager");
    assert.equal(manifest.version, "1.1.0");
    assert.deepEqual(manifest.pi.extensions, ["./extensions/context-manager.ts"]);
    assert.deepEqual(manifest.pi.skills, ["./skills/context-manager/SKILL.md"]);
    assert.deepEqual(manifest.peerDependencies, {
      "@earendil-works/pi-agent-core": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });

    for (const peer of [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-coding-agent",
      "typebox",
    ]) {
      linkHostPeer(consumer, peer);
    }

    const handlers = new Map();
    const tools = [];
    const extensionPath = path.join(installed, "extensions", "context-manager.ts");
    const jiti = createJiti(__filename);
    const loaded = await jiti.import(extensionPath);
    const contextManager = loaded.default ?? loaded;
    contextManager({
      on: (event, handler) => handlers.set(event, handler),
      registerTool: (tool) => tools.push(tool),
      appendEntry: () => {},
    });
    assert.ok(handlers.has("context"));
    assert.ok(handlers.has("session_before_compact"));
    assert.deepEqual(tools.map((tool) => tool.name), ["manage_context"]);

    console.log("ok - packed artifact installs and loads through host-provided peers");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
