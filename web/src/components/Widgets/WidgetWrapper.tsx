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
      className={`gito-card h-full flex flex-col overflow-hidden ${
        isEditMode ? "cursor-move hover:border-blue-400" : ""
      } ${className}`}
    >
      {/* Widget Header — quiet label, part of the card surface (no divider bar) */}
      {(title || isEditMode) && (
        <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-th-secondary truncate" title={title}>
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
                  className="p-1 text-th-muted hover:text-th-secondary cursor-pointer z-50"
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
                  className="p-1 text-th-muted hover:text-red-600 cursor-pointer z-50"
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
