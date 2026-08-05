import { Option, Schema } from "effect"
import { isRecord } from "@/util/record"

export type Metrics = {
  readonly bodyBytes: number
  readonly messageBytes: number
  readonly messageNonImageBytes: number
  readonly systemBytes: number
  readonly toolDefinitionBytes: number
  readonly otherBytes: number
  readonly imagePayloadBytes: number
  readonly messageCount: number
  readonly imageCount: number
  readonly toolDefinitionCount: number
}

const decoder = new TextEncoder()
const parse = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const messages = ["messages", "input", "contents"] as const
const systems = ["system", "instructions", "system_instruction", "systemInstruction"] as const
const tools = ["tools", "functions"] as const

const bytes = (value: string) => decoder.encode(value).byteLength
const size = (value: unknown) => {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? 0 : bytes(encoded)
}

const values = (body: Record<string, unknown>, keys: readonly string[]) =>
  keys.flatMap((key) => (key in body ? [body[key]] : []))

const count = (input: readonly unknown[]) =>
  input.reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : isRecord(value) ? 1 : 0), 0)

function images(value: unknown): { bytes: number; count: number } {
  if (typeof value === "string") {
    if (!value.startsWith("data:image/") || !value.includes(";base64,")) return { bytes: 0, count: 0 }
    return { bytes: bytes(value), count: 1 }
  }
  if (Array.isArray(value))
    return value.reduce(
      (result, item) => {
        const found = images(item)
        return { bytes: result.bytes + found.bytes, count: result.count + found.count }
      },
      { bytes: 0, count: 0 },
    )
  if (!isRecord(value)) return { bytes: 0, count: 0 }

  const mime = [value.media_type, value.mediaType, value.mime_type, value.mimeType].find(
    (item): item is string => typeof item === "string",
  )
  const data = typeof value.data === "string" && mime?.startsWith("image/") ? value.data : undefined
  return Object.entries(value).reduce(
    (result, [key, item]) => {
      if (key === "data" && data !== undefined) return { bytes: result.bytes + bytes(data), count: result.count + 1 }
      const found = images(item)
      return { bytes: result.bytes + found.bytes, count: result.count + found.count }
    },
    { bytes: 0, count: 0 },
  )
}

export function measure(input: unknown): Metrics | undefined {
  if (typeof input !== "string") return undefined
  const bodyBytes = bytes(input)
  const decoded = parse(input)
  if (Option.isNone(decoded) || !isRecord(decoded.value)) {
    return {
      bodyBytes,
      messageBytes: 0,
      messageNonImageBytes: 0,
      systemBytes: 0,
      toolDefinitionBytes: 0,
      otherBytes: bodyBytes,
      imagePayloadBytes: 0,
      messageCount: 0,
      imageCount: 0,
      toolDefinitionCount: 0,
    }
  }

  const messageValues = values(decoded.value, messages)
  const systemValues = values(decoded.value, systems)
  const toolValues = values(decoded.value, tools)
  const messageBytes = messageValues.reduce<number>((total, value) => total + size(value), 0)
  const systemBytes = systemValues.reduce<number>((total, value) => total + size(value), 0)
  const toolDefinitionBytes = toolValues.reduce<number>((total, value) => total + size(value), 0)
  const image = images(messageValues)

  return {
    bodyBytes,
    messageBytes,
    messageNonImageBytes: Math.max(0, messageBytes - image.bytes),
    systemBytes,
    toolDefinitionBytes,
    otherBytes: Math.max(0, bodyBytes - messageBytes - systemBytes - toolDefinitionBytes),
    imagePayloadBytes: image.bytes,
    messageCount: count(messageValues),
    imageCount: image.count,
    toolDefinitionCount: count(toolValues),
  }
}

export async function send<T>(
  body: unknown,
  report: (metrics: Metrics) => Promise<unknown>,
  execute: () => Promise<T>,
): Promise<T> {
  const metrics = measure(body)
  if (metrics)
    await Promise.resolve()
      .then(() => report(metrics))
      .catch(() => undefined)
  return execute()
}

export * as RequestSize from "./request-size"
