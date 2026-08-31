import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Path, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { LayerNode } from "../../src/effect/layer-node"
import { LayerNodePlatform } from "../../src/effect/app-node-platform"
import { CrossSpawnSpawner } from "../../src/cross-spawn-spawner"
import { ProcessDiagnostics } from "../../src/process-diagnostics"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, LayerNodePlatform.path])),
)

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
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped()
    // An explicit missing shell fails before spawn on both Windows and POSIX.
    const exit = yield* ChildProcess.make("nonexistent-n5-fixture-command", [], {
      shell: path.join(directory, "nonexistent-n5-fixture-shell"),
    }).pipe(
      Effect.provideService(ProcessDiagnostics.Observer, (event) => events.push(event)),
      Effect.exit,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(events.some((event) => event.phase === "spawn")).toBe(false)
    expect(events.find((event) => event.phase === "spawn_error")?.error).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ENOENT" })]),
    )
    expect(JSON.stringify(events)).not.toContain("nonexistent-n5-fixture-command")
    expect(JSON.stringify(events)).not.toContain("nonexistent-n5-fixture-shell")
    expect(JSON.stringify(events)).not.toContain(directory)
    if (Exit.isFailure(exit)) {
      expect(ProcessDiagnostics.errorChain(Cause.squash(exit.cause))).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "ENOENT" })]),
      )
    }
  }),
)

it.live("retains missing-command diagnostics after process settlement", () =>
  Effect.gen(function* () {
    const events: ProcessDiagnostics.Event[] = []
    const exit = yield* Effect.gen(function* () {
      const handle = yield* ChildProcess.make("nonexistent-n5-fixture-command")
      // Windows can spawn cmd.exe before cross-spawn reports the missing command.
      return yield* handle.exitCode
    }).pipe(
      Effect.scoped,
      Effect.provideService(ProcessDiagnostics.Observer, (event) => events.push(event)),
      Effect.exit,
    )
    expect(Exit.isFailure(exit) ? true : exit.value !== ExitCode(0)).toBe(true)
    expect(events.find((event) => event.phase === "spawn_error")?.error).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ENOENT" })]),
    )
    expect(JSON.stringify(events)).not.toContain("nonexistent-n5-fixture-command")
  }),
)

it.live("records a shell command failure after a successful spawn", () =>
  Effect.gen(function* () {
    const events: ProcessDiagnostics.Event[] = []
    const code = yield* Effect.gen(function* () {
      // cross-spawn reserves exit code 1 for synthetic ENOENT on Windows.
      const handle = yield* ChildProcess.make("exit", ["7"], { shell: true })
      return yield* handle.exitCode
    }).pipe(
      Effect.scoped,
      Effect.provideService(ProcessDiagnostics.Observer, (event) => events.push(event)),
    )
    expect(code).toBe(ExitCode(7))
    expect(events.map((event) => event.phase)).toEqual(
      expect.arrayContaining(["spawn_requested", "spawn", "exit", "close", "release_finished"]),
    )
    expect(events.some((event) => event.phase === "spawn_error")).toBe(false)
    expect(events.find((event) => event.phase === "exit")?.code).toBe(7)
    expect(events.find((event) => event.phase === "close")?.code).toBe(7)
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
