import { describe, expect, test } from "bun:test"
import { RequestSize } from "@/provider/request-size"

describe("provider request size telemetry", () => {
  test("measures the final JSON body without retaining request content", () => {
    const image = "data:image/png;base64,QUJDRA=="
    const payload = {
      model: "private-model",
      instructions: "private system prompt",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "private user prompt" },
            { type: "input_image", image_url: image },
          ],
        },
        { type: "function_call_output", call_id: "private-call", output: "private tool result" },
      ],
      tools: [
        {
          type: "function",
          name: "private_tool",
          description: "private tool description",
          parameters: { type: "object" },
        },
      ],
      stream: true,
    }
    const body = JSON.stringify(payload)
    const metrics = RequestSize.measure(body)

    expect(metrics).toBeDefined()
    expect(metrics!.bodyBytes).toBe(Buffer.byteLength(body))
    expect(metrics!.messageBytes).toBe(Buffer.byteLength(JSON.stringify(payload.input)))
    expect(metrics!.systemBytes).toBe(Buffer.byteLength(JSON.stringify(payload.instructions)))
    expect(metrics!.toolDefinitionBytes).toBe(Buffer.byteLength(JSON.stringify(payload.tools)))
    expect(metrics!.imagePayloadBytes).toBe(Buffer.byteLength(image))
    expect(metrics!.messageCount).toBe(2)
    expect(metrics!.imageCount).toBe(1)
    expect(metrics!.toolDefinitionCount).toBe(1)
    expect(
      metrics!.messageNonImageBytes +
        metrics!.imagePayloadBytes +
        metrics!.systemBytes +
        metrics!.toolDefinitionBytes +
        metrics!.otherBytes,
    ).toBe(metrics!.bodyBytes)

    const serialized = JSON.stringify(metrics)
    expect(serialized).not.toContain("private")
    expect(serialized).not.toContain("QUJDRA==")
  })

  test("records metrics before sending and never blocks the provider on telemetry failure", async () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "secret" }] })
    const order: string[] = []
    const result = await RequestSize.send(
      body,
      async (metrics) => {
        order.push(`metrics:${metrics.bodyBytes}`)
        throw new Error("logger unavailable")
      },
      async () => {
        order.push("send")
        return "ok"
      },
    )

    expect(result).toBe("ok")
    expect(order).toEqual([`metrics:${Buffer.byteLength(body)}`, "send"])
  })
})
