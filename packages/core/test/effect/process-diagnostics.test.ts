import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { LayerNode } from "../../src/effect/layer-node"
import { CrossSpawnSpawner } from "../../src/cross-spawn-spawner"
import { ProcessDiagnostics } from "../../src/process-diagnostics"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

it.live("isolates native lifecycle observers across concurrent processes", () =>
  Effect.gen(function* () {
    const events: ProcessDiagnostics.Event[][] = [[], []]
    yield* Effect.all(
      events.map((list, index) =>
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make(process.execPath, ["-e", `console.log(${index})`])
          const output = yield* Stream.mkString(Stream.decodeText(handle.all))
          expect(output.trim()).toBe(String(index))
          expect(yield* handle.exitCode).toBe(ExitCode(0))
        }).pipe(
          Effect.scoped,
          Effect.provideService(ProcessDiagnostics.Observer, (event) => list.push(event)),
        ),
      ),
      { concurrency: "unbounded" },
    )
    const pids = events.map((list) => new Set(list.flatMap((event) => (event.pid ? [event.pid] : []))))
    expect(pids[0].size).toBe(1)
    expect(pids[1].size).toBe(1)
    expect([...pids[0]][0]).not.toBe([...pids[1]][0])
    for (const list of events) {
      expect(list.map((event) => event.phase)).toEqual(
        expect.arrayContaining(["spawn_requested", "spawn", "exit", "close", "release_finished"]),
      )
      expect(list.at(-1)?.phase).toBe("release_finished")
    }
  }),
)

it.live("retains the native spawn error code without command or path data", () =>
  Effect.gen(function* () {
    const events: ProcessDiagnostics.Event[] = []
    const exit = yield* ChildProcess.make("nonexistent-n5-fixture-command").pipe(
      Effect.provideService(ProcessDiagnostics.Observer, (event) => events.push(event)),
      Effect.exit,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(events.find((event) => event.phase === "spawn_error")?.error).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ENOENT" })]),
    )
    expect(JSON.stringify(events)).not.toContain("nonexistent-n5-fixture-command")
    if (Exit.isFailure(exit)) {
      expect(ProcessDiagnostics.errorChain(Cause.squash(exit.cause))).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "ENOENT" })]),
      )
    }
  }),
)

it.live("a failing diagnostic observer cannot change process execution", () =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make(process.execPath, ["-e", "process.exit(0)"])
    expect(yield* handle.exitCode).toBe(ExitCode(0))
  }).pipe(
    Effect.provideService(ProcessDiagnostics.Observer, () => {
      throw new Error("fixture observer")
    }),
  ),
)

test("keeps a real SQLite constraint code through wrapped causes without SQL or values", () => {
  using database = new Database(":memory:")
  database.run("CREATE TABLE fixture (value TEXT UNIQUE)")
  database.run("INSERT INTO fixture VALUES (?)", ["private-fixture-value"])
  const failure = Effect.runSync(
    Effect.exit(
      Effect.try({
        try: () => database.run("INSERT INTO fixture VALUES (?)", ["private-fixture-value"]),
        catch: (error) => error,
      }),
    ),
  )
  expect(Exit.isFailure(failure)).toBe(true)
  if (Exit.isSuccess(failure)) return
  const chain = ProcessDiagnostics.errorChain(new Error("private SQL wrapper", { cause: Cause.squash(failure.cause) }))
  expect(chain).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" })]))
  expect(JSON.stringify(chain)).not.toMatch(/private|INSERT|fixture/)
})

test("bounds cyclic causes and rejects arbitrary error labels", () => {
  const error = { name: "private-token", code: "private-token", cause: {} }
  error.cause = error
  expect(ProcessDiagnostics.errorChain(error)).toEqual([{ type: "UnknownError" }])
  expect(
    ProcessDiagnostics.errorChain({
      get cause() {
        throw new Error("private")
      },
    }),
  ).toEqual([])
})
