"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { useToast } from "@/components/ToastProvider";
import DashboardGrid from "@/components/DashboardBuilder/DashboardGrid";
import WidgetLibrary from "@/components/DashboardBuilder/WidgetLibrary";
import WidgetConfigModal from "@/components/DashboardBuilder/WidgetConfigModal";
import EmptyState from "@/components/ui/EmptyState";
import { LayoutDashboard, Plus, Pencil, CheckSquare, Save } from "lucide-react";

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

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showWidgetLibrary, setShowWidgetLibrary] = useState(false);
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDefaultDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      // Load user's dashboards
      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to load dashboards");
      }

      const dashboards = await response.json();

      // Find default dashboard or use first one
      const defaultDashboard = dashboards.find((d: Dashboard) => d.is_default) || dashboards[0];

      if (defaultDashboard) {
        // Load full dashboard with widgets
        const dashResponse = await fetch(
          `/api/v1/tenants/${tenantId}/dashboards/${defaultDashboard.id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (dashResponse.ok) {
          const dashData = await dashResponse.json();
          setDashboard(dashData);
        } else {
          // Create a new default dashboard
          await createDefaultDashboard(tenantId, token);
        }
      } else {
        // No dashboards exist, create default
        await createDefaultDashboard(tenantId, token);
      }
    } catch (err) {
      console.error("Error loading dashboard:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");

      // Try to create default dashboard on error
      try {
        const token = localStorage.getItem("auth_token");
        if (token) {
          const payload = JSON.parse(atob(token.split(".")[1]));
          await createDefaultDashboard(payload.tenant_id, token);
        }
      } catch (createErr) {
        console.error("Failed to create default dashboard:", createErr);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadDefaultDashboard();
  }, [loadDefaultDashboard]);

  const createDefaultDashboard = async (tenantId: string, token: string) => {
    try {
      const response = await fetch(
        `/api/v1/tenants/${tenantId}/dashboards`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: "My Dashboard",
            description: "Default dashboard",
            is_default: true,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create dashboard");
      }

      const result = await response.json();
      setDashboard({
        id: result.id,
        name: result.name,
        description: result.description,
        is_default: result.is_default,
        widgets: [],
      });
    } catch (error) {
      console.error("Error creating default dashboard:", error);
      throw error;
    }
  };

  const handleSaveDashboard = async () => {
    if (!dashboard) return;

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
      }

      toast.success('Dashboard saved', 'Dashboard saved successfully!');
    } catch (error: any) {
      console.error("Error saving dashboard:", error);
      toast.error('Failed to save dashboard', error.message || String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleAddWidget = async (widgetType: any) => {
    if (!dashboard) return;

    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      // Ensure dashboard is saved first
      if (!dashboard.id) {
        await handleSaveDashboard();
        return;
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
            width: (widgetType as any).defaultWidth ?? 3,
            height: (widgetType as any).defaultHeight ?? 2,
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
      toast.error('Failed to add widget');
    }
  };

  const handleLayoutChange = async (updatedWidgets: Widget[]) => {
    if (!dashboard) return;

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
    if (!dashboard) return;
    const ok = await toast.confirm('Are you sure you want to remove this widget?', { title: 'Remove Widget', variant: 'danger', confirmLabel: 'Remove' });
    if (!ok) return;

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
      toast.error('Failed to remove widget');
    }
  };

  const handleSaveWidgetConfig = async (
    config: any,
    title?: string,
    dataSources?: any[]
  ) => {
    if (!selectedWidgetId || !dashboard) return;

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
      toast.error('Failed to update widget configuration');
    }
  };

  const selectedWidget = dashboard?.widgets.find(
    (w) => w.id === selectedWidgetId
  );


  if (loading) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-th-secondary">Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-center max-w-md">
            <svg
              className="w-16 h-16 text-red-500 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-th-primary mb-2">
              Failed to Load Dashboard
            </h2>
            <p className="text-th-secondary mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-center max-w-md">
            <svg
              className="w-16 h-16 text-th-muted mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
            <h2 className="text-xl font-semibold text-th-primary mb-2">
              No Dashboard Found
            </h2>
            <p className="text-th-secondary mb-4">
              Get started by creating your first dashboard.
            </p>
            <button
              onClick={() => loadDefaultDashboard()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Create Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />

      <main className="flex-1 ml-64">
        {/* Top Bar */}
        <div className="gito-page-header flex items-center justify-between">
          <div className="flex items-center gap-3">
            {editMode ? (
              <input
                type="text"
                value={dashboard.name}
                onChange={(e) =>
                  setDashboard({ ...dashboard, name: e.target.value })
                }
                className="text-xl font-semibold text-th-primary bg-transparent border-none focus:outline-none focus:ring-0 p-0"
                placeholder="Dashboard Name"
              />
            ) : (
              <h1 className="text-xl font-semibold text-th-primary">
                {dashboard.name}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-4">
            {editMode && (
              <button
                onClick={() => setShowWidgetLibrary(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-th-primary hover:bg-panel rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add widget
              </button>
            )}

            <button
              onClick={() => setEditMode(!editMode)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-th-primary hover:bg-panel rounded-lg transition-colors"
            >
              {editMode ? <CheckSquare className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              {editMode ? "Done editing" : "Edit widgets"}
            </button>

            {editMode && (
              <button
                onClick={handleSaveDashboard}
                disabled={saving}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm text-white rounded-lg transition-colors ${
                  saving
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-primary-600 hover:bg-primary-700 cursor-pointer"
                }`}
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            )}

            <div className="h-5 w-px bg-th-default"></div>

            <button
              onClick={() => {
                localStorage.removeItem("auth_token");
                document.cookie = "auth_token=; path=/; max-age=0";
                window.location.href = "/auth/login";
              }}
              className="px-4 py-1.5 text-sm text-th-primary hover:bg-panel rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>


        {/* Main Content */}
        <div className="p-6">
          {dashboard.widgets.length === 0 ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="w-full max-w-md">
                <EmptyState
                  icon={<LayoutDashboard className="w-12 h-12" />}
                  title="Your Dashboard is Empty"
                  description="Add widgets to visualize your IoT device data in real time."
                  action={{ label: "Add Widget", onClick: () => setShowWidgetLibrary(true) }}
                />
              </div>
            </div>
          ) : (
            <DashboardGrid
              widgets={dashboard.widgets}
              isEditMode={editMode}
              onLayoutChange={handleLayoutChange}
              onWidgetSettings={handleWidgetSettings}
              onWidgetRemove={handleWidgetRemove}
            />
          )}
        </div>
      </main>

      {/* Widget Library Modal */}
      {showWidgetLibrary && (
        <WidgetLibrary
          isOpen={showWidgetLibrary}
          onClose={() => setShowWidgetLibrary(false)}
          onSelectWidget={(type) => {
            handleAddWidget(type);
            setShowWidgetLibrary(false);
          }}
        />
      )}

      {/* Widget Configuration Modal */}
      {showWidgetConfig && selectedWidget && (
        <WidgetConfigModal
          isOpen={showWidgetConfig}
          widgetType={selectedWidget.widget_type}
          currentConfig={selectedWidget.configuration}
          currentTitle={selectedWidget.title}
          currentDataSources={selectedWidget.data_sources}
          onClose={() => {
            setShowWidgetConfig(false);
            setSelectedWidgetId(null);
          }}
          onSave={handleSaveWidgetConfig}
        />
      )}
    </div>
  );
}
