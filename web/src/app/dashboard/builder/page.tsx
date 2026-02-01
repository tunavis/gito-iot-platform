"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import DashboardGrid from "@/components/DashboardBuilder/DashboardGrid";
import WidgetLibrary from "@/components/DashboardBuilder/WidgetLibrary";
import WidgetConfigModal from "@/components/DashboardBuilder/WidgetConfigModal";

interface Widget {
  id: string;
  widget_type: string;
  title?: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  configuration: any;
  data_sources: any[];
}

interface Dashboard {
  id?: string;
  name: string;
  description?: string;
  is_default: boolean;
  widgets: Widget[];
}

export default function DashboardBuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardId = searchParams.get("id");

  const [dashboard, setDashboard] = useState<Dashboard>({
    name: "New Dashboard",
    description: "",
    is_default: false,
    widgets: [],
  });

  const [isEditMode, setIsEditMode] = useState(true);
  const [showWidgetLibrary, setShowWidgetLibrary] = useState(false);
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dashboardId) {
      loadDashboard(dashboardId);
    }
  }, [dashboardId]);

  const loadDashboard = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to load dashboard");
      }

      const result = await response.json();
      setDashboard(result);
    } catch (error) {
      console.error("Error loading dashboard:", error);
      alert("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDashboard = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      if (dashboard.id) {
        // Update existing dashboard
        const response = await fetch(
          `/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: dashboard.name,
              description: dashboard.description,
              is_default: dashboard.is_default,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to update dashboard");
        }
      } else {
        // Create new dashboard
        const response = await fetch(
          `/api/v1/tenants/${tenantId}/dashboards`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: dashboard.name,
              description: dashboard.description,
              is_default: dashboard.is_default,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error("Dashboard creation failed:", response.status, errorData);
          throw new Error(errorData.error?.message || `Failed to create dashboard (${response.status})`);
        }

        const result = await response.json();
        setDashboard({ ...dashboard, id: result.id });

        // Update URL with new dashboard ID
        router.push(`/dashboard/builder?id=${result.id}`);
      }

      alert("Dashboard saved successfully!");
    } catch (error: any) {
      console.error("Error saving dashboard:", error);
      alert(`Failed to save dashboard: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddWidget = async (widgetType: any) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      // Ensure dashboard is saved first
      if (!dashboard.id) {
        await handleSaveDashboard();
        return; // Wait for save to complete and dashboard.id to be set
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}/widgets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            widget_type: widgetType.id,
            title: widgetType.name,
            position_x: 0,
            position_y: dashboard.widgets.length * 2,
            width: 3,
            height: 2,
            configuration: widgetType.defaultConfig,
            data_sources: [],
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to add widget");
      }

      const result = await response.json();
      setDashboard({
        ...dashboard,
        widgets: [...dashboard.widgets, result],
      });
    } catch (error) {
      console.error("Error adding widget:", error);
      alert("Failed to add widget");
    }
  };

  const handleLayoutChange = async (updatedWidgets: Widget[]) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token || !dashboard.id) return;

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      // Update local state immediately for smooth UX
      setDashboard({
        ...dashboard,
        widgets: updatedWidgets,
      });

      // Batch update widget positions in backend
      const updates = updatedWidgets.map((w) => ({
        widget_id: w.id,
        position_x: w.position_x,
        position_y: w.position_y,
        width: w.width,
        height: w.height,
      }));

      await fetch(
        `/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}/layout`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ widgets: updates }),
        }
      );
    } catch (error) {
      console.error("Error updating layout:", error);
    }
  };

  const handleWidgetSettings = (widgetId: string) => {
    setSelectedWidgetId(widgetId);
    setShowWidgetConfig(true);
  };

  const handleWidgetRemove = async (widgetId: string) => {
    if (!confirm("Are you sure you want to remove this widget?")) return;

    try {
      const token = localStorage.getItem("auth_token");
      if (!token || !dashboard.id) return;

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}/widgets/${widgetId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to remove widget");
      }

      setDashboard({
        ...dashboard,
        widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
      });
    } catch (error) {
      console.error("Error removing widget:", error);
      alert("Failed to remove widget");
    }
  };

  const handleSaveWidgetConfig = async (config: any, title?: string, dataSources?: any[]) => {
    if (!selectedWidgetId) return;

    try {
      const token = localStorage.getItem("auth_token");
      if (!token || !dashboard.id) return;

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}/widgets/${selectedWidgetId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title,
            configuration: config,
            data_sources: dataSources,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update widget");
      }

      const result = await response.json();

      // Update local state with server response
      setDashboard({
        ...dashboard,
        widgets: dashboard.widgets.map((w) =>
          w.id === selectedWidgetId ? result : w
        ),
      });
    } catch (error) {
      console.error("Error updating widget:", error);
      alert("Failed to update widget configuration");
    }
  };

  const selectedWidget = dashboard.widgets.find(
    (w) => w.id === selectedWidgetId
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />

      <main className="flex-1 ml-64">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-1 text-gray-600 hover:text-gray-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <input
              type="text"
              value={dashboard.name}
              onChange={(e) =>
                setDashboard({ ...dashboard, name: e.target.value })
              }
              className="text-xl font-semibold text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 p-0"
              placeholder="Dashboard Name"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowWidgetLibrary(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add widget
            </button>

            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {isEditMode ? 'Done editing' : 'Edit widgets'}
            </button>

            <button
              onClick={handleSaveDashboard}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : dashboard.widgets.length === 0 ? (
            <div className="bg-white rounded border border-gray-200 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Dashboard Builder</h2>
              </div>
              <div className="p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No Widgets Yet
                </h3>
                <p className="text-gray-500 mb-6">
                  Get started by adding your first widget to the dashboard
                </p>
                <button
                  onClick={() => setShowWidgetLibrary(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Your First Widget
                </button>
              </div>
            </div>
          ) : (
            <DashboardGrid
              widgets={dashboard.widgets}
              isEditMode={isEditMode}
              onLayoutChange={handleLayoutChange}
              onWidgetSettings={handleWidgetSettings}
              onWidgetRemove={handleWidgetRemove}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <WidgetLibrary
        isOpen={showWidgetLibrary}
        onClose={() => setShowWidgetLibrary(false)}
        onSelectWidget={handleAddWidget}
      />

      <WidgetConfigModal
        isOpen={showWidgetConfig}
        widgetType={selectedWidget?.widget_type || ""}
        currentConfig={selectedWidget?.configuration || {}}
        currentTitle={selectedWidget?.title}
        currentDataSources={selectedWidget?.data_sources || []}
        onClose={() => {
          setShowWidgetConfig(false);
          setSelectedWidgetId(null);
        }}
        onSave={handleSaveWidgetConfig}
      />
    </div>
  );
}
