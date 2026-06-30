import { NextResponse } from "next/server";
import { jobStore } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:id — return the current job state. The client polls this until the
 * status is "done" (steps + screenshots present) or "error" (message present).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const job = jobStore.get(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  // The job object is already the API shape we want to expose.
  return NextResponse.json(job);
}
