import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadServerAgentsMd, loadServerAgentsMdWithPath, resolveServerAgentsMdPath } from "../src/workspace/loadServerAgentsMd.js";

test("loadServerAgentsMd reads server-agents.md from the workspace root", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "crm-chat-server-agents-"));

  try {
    const agentsPath = resolveServerAgentsMdPath(workspaceRoot);

    await writeFile(agentsPath, "server contract", "utf8");
    assert.equal(await loadServerAgentsMd(workspaceRoot), "server contract");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("loadServerAgentsMdWithPath returns path metadata and tolerates a missing server-agents.md", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "crm-chat-server-agents-"));

  try {
    const loaded = await loadServerAgentsMdWithPath(workspaceRoot);

    assert.equal(loaded.path, resolveServerAgentsMdPath(workspaceRoot));
    assert.equal(loaded.content, null);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
