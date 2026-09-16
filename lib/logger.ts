/**
 * Structured logging. No bare console.log anywhere else in the codebase —
 * it leaks to stdout in production without context and cannot be filtered.
 */
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", msg: string, fields?: Fields) {
  const line = { level, msg, at: new Date().toISOString(), ...fields };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  out(JSON.stringify(line));
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
