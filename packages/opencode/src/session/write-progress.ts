import { Cause, Effect, Schema } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { EventV2Bridge } from "@/event-v2-bridge"

export const Phases = [
  "input_started",
  "input_progress",
  "input_ended",
  "arguments_ready",
  "validation_failed",
  "execution_started",
  "permission_requested",
  "file_write_started",
  "file_write_finished",
  "postprocess_started",
  "execution_returned",
  "execution_failed",
  "result_observed",
  "stream_failed",
  "stream_finished",
  "interrupted",
] as const
export type Phase = (typeof Phases)[number]
export const Progress = Event.define({
  type: "session.write_progress",
  schema: {
    version: Schema.Literal(1),
    sessionID: Schema.String,
    messageID: Schema.String,
    callID: Schema.String,
    phase: Schema.Literals(Phases),
    atMs: Schema.Number,
    inputBytes: Schema.optional(Schema.Number),
    deltaCount: Schema.optional(Schema.Number),
    firstDeltaAtMs: Schema.optional(Schema.Number),
    lastDeltaAtMs: Schema.optional(Schema.Number),
    inputEnded: Schema.optional(Schema.Boolean),
    hasContent: Schema.optional(Schema.Boolean),
    hasFilePath: Schema.optional(Schema.Boolean),
    errorKind: Schema.optional(
      Schema.Literals(["schema_invalid", "json_invalid", "tool_error", "stream_error", "aborted"]),
    ),
  },
})
export type Record = typeof Progress.data.Type
export type Identity = { sessionID: string; messageID: string; callID?: string }

// Private version 1 event consumed by Vela. This is not a public SDK contract.
// Only fixed metadata crosses this boundary; no paths, source, or error prose.
export function report(
  events: EventV2Bridge.Service["Service"],
  identity: Identity,
  phase: Phase,
  facts: Partial<Omit<Record, keyof Identity | "phase" | "version" | "atMs">> = {},
) {
  if (!identity.callID || identity.callID.length > 256) return Effect.void
  return events
    .publish(Progress, {
      sessionID: identity.sessionID,
      messageID: identity.messageID,
      callID: identity.callID,
      version: 1,
      phase,
      atMs: Date.now(),
      ...facts,
    })
    .pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        () => Effect.void,
      ),
    )
}

export function tracker(events: EventV2Bridge.Service["Service"], identity: Omit<Identity, "callID">) {
  const calls = new Map<
    string,
    {
      inputBytes: number
      deltaCount: number
      inputEnded: boolean
      firstDeltaAtMs?: number
      lastDeltaAtMs?: number
      emittedAt: number
      emissions: number
    }
  >()
  return {
    has(id: string) {
      return calls.has(id)
    },
    observe(id: string, phase: Phase, text?: string, args?: unknown, errorKind?: Record["errorKind"]) {
      if (!calls.has(id)) {
        if (calls.size >= 64 || id.length > 256) return Effect.void
        calls.set(id, { inputBytes: 0, deltaCount: 0, inputEnded: false, emittedAt: 0, emissions: 0 })
      }
      const state = calls.get(id)!
      const now = Date.now()
      if (text !== undefined) {
        state.inputBytes = Math.min(Number.MAX_SAFE_INTEGER, state.inputBytes + Buffer.byteLength(text))
        state.deltaCount = Math.min(Number.MAX_SAFE_INTEGER, state.deltaCount + 1)
        state.firstDeltaAtMs ??= now
        state.lastDeltaAtMs = now
        if (state.deltaCount > 1 && (now - state.emittedAt < 5000 || state.emissions >= 120)) return Effect.void
      }
      if (phase === "input_ended") state.inputEnded = true
      state.emittedAt = now
      state.emissions++
      const fields =
        typeof args === "object" && args !== null ? (args as { content?: unknown; filePath?: unknown }) : undefined
      return report(events, { ...identity, callID: id }, phase, {
        inputBytes: state.inputBytes,
        deltaCount: state.deltaCount,
        inputEnded: state.inputEnded,
        ...(errorKind ? { errorKind } : {}),
        ...(state.firstDeltaAtMs !== undefined
          ? { firstDeltaAtMs: state.firstDeltaAtMs, lastDeltaAtMs: state.lastDeltaAtMs }
          : {}),
        ...(args !== undefined
          ? { hasContent: typeof fields?.content === "string", hasFilePath: typeof fields?.filePath === "string" }
          : {}),
      })
    },
    finish(phase: "stream_failed" | "stream_finished" | "interrupted") {
      return Effect.forEach(
        [...calls],
        ([callID, state]) =>
          report(events, { ...identity, callID }, phase, {
            inputBytes: state.inputBytes,
            deltaCount: state.deltaCount,
            inputEnded: state.inputEnded,
            ...(state.firstDeltaAtMs !== undefined
              ? { firstDeltaAtMs: state.firstDeltaAtMs, lastDeltaAtMs: state.lastDeltaAtMs }
              : {}),
            ...(phase === "stream_failed" ? { errorKind: "stream_error" as const } : {}),
          }),
        { discard: true },
      ).pipe(Effect.ensuring(Effect.sync(() => calls.clear())))
    },
  }
}

// Classify typed failures without storing their message, stack, arguments, or path.
export function errorKind(error: unknown): Record["errorKind"] {
  for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
    if ("_tag" in error && error._tag === "ToolInvalidArgumentsError") return "schema_invalid"
    if ("name" in error && error.name === "AI_JSONParseError") return "json_invalid"
    error = "cause" in error ? error.cause : undefined
  }
  return "tool_error"
}

export * as WriteProgress from "./write-progress"
