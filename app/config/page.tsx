import { ColumnsEditor } from "../components/ColumnsEditor";

export default function ConfigPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Configure columns</h1>
      <p className="mt-2 text-sm text-slate-600">
        Customize the test-script template for your client. Saved to this browser.
      </p>
      <div className="mt-8">
        <ColumnsEditor />
      </div>
    </main>
  );
}
