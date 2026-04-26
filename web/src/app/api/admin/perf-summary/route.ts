import { promises as fs } from "fs";
import path from "path";
import {
  aggregatePerfTraces,
  parseN,
  handlePerfSummaryRequest
} from "@/lib/perfSummary.mjs";

void aggregatePerfTraces;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const n = parseN(url.searchParams.get("n"));

  const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs");
  const traceFilePath = path.join(baseDir, "chat_query_trace.jsonl");

  const result = await handlePerfSummaryRequest({
    env: process.env.NODE_ENV,
    traceFilePath,
    n,
    readFile: fs.readFile
  });

  if (result.status === 200) {
    return Response.json(result.body, { status: 200 });
  }
  return new Response(result.body, { status: 404 });
}
