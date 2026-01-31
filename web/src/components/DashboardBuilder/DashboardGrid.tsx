"use client";

// TODO: Upgrade react-grid-layout from v1.4.4 to v2.x+ before production
// Currently using v1.4.4 for stability during development
// See CLEANUP_TODO.md for upgrade steps
import RGL from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { useState, useCallback } from "react";
import KPICard from "../Widgets/KPICard";
import ChartWidget from "../Widgets/ChartWidget";
import WidgetWrapper from "../Widgets/WidgetWrapper";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const { Responsive, WidthProvider } = RGL;
const ResponsiveGridLayout = WidthProvider(Responsive);

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

interface DashboardGridProps {
  widgets: Widget[];
  isEditMode?: boolean;
  onLayoutChange?: (widgets: Widget[]) => void;
  onWidgetSettings?: (widgetId: string) => void;
  onWidgetRemove?: (widgetId: string) => void;
}

export default function DashboardGrid({
  widgets,
  isEditMode = false,
  onLayoutChange,
  onWidgetSettings,
  onWidgetRemove,
}: DashboardGridProps) {
  const [layouts, setLayouts] = useState<{ lg: Layout[] }>({
    lg: widgets.map((w) => ({
      i: w.id,
      x: w.position_x,
      y: w.position_y,
      w: w.width,
      h: w.height,
      minW: 1,
      minH: 1,
      maxW: 12,
    })),
  });

  const handleLayoutChange = useCallback(
    (layout: Layout[], layouts: any) => {
      setLayouts({ lg: layout });

      if (onLayoutChange) {
        // Map layout changes back to widget positions
        const updatedWidgets = widgets.map((widget) => {
          const layoutItem = layout.find((l) => l.i === widget.id);
          if (layoutItem) {
            return {
              ...widget,
              position_x: layoutItem.x,
              position_y: layoutItem.y,
              width: layoutItem.w,
              height: layoutItem.h,
            };
          }
          return widget;
        });
        onLayoutChange(updatedWidgets);
      }
    },
    [widgets, onLayoutChange]
  );

  const renderWidget = (widget: Widget) => {
    switch (widget.widget_type) {
      case "kpi_card":
        return (
          <KPICard
            key={widget.id}
            id={widget.id}
            title={widget.title}
            configuration={widget.configuration}
            data_sources={widget.data_sources}
            isEditMode={isEditMode}
            onSettings={() => onWidgetSettings?.(widget.id)}
            onRemove={() => onWidgetRemove?.(widget.id)}
          />
        );

      case "chart":
        return (
          <WidgetWrapper
            key={widget.id}
            title={widget.title || "Chart"}
            isEditMode={isEditMode}
            onSettings={() => onWidgetSettings?.(widget.id)}
            onRemove={() => onWidgetRemove?.(widget.id)}
          >
            <ChartWidget
              config={widget.configuration}
              dataSources={widget.data_sources}
            />
          </WidgetWrapper>
        );

      // TODO: Add more widget types in Iteration 3 (gauge, map, table, etc.)

      default:
        return (
          <div
            key={widget.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-center"
          >
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p className="text-sm font-medium">Unknown Widget Type</p>
              <p className="text-xs mt-1">{widget.widget_type}</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="dashboard-grid-container">
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={80}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        onLayoutChange={handleLayoutChange}
        draggableCancel="button, input, select, textarea"
        compactType="vertical"
        preventCollision={false}
      >
        {widgets.map((widget) => (
          <div
            key={widget.id}
            data-grid={{
              x: widget.position_x,
              y: widget.position_y,
              w: widget.width,
              h: widget.height,
            }}
          >
            {renderWidget(widget)}
          </div>
        ))}
      </ResponsiveGridLayout>

      <style jsx global>{`
        .dashboard-grid-container {
          padding: 1rem;
        }

        .react-grid-layout {
          position: relative;
          transition: height 200ms ease;
        }

        .react-grid-item {
          transition: all 200ms ease;
          transition-property: left, top, width, height;
        }

        .react-grid-item img {
          pointer-events: none;
          user-select: none;
        }

        .react-grid-item.static {
          background: #ccc;
        }

        .react-grid-item > .react-resizable-handle {
          position: absolute;
          width: 20px;
          height: 20px;
        }

        .react-grid-item > .react-resizable-handle::after {
          content: "";
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 5px;
          height: 5px;
          border-right: 2px solid rgba(0, 0, 0, 0.4);
          border-bottom: 2px solid rgba(0, 0, 0, 0.4);
        }

        .react-grid-item.resizing {
          transition: none;
          z-index: 100;
          will-change: width, height;
        }

        .react-grid-item.react-draggable-dragging {
          transition: none;
          z-index: 100;
          will-change: transform;
          cursor: grabbing;
        }

        .react-grid-item.dropping {
          visibility: hidden;
        }

        .react-grid-item.react-grid-placeholder {
          background: rgb(59, 130, 246);
          opacity: 0.2;
          transition-duration: 100ms;
          z-index: 2;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          -o-user-select: none;
          user-select: none;
          border-radius: 0.5rem;
        }

        .react-resizable-handle {
          background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2IDYiIHN0eWxlPSJiYWNrZ3JvdW5kLWNvbG9yOiNmZmZmZmYwMCIgeD0iMHB4IiB5PSIwcHgiIHdpZHRoPSI2cHgiIGhlaWdodD0iNnB4Ij48ZyBvcGFjaXR5PSIwLjMwMiI+PHBhdGggZD0iTSA2IDYgTCAwIDYgTCAwIDQuMiBMIDQgNC4yIEwgNC4yIDQuMiBMIDQuMiAwIEwgNiAwIEwgNiA2IEwgNiA2IFoiIGZpbGw9IiMwMDAwMDAiLz48L2c+PC9zdmc+');
          background-position: bottom right;
          background-repeat: no-repeat;
          padding: 0 3px 3px 0;
          cursor: se-resize;
        }
      `}</style>
    </div>
  );
}
