"use client";

import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChartWidgetProps {
  config: {
    chart_type?: 'line' | 'area' | 'bar';
    metrics?: string[];
    time_range?: string;
    colors?: string[];
    color?: string;
  };
  dataSources?: Array<{
    device_id: string;
    metric: string;
    alias?: string;
  }>;
}

export default function ChartWidget({ config, dataSources }: ChartWidgetProps) {
  const {
    chart_type = 'line',
    metrics = [],
    time_range = '24h',
    colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
    color,
  } = config;

  // TODO: REMOVE MOCK DATA AFTER REAL API INTEGRATION
  // This is TEMPORARY demo data for Iteration 2
  const generateMockData = () => {
    const hours = parseInt(time_range) || 24;
    const data = [];
    const now = Date.now();

    for (let i = hours; i >= 0; i--) {
      const timestamp = new Date(now - i * 60 * 60 * 1000);
      const dataPoint: any = {
        time: timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        timestamp: timestamp.getTime(),
      };

      metrics.forEach((metric, index) => {
        // Generate realistic-looking data
        const base = 50 + index * 20;
        const variance = 15;
        dataPoint[metric] = base + (Math.random() - 0.5) * variance;
      });

      data.push(dataPoint);
    }

    return data;
  };

  const mockData = generateMockData();

  /* REAL IMPLEMENTATION (Uncomment when ready):
  const { data: chartData, isLoading } = useQuery({
    queryKey: ['chart-data', dataSources, time_range],
    queryFn: async () => {
      if (!dataSources || dataSources.length === 0) return [];

      const promises = dataSources.map(async (ds) => {
        const response = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${ds.device_id}/telemetry?` +
          `metrics=${ds.metric}&timeRange=${time_range}`
        );
        return response.json();
      });

      const results = await Promise.all(promises);

      // Merge telemetry data by timestamp
      const mergedData: Record<number, any> = {};

      results.forEach((result, index) => {
        const ds = dataSources[index];
        result.data.forEach((point: any) => {
          const timestamp = new Date(point.timestamp).getTime();
          if (!mergedData[timestamp]) {
            mergedData[timestamp] = {
              time: new Date(point.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
              }),
              timestamp,
            };
          }
          mergedData[timestamp][ds.alias || ds.metric] = point.value;
        });
      });

      return Object.values(mergedData).sort((a, b) => a.timestamp - b.timestamp);
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        No data available
      </div>
    );
  }
  */

  // Show demo data message
  if (!dataSources || dataSources.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1">
          {renderChart()}
        </div>
        <div className="mt-2 text-xs text-gray-400 text-center">
          Demo data • Bind device for real data
        </div>
      </div>
    );
  }

  function renderChart() {
    const chartColors = color ? [color] : colors;

    const commonProps = {
      data: mockData,
      margin: { top: 5, right: 20, left: 0, bottom: 5 },
    };

    switch (chart_type) {
      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart {...commonProps}>
              <defs>
                {metrics.map((metric, index) => (
                  <linearGradient key={metric} id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors[index % chartColors.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors[index % chartColors.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.375rem',
                  fontSize: '12px'
                }}
              />
              {metrics.length > 1 && <Legend wrapperStyle={{ fontSize: '12px' }} />}
              {metrics.map((metric, index) => (
                <Area
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  stroke={chartColors[index % chartColors.length]}
                  fill={`url(#gradient-${metric})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.375rem',
                  fontSize: '12px'
                }}
              />
              {metrics.length > 1 && <Legend wrapperStyle={{ fontSize: '12px' }} />}
              {metrics.map((metric, index) => (
                <Bar
                  key={metric}
                  dataKey={metric}
                  fill={chartColors[index % chartColors.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
      default:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.375rem',
                  fontSize: '12px'
                }}
              />
              {metrics.length > 1 && <Legend wrapperStyle={{ fontSize: '12px' }} />}
              {metrics.map((metric, index) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );
    }
  }

  return (
    <div className="h-full">
      {renderChart()}
    </div>
  );
}
