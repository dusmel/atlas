import { describe, expect, test } from "bun:test";
import { complete, ZSH_SCRIPT } from "../src/complete.ts";

describe("complete", () => {
  test("commands, then todo subcommands, with descriptions", async () => {
    expect(await complete([""])).toContain("todo:Todos on the Atlas server");
    expect(await complete(["todo", ""])).toContain("show:Show one todo");
    expect(await complete(["todo", "group", ""])).toEqual(["add:Add a group"]);
  });

  test("flags come from the parser's table and skip ones already typed", async () => {
    const flags = await complete(["todo", "list", "--all", "--"]);
    expect(flags).toContain("--status");
    expect(flags).toContain("--plain");
    expect(flags).not.toContain("--all");
    expect(await complete(["todo", "move", "66", "-"])).toContain("--before");
  });

  test("fixed values, folders for a repo path, nothing for free text", async () => {
    expect(await complete(["todo", "list", "--status", ""])).toEqual(["todo", "doing", "done", "all"]);
    expect(await complete(["todo", "add", "x", "--status", ""])).toEqual(["todo", "doing", "done"]);
    expect(await complete(["todo", "set", "4", "--priority", ""])).toContain("inbox");
    expect(await complete(["status", "--repo", ""])).toEqual(["!dirs"]);
    expect(await complete(["todo", "add", "--body", ""])).toEqual([]);
    expect(await complete(["nope", ""])).toEqual([]);
  });

  test("without a server config, server lookups give nothing instead of failing", async () => {
    const saved = { HOME: process.env.HOME, ATLAS_URL: process.env.ATLAS_URL, ATLAS_TOKEN: process.env.ATLAS_TOKEN };
    process.env.HOME = "/nonexistent";
    delete process.env.ATLAS_URL;
    delete process.env.ATLAS_TOKEN;
    try {
      expect(await complete(["todo", "add", "x", "--group", ""])).toEqual([]);
      expect(await complete(["todo", "show", ""])).toEqual([]);
      expect(await complete(["todo", "list", "--by", ""])).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("the zsh script asks atlas for its candidates", () => {
    expect(ZSH_SCRIPT).toStartWith("#compdef atlas");
    expect(ZSH_SCRIPT).toContain('atlas __complete "${(@)words[2,CURRENT]}"');
  });
});
