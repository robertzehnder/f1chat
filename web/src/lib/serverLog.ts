import { mkdir, appendFile } from "fs/promises";
import path from "path";

type LogLevel = "INFO" | "WARN" | "ERROR";

function nowIso(): string {
  return new Date().toISOString();
}

function getLogFilePath(): string {
  const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs");
  return path.join(baseDir, "chat_api.log");
}

function getNamedLogFilePath(fileName: string): string {
  const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs");
  return path.join(baseDir, fileName);
}

export async function logServer(level: LogLevel, event: string, payload: Record<string, unknown> = {}) {
  const entry = {
    ts: nowIso(),
    level,
    event,
    ...payload
  };
  const line = JSON.stringify(entry);

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.info(line);
  }

  try {
    const filePath = getLogFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, "utf8");
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: nowIso(),
        level: "ERROR",
        event: "log_write_failed",
        error: err instanceof Error ? err.message : String(err)
      })
    );
  }
}

export async function appendJsonLog(fileName: string, payload: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: nowIso(),
    ...payload
  });

  try {
    const filePath = getNamedLogFilePath(fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, "utf8");
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: nowIso(),
        level: "ERROR",
        event: "named_log_write_failed",
        fileName,
        error: err instanceof Error ? err.message : String(err)
      })
    );
  }
}
