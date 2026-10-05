import { expect, test } from "bun:test";
import { authorOf } from "../src/todo/client.ts";

test("the author: ATLAS_AUTHOR, then the agent's marker, then me at a terminal, else a script", () => {
  expect(authorOf({ ATLAS_AUTHOR: "opencode", AI_AGENT: "claude-code_2-1-282_agent" }, true)).toBe("opencode");
  expect(authorOf({ AI_AGENT: "claude-code_2-1-282_agent" }, true)).toBe("claude-code");
  expect(authorOf({ CLAUDECODE: "1" }, false)).toBe("claude-code");
  expect(authorOf({}, true)).toBe("me");
  expect(authorOf({}, false)).toBe("script");
});
