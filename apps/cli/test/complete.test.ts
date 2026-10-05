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
    expect(await complete(["todo", "list", "--status", ""])).toEqual(["todo", "doing", "done"]);
    expect(await complete(["todo", "set", "4", "--priority", ""])).toContain("inbox");
    expect(await complete(["status", "--repo", ""])).toEqual(["!dirs"]);
    expect(await complete(["todo", "add", "--body", ""])).toEqual([]);
    expect(await complete(["nope", ""])).toEqual([]);
  });

  test("the zsh script asks atlas for its candidates", () => {
    expect(ZSH_SCRIPT).toStartWith("#compdef atlas");
    expect(ZSH_SCRIPT).toContain('atlas __complete "${(@)words[2,CURRENT]}"');
  });
});
