import { describe, expect, test } from "bun:test"
import { BRIDGE, withBridge } from "../src/server/bridge"

describe("withBridge", () => {
  test("goes first in <head>, before the doc's own scripts", () => {
    const out = withBridge('<!doctype html><html lang="en"><head data-x="1"><script>var a</script></head><body></body></html>')
    expect(out).toBe(`<!doctype html><html lang="en"><head data-x="1">${BRIDGE}<script>var a</script></head><body></body></html>`)
  })

  test("adds a <head> when the doc has none, and never mistakes <header> for it", () => {
    expect(withBridge("<html><body><header>x</header></body></html>")).toBe(`<html><head>${BRIDGE}</head><body><header>x</header></body></html>`)
    expect(withBridge("<!DOCTYPE html>\n<p>bare</p>")).toBe(`<!DOCTYPE html>${BRIDGE}\n<p>bare</p>`)
  })

  test("the script itself parses", () => {
    expect(() => new Function(BRIDGE.slice("<script>".length, -"</script>".length))).not.toThrow()
  })
})
