import type { RunResultRecord } from "@promptguard/shared-types";

interface RunResultsTableProps {
  records: RunResultRecord[];
}

export function RunResultsTable({ records }: RunResultsTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-pg-slate/20 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-pg-slate/10 text-pg-slate">
          <tr>
            <th className="px-3 py-2">Prompt</th>
            <th className="px-3 py-2">Test</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Drift</th>
            <th className="px-3 py-2">Latency</th>
            <th className="px-3 py-2">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-t border-pg-slate/10">
              <td className="px-3 py-2">{record.promptName}</td>
              <td className="px-3 py-2">{record.testName}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    record.pass ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {record.pass ? "PASS" : "FAIL"}
                </span>
              </td>
              <td className="px-3 py-2">{record.driftScore.toFixed(3)}</td>
              <td className="px-3 py-2">{record.latencyMs}ms</td>
              <td className="px-3 py-2">{record.tokensUsed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
