const ROLE_MARKER_RE = /(^|\n)(## (?:user|assistant|assist|system))(?=(?:[ \t]*\r?\n)|[:：])/u
const ROLE_MARKER_END_RE = /(^|\n)(## (?:user|assistant|assist|system))(?:[ \t]*\r?)$/u
const MARKERS = ["## user", "## assistant", "## assist", "## system"]

export type RoleMarkerDetection = {
  marker: string
}

export function createRoleMarkerGuard() {
  let pending = ""
  let detected: RoleMarkerDetection | undefined

  function scan(value: string) {
    const match = ROLE_MARKER_RE.exec(value)
    if (!match || match.index === undefined) return
    return {
      index: match.index + match[1].length,
      marker: match[2],
    }
  }

  function splitPending(value: string) {
    const index = value.lastIndexOf("\n") + 1
    const suffix = value.slice(index)
    const pending = MARKERS.some(
      (marker) =>
        marker.startsWith(suffix) ||
        (suffix.startsWith(marker) && /^[ \t]*\r?$/u.test(suffix.slice(marker.length))),
    )
    if (pending) return { text: value.slice(0, index), pending: suffix }
    return {
      text: value,
      pending: "",
    }
  }

  return {
    feed(text: string): { text: string; detection?: RoleMarkerDetection } {
      if (detected) return { text: "" }
      const value = pending + text
      const found = scan(value)
      if (found) {
        detected = { marker: found.marker }
        pending = ""
        return { text: value.slice(0, found.index), detection: detected }
      }
      const next = splitPending(value)
      pending = next.pending
      return { text: next.text }
    },
    flush(): { text: string; detection?: RoleMarkerDetection } {
      if (detected) return { text: "" }
      const found = ROLE_MARKER_END_RE.exec(pending)
      if (found) {
        const text = pending.slice(0, found.index + found[1].length)
        detected = { marker: found[2] }
        pending = ""
        return { text, detection: detected }
      }
      const text = pending
      pending = ""
      return { text }
    },
  }
}

export * as RoleMarkerGuard from "./role-marker-guard"
