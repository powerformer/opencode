# Powerformer tool execution diagnostics

This is observation, not a change to shell deadlines, signal escalation, retries,
or output draining. A returned tool result does not imply a successful command.

## Runtime path and release

The Powerformer `powerformer-v1.18.1` **branch** is the integration base. Vela CLI
0.0.34's published runtime manifest selects this branch at
`c45f263795a4645fd1e7a42a812fac0ba5ab0968`. The fork's default `dev` branch is not
the runtime integration branch. Merging this change does not update any shipped
binary: a subsequent Vela release must build the new branch commit, record its
commit and platform digests, and be distributed through Open Design. If the
release is pinned to the old commit, it does not include this change.

The active legacy path is `session/tools.ts` → `tool/registry.ts` → `ShellTool`
(`tool/shell/id.ts` keeps the public ID `bash`) → core `CrossSpawnSpawner`.
The V2 core Bash implementation is not changed. Correlation uses the existing
session ID, assistant message ID and tool call ID; no AMR run ID is inferred.

Vela uses the HTTP/SSE path, **not OpenCode's native ACP adapter**. In Vela
0.0.34 and main `e88cd4253d08ded6c86b78ab1509f5c95f333c41`,
`apps/cli/internal/agent/opencode_client.go` decodes `state.metadata`, but the
call to `mapOpenCodeToolPart` at line 1015 does not pass it. That function at
line 1262 forwards only output/error as RawOutput. A separate Vela adapter
change must carry the allowlisted `execution` and `toolTerminal` fields for
running/completed/error events, retain source semantics, and include changing
diagnostics in its deduplication/bounded-payload logic. Until then, these fields
are available in OpenCode logs, persisted metadata/SSE and native ACP, **not
through the current Vela-to-Open-Design ACP path**. Do not embed diagnostics
inside model-facing shell text as a workaround. No Vela files are changed here.

## Executor observations

`metadata.execution` is a bounded version-1 snapshot. It travels in running,
completed and failed tool metadata. Native ACP running updates (including output
deduplication updates) expose it at `rawOutput.metadata.execution`; terminal
updates retain the existing rawOutput metadata envelope. No HTTP/Protocol schema
or generated client changes are required. `tool.execution` log entries carry
individual events and the same existing correlation IDs.

| Field                       | Meaning                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `requested_timeout_ms`      | Caller value; null if omitted                                      |
| `effective_timeout_ms`      | Selected timeout plus the existing 100ms grace                     |
| `force_kill_after_ms`       | Existing 3000ms escalation setting                                 |
| `trigger`                   | Race winner: exit, abort, or deadline; absent until observed       |
| `terminal`                  | running, returned, failed, or interrupted at the executor boundary |
| `events`                    | Last 64 native/executor observations, ordered by observation       |
| `dropped_events`            | Number evicted from the bounded snapshot                           |
| event `at_ms`, `elapsed_ms` | Wall-clock timestamp and monotonic elapsed milliseconds            |

Phases cover spawn requested/confirmed/error, native exit, stdout/stderr close,
child close, kill requested/sent/failed, release started/finished, deadline,
abort observed, kill settled, output consumer finished, output sink close
requested/settled, and executor settled. PID, exit code, signal, signal target/mechanism,
consumer outcome and safe error chain are included where available.

`exit` and `close` are different: the spawner's existing `exitCode` waits for
child close, which may wait for inherited pipes. Node may emit child close from
its own stream listener before a later observer listener runs; the close event
therefore also samples the real `stdout_closed` and `stderr_closed` properties.
Missing listener events in an earlier snapshot are not proof that pipes remain
open. `output_consumer_finished` distinguishes success, failure and interruption;
sink settled means its callback finished, not necessarily a filesystem flush.

`abort_observed` confirms that this executor saw its AbortSignal; it does not
claim when a remote host issued cancellation. `kill_sent` confirms the native
signal call returned (on Windows the group operation records taskkill /T /F instead of claiming a POSIX signal).
`kill_settled` confirms the existing kill waiter returned. `release_finished`
confirms the finalizer returned, which may suppress kill errors under the
existing policy. None proves that every descendant, including detached or
escaped descendants, is dead; inspect kill_failed and native close together.

The observer is provided per execution and read at spawn time, including with
shared process services. Callback failures cannot escape into native process
handling. A bounded queue handles logging/progress outside native callbacks;
diagnostic metadata writes are best-effort with a separate 100ms delivery cap.
Slow or interrupted sinks can lose progress. Returned results include the final
snapshot, but a killed runtime cannot promise final delivery. Existing user
output streaming is preserved. Progress preserves the original tool start time.

## Terminal provenance

The processor persists `metadata.toolTerminal` with `at_ms` and:

| `source`            | `confirmed` | Interpretation                                                                    |
| ------------------- | ----------- | --------------------------------------------------------------------------------- |
| `tool_result`       | true        | Processor received a tool result (including an explicit provider-executed result) |
| `tool_error`        | true        | Processor received a tool error; safe error chain retained                        |
| `processor_cleanup` | false       | Processor synthesized an aborted state without a tool result/error                |

These are processor observations, separate from `execution.terminal`. A shell
deadline can return a normal result containing timeout text. A cleanup-only
ERROR cannot establish execution duration or successful user-task completion.
Older records without these fields stay unknown. Consumers must also preserve
their own host-synthesized provenance; absence of a field is not confirmation.
Late results after processor cleanup do not upgrade the persisted terminal.

## Privacy and remaining scope

New diagnostics never copy commands, input arguments, output, stderr text, SQL,
database values, paths, stacks, error messages or authentication headers. Error
chains retain at most four cycle-safe entries of allowlisted type/code and numeric
errno. Unknown labels are omitted or normalized. Existing display output and
rawInput are unchanged and must not be copied wholesale into telemetry.

A real in-memory SQLite constraint fixture verifies code extraction through a
wrapped cause. Session/database failures outside the tool-error boundary still
need separate owner-level observation; this change does not instrument or
refactor SQL execution, nor establish the cause of the audited statement error.

Coverage uses harmless local fixtures for normal output, deadline, repeated
abort, parent exit with inherited pipes and SIGKILL escalation, failed cwd/spawn,
concurrent observer isolation, processor cleanup and late results, ACP envelopes,
and error privacy. This is not a reproduction or repair claim for the audited
17 post-tool timeouts, four child-close timeouts, or all six long Bash spans.
