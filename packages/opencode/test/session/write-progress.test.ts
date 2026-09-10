import { expect, test, spyOn } from "bun:test"
import { Effect } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { WriteProgress } from "@/session/write-progress"

test("Write tracker counts suppressed UTF-8 input, bounds calls, and clears attempts", async () => {
  const records: WriteProgress.Record[] = []
  const events = {
    publish: (_: unknown, data: WriteProgress.Record) => Effect.sync(() => records.push(data)),
  } as unknown as EventV2Bridge.Service["Service"]
  const tracker = WriteProgress.tracker(events, { sessionID: "session", messageID: "assistant" })
  const now = spyOn(Date, "now").mockReturnValue(1000)
  try {
    await Effect.runPromise(tracker.observe("call", "input_started"))
    for (let i = 0; i < 200; i++) await Effect.runPromise(tracker.observe("call", "input_progress", "你"))
    expect(records.filter((e) => e.phase === "input_progress")).toHaveLength(1)
    await Effect.runPromise(tracker.finish("stream_failed"))
    expect(records.at(-1)).toMatchObject({
      inputBytes: 600,
      deltaCount: 200,
      inputEnded: false,
      errorKind: "stream_error",
    })
    expect(JSON.stringify(records)).not.toContain("你")
    await Effect.runPromise(tracker.observe("call", "input_started"))
    expect(records.at(-1)).toMatchObject({ inputBytes: 0, deltaCount: 0 })
    const before = records.length
    for (let i = 0; i < 100; i++) await Effect.runPromise(tracker.observe(String(i), "input_started"))
    expect(records.length - before).toBe(63)
  } finally {
    now.mockRestore()
  }
})

test("Write reporting ignores sink defects and classifies errors without their prose", async () => {
  const events = {
    publish: () => Effect.die(new Error("broken diagnostic sink")),
  } as unknown as EventV2Bridge.Service["Service"]
  await Effect.runPromise(
    WriteProgress.report(events, { sessionID: "session", messageID: "assistant", callID: "call" }, "input_started"),
  )
  expect(WriteProgress.errorKind({ _tag: "ToolInvalidArgumentsError", detail: "SECRET" })).toBe("schema_invalid")
  expect(WriteProgress.errorKind({ cause: { name: "AI_JSONParseError", message: "SECRET" } })).toBe("json_invalid")
  expect(WriteProgress.errorKind("SECRET")).toBe("tool_error")
})
