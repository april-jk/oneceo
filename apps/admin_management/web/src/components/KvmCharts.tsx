import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type HostTrendPoint = {
  timeLabel: string;
  cpu: number;
  memory: number;
  storage: number;
};

type DistributionPoint = {
  label: string;
  value: number;
};

export function KvmHostTrendChart({ data }: { data: HostTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
        <XAxis dataKey="timeLabel" minTickGap={20} />
        <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
        <Tooltip formatter={(value) => [`${value}%`, '']} />
        <Legend />
        <Line
          type="monotone"
          dataKey="cpu"
          name="CPU"
          stroke="#0f766e"
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="memory"
          name="内存"
          stroke="#0284c7"
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="storage"
          name="存储"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function KvmVmStatusPieChart({
  data,
  stateColors,
}: {
  data: DistributionPoint[];
  stateColors: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" outerRadius={90} innerRadius={55} dataKey="value" nameKey="label">
          {data.map((item) => (
            <Cell key={item.label} fill={stateColors[item.label] ?? '#0ea5a5'} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function KvmSessionStatusBarChart({ data }: { data: DistributionPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f4" />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" name="数量" fill="#0284c7" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
