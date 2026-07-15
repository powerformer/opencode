# Powerformer fork

This fork tracks upstream OpenCode releases and keeps downstream changes small, independently testable, and reversible.

## Upstream baseline

- Baseline: `v1.18.1` (`99f638d8293f6985726ba509da602296c4963497`)
- Upgrade branch: `codex/align-upstream-v1.18.1`
- Do not merge the previous downstream `dev` branch into a new upstream baseline. Audit downstream commits and carry only behavior that is still missing upstream.

## Downstream patch inventory

The inventory was produced from `git log --cherry-pick --right-only --no-merges v1.18.1...origin/dev`. The previous fork has five non-upstream commits:

- `3d2c15cae` — AMR image input and tool completion
- `2ba235b22` — explicit build target
- `7e0cb5f93` — native reasoning and image normalization
- `d28cb5235` — fabricated role-marker guard
- `1fad6801c` — role-marker false-positive handling

The merge commit for Powerformer PR #1 does not add another independent patch. Deployment configuration is not stored in this repository and must be audited separately before rollout.

| Capability | Decision | Evidence |
| --- | --- | --- |
| OpenAI-compatible user image input | Drop | Upstream lowers image media to `image_url` and validates MIME/base64. |
| Image tool-result continuation | Drop | Upstream preserves image tool results across the OpenAI Chat continuation. |
| Interrupted orphan tool handling | Drop | Upstream exits without another LLM request. |
| Custom AMR OpenAI-compatible native runtime | Carry | Upstream `v1.18.1` restricts native runtime by provider ID even when the provider package is compatible. |
| OpenAI-compatible `reasoning_details` replay | Carry | Provider transform creates the field, but the upstream native request adapter does not preserve it on the wire. |
| Fabricated role-marker guard | Carry | No equivalent guard exists upstream. |
| Explicit build target | Carry | Release automation needs one deterministic target instead of every platform artifact. |

Re-evaluate every `Carry` item on each upstream upgrade. Delete a downstream patch as soon as an equivalent upstream behavior passes the regression suite.

## Plugin policy

Production deployments that use only configured AMR/OpenAI-compatible providers should set:

```sh
OPENCODE_DISABLE_DEFAULT_PLUGINS=1
```

This disables built-in authentication plugins such as GitHub Copilot and Codex without deleting upstream code. Set `OPENCODE_PURE=1` only when AMR does not depend on an external plugin; it disables external plugins as well.

## Regression checks

Run tests from their package directories, never from the repository root:

```sh
cd packages/llm
with-env bun test test/provider/openai-chat.test.ts

cd ../opencode
with-env bun test test/session/llm-native.test.ts
with-env bun test test/session/prompt.test.ts -t "interrupted orphan"
with-env bun test test/session/role-marker-guard.test.ts
with-env bun test test/session/processor-effect.test.ts -t "fabricated role marker"
with-env bun typecheck
```

Before production rollout, repeat text, direct-image, image-tool-result, tool interruption, multi-turn reasoning, and session-resume checks against the real AMR test endpoint. Local fake-provider tests do not replace that proof.

## Build target

Use either `--target=<target>` or `OPENCODE_BUILD_TARGET=<target>`. Accepted examples include `darwin-arm64`, `linux-x64`, `linux-x64-baseline`, and the same values prefixed with `opencode-`.

Keep the previous production artifact available until the aligned build passes a canary rollout. Roll back by restoring that artifact; do not revert the upstream baseline in place.
