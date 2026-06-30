import Link from "next/link";
import { UploadAndResults } from "./components/UploadAndResults";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Process Recording → Test Script</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Upload a screen recording and get a documented test script: an ordered list of
            steps, each with a screenshot captured at the moment the action completes.
          </p>
        </div>
        <Link
          href="/config"
          className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Configure columns
        </Link>
      </header>

      <UploadAndResults />
    </main>
  );
}
