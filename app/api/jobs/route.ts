import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { jobStore } from "@/lib/jobs";
import { processVideo } from "@/lib/processor";
import { ColumnConfigArraySchema, DEFAULT_COLUMNS, type ColumnConfig } from "@/lib/schema";

// ffmpeg + fs require the Node runtime (not edge). Processing can take a while.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB — comfortably covers a <3-min recording.

/**
 * POST /api/jobs — accept a video upload, create a job, kick off processing in the
 * background (NOT awaited), and return { jobId } immediately so the client can poll.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No video file was provided." }, { status: 400 });
  }
  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ error: "Uploaded file must be a video." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Video exceeds the 200 MB limit." }, { status: 413 });
  }

  // Columns are optional (Part 2). Validate them so a bad template can't reach generation.
  const columns = parseColumns(formData.get("columns"));
  if (!columns.ok) {
    return NextResponse.json({ error: columns.error }, { status: 400 });
  }

  const job = jobStore.create(columns.value);

  // Persist the upload to a temp file the processor will read and later delete.
  const uploadsDir = path.join(os.tmpdir(), "process-recordings");
  await mkdir(uploadsDir, { recursive: true });
  const videoPath = path.join(uploadsDir, `${job.id}-${sanitize(file.name)}`);
  await writeFile(videoPath, Buffer.from(await file.arrayBuffer()));

  // Fire-and-forget: processVideo never rejects (it records failures on the job).
  void processVideo({
    jobId: job.id,
    videoPath,
    mimeType: file.type,
    columns: columns.value,
    store: jobStore,
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

function parseColumns(
  raw: FormDataEntryValue | null,
): { ok: true; value: ColumnConfig[] } | { ok: false; error: string } {
  if (raw === null || raw === "") {
    return { ok: true, value: DEFAULT_COLUMNS };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return { ok: false, error: "Columns must be valid JSON." };
  }
  const result = ColumnConfigArraySchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `Invalid column config: ${result.error.issues[0]?.message ?? "unknown"}` };
  }
  return { ok: true, value: result.data };
}

/** Strip path separators / odd characters from the original filename before reuse. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "video";
}
