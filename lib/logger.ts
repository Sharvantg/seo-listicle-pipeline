/**
 * Minimal structured logger.
 * Output format: [ISO_TIMESTAMP] [LEVEL] [tag] message key=value ...
 * Readable in Vercel logs, local dev, and grep-friendly.
 */

type Data = Record<string, unknown>;

function fmt(level: string, tag: string, msg: string, data?: Data): string {
  const ts = new Date().toISOString();
  const dataStr = data
    ? " " +
      Object.entries(data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
    : "";
  return `[${ts}] [${level}] [${tag}] ${msg}${dataStr}`;
}

export const log = {
  info: (tag: string, msg: string, data?: Data) =>
    console.log(fmt("INFO ", tag, msg, data)),
  warn: (tag: string, msg: string, data?: Data) =>
    console.warn(fmt("WARN ", tag, msg, data)),
  error: (tag: string, msg: string, data?: Data) =>
    console.error(fmt("ERROR", tag, msg, data)),
};

/** Returns elapsed ms since `start = Date.now()` */
export function elapsed(start: number): number {
  return Date.now() - start;
}
