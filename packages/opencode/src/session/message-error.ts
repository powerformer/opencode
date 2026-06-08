import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"

export const OutputLengthError = NamedError.create("MessageOutputLengthError", {})

export const AuthError = NamedError.create("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
})
export const RoleMarkerHallucinationError = NamedError.create("RoleMarkerHallucinationError", {
  code: Schema.Literal("ROLE_MARKER_HALLUCINATION"),
  marker: Schema.String,
  message: Schema.String,
})

export const Shared = [
  AuthError.EffectSchema,
  NamedError.Unknown.EffectSchema,
  OutputLengthError.EffectSchema,
  RoleMarkerHallucinationError.EffectSchema,
] as const
export const SharedSchema = Schema.Union(Shared)

export * as MessageError from "./message-error"
