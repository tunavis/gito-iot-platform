"use client";

import { useEffect, useState } from "react";
import { Table as TableIcon, ChevronLeft, ChevronRight } from "lucide-react";

interface ColumnConfig {
  field: string;
  label?: string;
  format?: string;
}

interface TableConfig {
  columns?: (string | ColumnConfig)[];
  page_size?: number;
  auto_refresh?: boolean;
  time_range?: string;
  show_device_name?: boolean;
}

interface TableWidgetProps {
  config: TableConfig;
  dataSources: Array<{
    device_id: string;
    metric?: string;
    alias?: string;
  }>;
}

export default function TableWidget({ config, dataSources }: TableWidgetProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const {
    columns = ["timestamp"],
    page_size = 10,
    auto_refresh = true,
    time_range = "24h",
    show_device_name = false,
  } = config;

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!dataSources || dataSources.length === 0) {
          setData([]);
          setLoading(false);
          return;
        }

        const token = localStorage.getItem("auth_token");
        if (!token) {
          setLoading(false);
          return;
        }

        const payload = JSON.parse(atob(token.split(".")[1]));
        const tenantId = payload.tenant_id;

        // Parse time range
        const rangeHours = parseInt(time_range.replace(/[^0-9]/g, "")) || 24;
        const endTime = new Date();
        const startTime = new Date(
          endTime.getTime() - rangeHours * 60 * 60 * 1000
        );

        // Fetch telemetry for all data sources
        const promises = dataSources.map(async (ds) => {
          const params = new URLSearchParams({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            per_page: "100",
          });

          try {
            const response = await fetch(
              `/api/v1/tenants/${tenantId}/devices/${ds.device_id}/telemetry?${params}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (!response.ok) return { device_id: ds.device_id, data: [] };

            const result = await response.json();

            // Add device info to each data point
            return {
              device_id: ds.device_id,
              device_name: ds.alias || ds.device_id,
              data: result.data || [],
            };
          } catch (error) {
            console.error(`Failed to fetch telemetry for ${ds.device_id}:`, error);
            return { device_id: ds.device_id, data: [] };
          }
        });

        const results = await Promise.all(promises);

        // Merge and flatten data
        const allData: any[] = [];
        results.forEach((result) => {
          if (result.data && result.data.length > 0) {
            result.data.forEach((point: any) => {
              allData.push({
                ...point,
                device_id: result.device_id,
                device_name: result.device_name,
              });
            });
          }
        });

        // Sort by timestamp descending (newest first)
        allData.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        setData(allData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching table data:", error);
        setLoading(false);
      }
    };

    fetchData();

    // Auto-refresh
    if (auto_refresh) {
      const interval = setInterval(fetchData, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [dataSources, time_range, auto_refresh]);

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number") {
      return value.toFixed(2);
    }
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    return String(value);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <TableIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No data available</p>
        </div>
      </div>
    );
  }

  // Pagination
  const totalPages = Math.ceil(data.length / page_size);
  const startIdx = currentPage * page_size;
  const endIdx = Math.min(startIdx + page_size, data.length);
  const pageData = data.slice(startIdx, endIdx);

  // Normalize columns to simple format
  const normalizedColumns = columns.map((col) =>
    typeof col === "string" ? { field: col, label: col } : col
  );

  // Ensure timestamp is included
  const hasTimestamp = normalizedColumns.some((c) => c.field === "timestamp");
  const displayColumns = hasTimestamp
    ? normalizedColumns
    : [{ field: "timestamp", label: "Time" }, ...normalizedColumns];

  return (
    <div className="h-full flex flex-col">
      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {show_device_name && (
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Device
                </th>
              )}
              {displayColumns.map((col) => (
                <th
                  key={col.field}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {col.label || col.field.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pageData.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                {show_device_name && (
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                    {row.device_name}
                  </td>
                )}
                {displayColumns.map((col) => {
                  if (col.field === "timestamp") {
                    return (
                      <td
                        key={col.field}
                        className="px-3 py-2 whitespace-nowrap text-gray-900"
                      >
                        {formatTimestamp(row.timestamp)}
                      </td>
                    );
                  }

                  // Check both direct field and payload
                  const value = row[col.field] ?? row.payload?.[col.field];

                  return (
                    <td
                      key={col.field}
                      className="px-3 py-2 whitespace-nowrap text-gray-900"
                    >
                      {formatValue(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div className="text-sm text-gray-700">
            Showing {startIdx + 1} to {endIdx} of {data.length} entries
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1 text-sm text-gray-700">
              Page {currentPage + 1} of {totalPages}
            </div>
            <button
              onClick={() =>
                setCurrentPage(Math.min(totalPages - 1, currentPage + 1))
              }
              disabled={currentPage === totalPages - 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
