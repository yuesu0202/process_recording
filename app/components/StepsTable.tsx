import Image from "next/image";
import type { ColumnConfig, Step } from "@/lib/schema";
import { formatTimestamp } from "@/lib/steps";

/**
 * StepsTable — renders the generated test script. It is fully *column-driven*: the
 * headers and the text cells come straight from `columns`, while the two
 * system-owned columns (Screenshot, Timestamp) are rendered explicitly because they
 * are not AI-generated text. Adding a column in Part 2 needs no change here.
 */
export function StepsTable({ columns, steps }: { columns: ColumnConfig[]; steps: Step[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <th className="w-12 px-4 py-3 font-semibold">#</th>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 font-semibold">
                {col.label}
              </th>
            ))}
            <th className="px-4 py-3 font-semibold">Screenshot</th>
            <th className="w-24 px-4 py-3 font-semibold">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.index} className="border-b border-slate-100 align-top last:border-0">
              <td className="px-4 py-3 font-medium text-slate-400">{step.index + 1}</td>
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-slate-700">
                  {step.fields[col.key] || <span className="text-slate-300">—</span>}
                </td>
              ))}
              <td className="px-4 py-3">
                <ScreenshotCell url={step.screenshotUrl} index={step.index} />
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                {formatTimestamp(step.timestampSeconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One screenshot cell: the extracted frame, or a clear placeholder when absent. */
function ScreenshotCell({ url, index }: { url: string | null; index: number }) {
  if (!url) {
    return (
      <div className="flex h-20 w-36 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
        No screenshot
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-36">
      <Image
        src={url}
        alt={`Screenshot for step ${index + 1}`}
        width={144}
        height={81}
        unoptimized
        className="h-auto w-36 rounded border border-slate-200 transition hover:border-slate-400"
      />
    </a>
  );
}
