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
      // TODO: Implement actual API call
      // const response = await fetch(`/api/v1/tenants/${tenantId}/dashboards/${id}`);
      // const data = await response.json();
      // setDashboard(data);
      console.log("Loading dashboard:", id);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDashboard = async () => {
    setSaving(true);
    try {
      // TODO: Implement actual API call
      // if (dashboard.id) {
      //   // Update existing
      //   await fetch(`/api/v1/tenants/${tenantId}/dashboards/${dashboard.id}`, {
      //     method: 'PUT',
      //     body: JSON.stringify(dashboard),
      //   });
      // } else {
      //   // Create new
      //   const response = await fetch(`/api/v1/tenants/${tenantId}/dashboards`, {
      //     method: 'POST',
      //     body: JSON.stringify(dashboard),
      //   });
      //   const data = await response.json();
      //   setDashboard({ ...dashboard, id: data.id });
      // }
      console.log("Saving dashboard:", dashboard);
      alert("Dashboard saved successfully!");
    } catch (error) {
      console.error("Error saving dashboard:", error);
      alert("Failed to save dashboard");
    } finally {
      setSaving(false);
    }
  };

  const handleAddWidget = (widgetType: any) => {
    const newWidget: Widget = {
      id: `widget-${Date.now()}`,
      widget_type: widgetType.id,
      title: widgetType.name,
      position_x: 0,
      position_y: dashboard.widgets.length * 2,
      width: 3,
      height: 2,
      configuration: widgetType.defaultConfig,
      data_sources: [],
    };

    setDashboard({
      ...dashboard,
      widgets: [...dashboard.widgets, newWidget],
    });
  };

  const handleLayoutChange = (updatedWidgets: Widget[]) => {
    setDashboard({
      ...dashboard,
      widgets: updatedWidgets,
    });
  };

  const handleWidgetSettings = (widgetId: string) => {
    setSelectedWidgetId(widgetId);
    setShowWidgetConfig(true);
  };

  const handleWidgetRemove = (widgetId: string) => {
    if (confirm("Are you sure you want to remove this widget?")) {
      setDashboard({
        ...dashboard,
        widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
      });
    }
  };

  const handleSaveWidgetConfig = (config: any) => {
    if (!selectedWidgetId) return;

    setDashboard({
      ...dashboard,
      widgets: dashboard.widgets.map((w) =>
        w.id === selectedWidgetId ? { ...w, configuration: config } : w
      ),
    });
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
        onClose={() => {
          setShowWidgetConfig(false);
          setSelectedWidgetId(null);
        }}
        onSave={handleSaveWidgetConfig}
      />
    </div>
  );
}
