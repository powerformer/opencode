import { Context, Predicate } from "effect"
import { constants } from "node:os"

export type Event = {
  phase:
    | "spawn_requested"
    | "spawn"
    | "spawn_error"
    | "exit"
    | "close"
    | "stdout_close"
    | "stderr_close"
    | "kill_requested"
    | "kill_sent"
    | "kill_failed"
    | "release_started"
    | "release_finished"
    | "deadline"
    | "abort_observed"
    | "kill_settled"
    | "output_consumer_finished"
    | "output_sink_close_requested"
    | "output_sink_settled"
    | "executor_settled"
  outcome?: "success" | "failure" | "interrupted"
  pid?: number
  stdout_closed?: boolean
  stderr_closed?: boolean
  code?: number | null
  signal?: string | null
  target?: "group" | "process"
  mechanism?: "taskkill" | "process_group" | "process_signal"
  error?: ReturnType<typeof errorChain>
}

// Read at spawn time, never at layer construction: concurrent tools must not
// inherit each other's observer or correlation identifiers.
export const Observer = Context.Reference<((event: Event) => void) | undefined>("@opencode/ProcessDiagnostics", {
  defaultValue: () => undefined,
})

export function record(observer: ((event: Event) => void) | undefined, event: Event) {
  // A diagnostic sink must not turn a native process callback into an exception.
  try {
    observer?.(event)
  } catch {}
}

const types = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "AbortError",
  "SystemError",
  "PlatformError",
  "BadArgument",
  "SqlError",
  "SqliteError",
  "SQLiteError",
  "UnknownError",
  "ConstraintError",
  "ConnectionError",
  "ToolFailure",
  "ToolInvalidArgumentsError",
])
const codes = new Set([
  ...Object.keys(constants.errno),
  "ABORT_ERR",
  "ERR_STREAM_PREMATURE_CLOSE",
  ...[
    "ERROR",
    "INTERNAL",
    "PERM",
    "ABORT",
    "BUSY",
    "LOCKED",
    "NOMEM",
    "READONLY",
    "INTERRUPT",
    "IOERR",
    "CORRUPT",
    "NOTFOUND",
    "FULL",
    "CANTOPEN",
    "PROTOCOL",
    "EMPTY",
    "SCHEMA",
    "TOOBIG",
    "CONSTRAINT",
    "MISMATCH",
    "MISUSE",
    "NOLFS",
    "AUTH",
    "FORMAT",
    "RANGE",
    "NOTADB",
    "NOTICE",
    "WARNING",
    "BUSY_RECOVERY",
    "BUSY_SNAPSHOT",
    "BUSY_TIMEOUT",
    "LOCKED_SHAREDCACHE",
    "LOCKED_VTAB",
    "CONSTRAINT_CHECK",
    "CONSTRAINT_FOREIGNKEY",
    "CONSTRAINT_NOTNULL",
    "CONSTRAINT_PRIMARYKEY",
    "CONSTRAINT_TRIGGER",
    "CONSTRAINT_UNIQUE",
    "CONSTRAINT_ROWID",
    "CONSTRAINT_DATATYPE",
    "IOERR_READ",
    "IOERR_SHORT_READ",
    "IOERR_WRITE",
    "IOERR_FSYNC",
    "IOERR_LOCK",
    "IOERR_NOMEM",
  ].map((code) => `SQLITE_${code}`),
])

/** Only bounded types/codes survive. Never inspect messages, stacks, SQL or paths. */
export function errorChain(error: unknown) {
  try {
    const result: { type: string; code?: string; errno?: number }[] = []
    const seen = new Set<object>()
    let current = error
    while (Predicate.isObject(current) && result.length < 4 && !seen.has(current)) {
      seen.add(current)
      const value = current
      const name = typeof value._tag === "string" ? value._tag : value.name
      result.push({
        type: typeof name === "string" && types.has(name) ? name : "UnknownError",
        ...(typeof value.code === "string" && codes.has(value.code) ? { code: value.code } : {}),
        ...(typeof value.errno === "number" && Number.isSafeInteger(value.errno) ? { errno: value.errno } : {}),
      })
      current = value.reason ?? value.cause ?? value.error
    }
    return result
  } catch {
    // Error objects supplied by plugins can contain throwing property getters.
    return []
  }
}

export * as ProcessDiagnostics from "./process-diagnostics"
