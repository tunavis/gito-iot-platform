"use client";

import { Settings, X } from "lucide-react";
import { ReactNode } from "react";

interface WidgetWrapperProps {
  children: ReactNode;
  title?: string;
  onSettings?: () => void;
  onRemove?: () => void;
  isEditMode?: boolean;
  className?: string;
}

export default function WidgetWrapper({
  children,
  title,
  onSettings,
  onRemove,
  isEditMode = false,
  className = "",
}: WidgetWrapperProps) {
  return (
    <div
      className={`bg-white rounded border border-gray-200 shadow-sm h-full flex flex-col ${
        isEditMode ? "cursor-move hover:border-blue-400" : ""
      } ${className}`}
    >
      {/* Widget Header */}
      {(title || isEditMode) && (
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            {title || "Widget"}
          </h2>

          {isEditMode && (
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {onSettings && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSettings();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer z-50"
                  title="Widget Settings"
                  type="button"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
              {onRemove && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 cursor-pointer z-50"
                  title="Remove Widget"
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Widget Content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
