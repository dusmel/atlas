import { expect, test } from "bun:test"
import { SHARE_ELSEWHERE, shareView } from "../src/server/doc-files"

test("a shared page keeps its anchors and outside links, sends every other link to the share 404, and hides its chrome", async () => {
  const page = `<html><head></head><body><a href="#log">a</a><a href="../plan.html">b</a><a href="/r/web/x.html">c</a><a href="https://example.com">d</a><a href="mailto:x@example.com">e</a><a href="//cdn.example.com/x">f</a><a href="?v=2">g</a></body></html>`
  const out = await (await shareView(new Response(page, { headers: { "content-type": "text/html" } }))).text()
  expect([...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1])).toEqual(["#log", SHARE_ELSEWHERE, SHARE_ELSEWHERE, "https://example.com", "mailto:x@example.com", "//cdn.example.com/x", SHARE_ELSEWHERE])
  expect(out).toEndWith("[data-atlas-chrome],[data-atlas-related],details.props,.topbar,section.related{display:none!important}</style>")
})
