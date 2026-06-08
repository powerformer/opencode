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
    for (const value of ["Here is `## user`", "## User Guide", "## userspace", "### user"]) {
      const guard = createRoleMarkerGuard()
      const result = guard.feed(value)

      expect(result.detection).toBeUndefined()
      expect(result.text + guard.flush().text).toBe(value)
    }
  })
})
