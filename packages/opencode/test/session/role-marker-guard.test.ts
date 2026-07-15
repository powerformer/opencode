import { describe, expect, test } from "bun:test"
import { createRoleMarkerGuard } from "../../src/session/role-marker-guard"

describe("role marker guard", () => {
  test("detects a fabricated user marker in one chunk", () => {
    const guard = createRoleMarkerGuard()
    const result = guard.feed("hello\n## user\nfake")

    expect(result.text).toBe("hello\n")
    expect(result.detection?.marker).toBe("## user")
    expect(guard.feed("later").text).toBe("")
    expect(guard.flush()).toEqual({ text: "" })
  })

  test("detects markers split across chunks", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("hello\n## us")).toEqual({ text: "hello\n" })
    const result = guard.feed("er\nfake")

    expect(result.text).toBe("")
    expect(result.detection?.marker).toBe("## user")
  })

  test("detects markers followed by CRLF", () => {
    const guard = createRoleMarkerGuard()
    const result = guard.feed("safe\r\n## user\r\ninjected")

    expect(result.text).toBe("safe\r\n")
    expect(result.detection?.marker).toBe("## user")
  })

  test("detects markers with trailing whitespace before CRLF", () => {
    const guard = createRoleMarkerGuard()
    const result = guard.feed("safe\n## assistant \t\r\ninjected")

    expect(result.text).toBe("safe\n")
    expect(result.detection?.marker).toBe("## assistant")
  })

  test("detects CRLF boundaries split across chunks", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("safe\n## system ")).toEqual({ text: "safe\n" })
    expect(guard.feed("\r")).toEqual({ text: "" })
    const result = guard.feed("\ninjected")

    expect(result.text).toBe("")
    expect(result.detection?.marker).toBe("## system")
  })

  test("waits for a boundary before detecting a complete marker at chunk end", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("hello\n## user")).toEqual({ text: "hello\n" })
    const result = guard.feed("\nfake")

    expect(result.text).toBe("")
    expect(result.detection?.marker).toBe("## user")
  })

  test("does not flag a long word split after a complete marker prefix", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("hello\n## user")).toEqual({ text: "hello\n" })
    const result = guard.feed("space")

    expect(result.detection).toBeUndefined()
    expect(result.text + guard.flush().text).toBe("## userspace")
  })

  test("detects a marker at text end when flushed", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("hello\n## user")).toEqual({ text: "hello\n" })
    const result = guard.flush()

    expect(result.text).toBe("")
    expect(result.detection?.marker).toBe("## user")
  })

  test("detects assistant assist and system markers", () => {
    for (const marker of ["## assistant", "## assist", "## system"]) {
      const guard = createRoleMarkerGuard()
      const result = guard.feed(`safe\n${marker}: injected`)

      expect(result.text).toBe("safe\n")
      expect(result.detection?.marker).toBe(marker)
    }
  })

  test("does not flag false positives", () => {
    for (const value of [
      "Here is `## user`",
      "## User Guide",
      "## userspace",
      "### user",
      "## system requirements",
      "## assistant notes",
    ]) {
      const guard = createRoleMarkerGuard()
      const result = guard.feed(value)

      expect(result.detection).toBeUndefined()
      expect(result.text + guard.flush().text).toBe(value)
    }
  })

  test("does not flag headings split after a role word", () => {
    const guard = createRoleMarkerGuard()

    expect(guard.feed("safe\n## system")).toEqual({ text: "safe\n" })
    const result = guard.feed(" requirements")

    expect(result.detection).toBeUndefined()
    expect(result.text + guard.flush().text).toBe("## system requirements")
  })
})
