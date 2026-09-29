import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

interface DriftPoint {
  date: string;
  score: number;
}

interface DriftScoreChartProps {
  data: DriftPoint[];
}

export function DriftScoreChart({ data }: DriftScoreChartProps): JSX.Element {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 6" stroke="#c6d2d8" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} domain={[0, 1]} />
          <Tooltip formatter={(value: number) => value.toFixed(3)} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#f76f58"
            strokeWidth={3}
            dot={{ fill: "#10212f", strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
