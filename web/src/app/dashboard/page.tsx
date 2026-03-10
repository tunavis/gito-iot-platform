'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import DashboardGrid from '@/components/DashboardBuilder/DashboardGrid';
import WidgetLibrary from '@/components/DashboardBuilder/WidgetLibrary';
import WidgetConfigModal from '@/components/DashboardBuilder/WidgetConfigModal';
import EmptyState from '@/components/ui/EmptyState';
import { btn } from '@/components/ui/buttonStyles';
import { LayoutDashboard, Plus, Pencil, CheckSquare, Save } from 'lucide-react';

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

  const getAuthInfo = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth/login');
      return null;
    }
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { token, tenant: payload.tenant_id };
  }, [router]);

  const createDefaultDashboard = async (tenantId: string, token: string) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}/dashboards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'My Dashboard',
        description: 'Default dashboard',
        is_default: true,
      }),
    });

    if (!response.ok) throw new Error('Failed to create dashboard');

    const result = await response.json();
    setDashboard({
      id: result.id,
      name: result.name,
      description: result.description,
      is_default: result.is_default,
      widgets: [],
    });
  };

  const loadDefaultDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const auth = getAuthInfo();
      if (!auth) return;

      const response = await fetch(`/api/v1/tenants/${auth.tenant}/dashboards`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      if (!response.ok) throw new Error('Failed to load dashboards');

      const dashboards = await response.json();
      const defaultDashboard =
        dashboards.find((d: Dashboard) => d.is_default) || dashboards[0];

      if (defaultDashboard) {
        const dashResponse = await fetch(
          `/api/v1/tenants/${auth.tenant}/dashboards/${defaultDashboard.id}`,
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );

        if (dashResponse.ok) {
          setDashboard(await dashResponse.json());
        } else {
          await createDefaultDashboard(auth.tenant, auth.token);
        }
      } else {
        await createDefaultDashboard(auth.tenant, auth.token);
      }
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');

      try {
        const auth = getAuthInfo();
        if (auth) await createDefaultDashboard(auth.tenant, auth.token);
      } catch {
        // Failed to create fallback dashboard
      }
    } finally {
      setLoading(false);
    }
  }, [getAuthInfo]);

  useEffect(() => {
    loadDefaultDashboard();
  }, [loadDefaultDashboard]);

  const handleSaveDashboard = async () => {
    if (!dashboard?.id) return;

    setSaving(true);
    try {
      const auth = getAuthInfo();
      if (!auth) return;

      const response = await fetch(
        `/api/v1/tenants/${auth.tenant}/dashboards/${dashboard.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            name: dashboard.name,
            description: dashboard.description,
            is_default: dashboard.is_default,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to update dashboard');
      toast.success('Dashboard saved', 'Dashboard saved successfully!');
    } catch (err: any) {
      toast.error('Failed to save dashboard', err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddWidget = async (widgetType: any) => {
    if (!dashboard) return;

    const auth = getAuthInfo();
    if (!auth) return;

    if (!dashboard.id) {
      await handleSaveDashboard();
      return;
    }

    try {
      const response = await fetch(
        `/api/v1/tenants/${auth.tenant}/dashboards/${dashboard.id}/widgets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
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

      if (!response.ok) throw new Error('Failed to add widget');

      const result = await response.json();
      setDashboard({ ...dashboard, widgets: [...dashboard.widgets, result] });
    } catch {
      toast.error('Failed to add widget');
    }
  };

  const handleLayoutChange = async (updatedWidgets: Widget[]) => {
    if (!dashboard?.id) return;

    setDashboard({ ...dashboard, widgets: updatedWidgets });

    try {
      const auth = getAuthInfo();
      if (!auth) return;

      await fetch(
        `/api/v1/tenants/${auth.tenant}/dashboards/${dashboard.id}/layout`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            widgets: updatedWidgets.map((w) => ({
              widget_id: w.id,
              position_x: w.position_x,
              position_y: w.position_y,
              width: w.width,
              height: w.height,
            })),
          }),
        }
      );
    } catch {
      // Layout sync is best-effort
    }
  };

  const handleWidgetSettings = (widgetId: string) => {
    setSelectedWidgetId(widgetId);
    setShowWidgetConfig(true);
  };

  const handleWidgetRemove = async (widgetId: string) => {
    if (!dashboard?.id) return;

    const ok = await toast.confirm(
      'Are you sure you want to remove this widget?',
      { title: 'Remove Widget', variant: 'danger', confirmLabel: 'Remove' }
    );
    if (!ok) return;

    try {
      const auth = getAuthInfo();
      if (!auth) return;

      const response = await fetch(
        `/api/v1/tenants/${auth.tenant}/dashboards/${dashboard.id}/widgets/${widgetId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` } }
      );

      if (!response.ok) throw new Error('Failed to remove widget');

      setDashboard({
        ...dashboard,
        widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
      });
    } catch {
      toast.error('Failed to remove widget');
    }
  };

  const handleSaveWidgetConfig = async (
    config: any,
    title?: string,
    dataSources?: any[]
  ) => {
    if (!selectedWidgetId || !dashboard?.id) return;

    try {
      const auth = getAuthInfo();
      if (!auth) return;

      const response = await fetch(
        `/api/v1/tenants/${auth.tenant}/dashboards/${dashboard.id}/widgets/${selectedWidgetId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            title,
            configuration: config,
            data_sources: dataSources,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to update widget');

      const result = await response.json();
      setDashboard({
        ...dashboard,
        widgets: dashboard.widgets.map((w) =>
          w.id === selectedWidgetId ? result : w
        ),
      });
    } catch {
      toast.error('Failed to update widget configuration');
    }
  };

  const selectedWidget = dashboard?.widgets.find(
    (w) => w.id === selectedWidgetId
  );

  // Loading state
  if (loading) {
    return (
      <PageShell title="Dashboard" subtitle="Loading your dashboard...">
        <div className="flex items-center justify-center py-20">
          <div className="text-th-secondary text-sm">Loading dashboard...</div>
        </div>
      </PageShell>
    );
  }

  // Error state (no dashboard loaded)
  if (error && !dashboard) {
    return (
      <PageShell title="Dashboard" subtitle="Something went wrong">
        <div className="flex items-center justify-center min-h-[60vh]">
          <EmptyState
            title="Failed to Load Dashboard"
            description={error}
            action={{ label: 'Retry', onClick: () => window.location.reload() }}
          />
        </div>
      </PageShell>
    );
  }

  // No dashboard state
  if (!dashboard) {
    return (
      <PageShell title="Dashboard" subtitle="Get started">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-md">
            <EmptyState
              icon={<LayoutDashboard className="w-12 h-12" />}
              title="No Dashboard Found"
              description="Get started by creating your first dashboard."
              action={{ label: 'Create Dashboard', onClick: loadDefaultDashboard }}
            />
          </div>
        </div>
      </PageShell>
    );
  }

  // Header actions
  const pageAction = (
    <div className="flex items-center gap-2">
      {editMode && (
        <button
          onClick={() => setShowWidgetLibrary(true)}
          className={`${btn.ghost} flex items-center gap-2`}
        >
          <Plus className="w-4 h-4" />
          Add Widget
        </button>
      )}
      <button
        onClick={() => setEditMode(!editMode)}
        className={`${btn.secondary} flex items-center gap-2`}
      >
        {editMode ? (
          <CheckSquare className="w-4 h-4" />
        ) : (
          <Pencil className="w-4 h-4" />
        )}
        {editMode ? 'Done' : 'Edit'}
      </button>
      {editMode && (
        <button
          onClick={handleSaveDashboard}
          disabled={saving}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
    </div>
  );

  return (
    <PageShell
      title={dashboard.name}
      subtitle={
        editMode
          ? 'Drag widgets to rearrange, click settings to configure'
          : `${dashboard.widgets.length} widget${dashboard.widgets.length !== 1 ? 's' : ''}`
      }
      icon={<LayoutDashboard className="w-4 h-4" />}
      action={pageAction}
    >
      {dashboard.widgets.length === 0 ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-md">
            <EmptyState
              icon={<LayoutDashboard className="w-12 h-12" />}
              title="Your Dashboard is Empty"
              description="Add widgets to visualize your IoT device data in real time."
              action={{
                label: 'Add Widget',
                onClick: () => setShowWidgetLibrary(true),
              }}
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
    </PageShell>
  );
}
