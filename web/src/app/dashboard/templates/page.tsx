"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import {
  Droplet,
  Zap,
  Cloud,
  Truck,
  Factory,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Info,
} from "lucide-react";

interface SolutionTemplate {
  id: string;
  name: string;
  identifier: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  target_device_types: string[];
  required_capabilities: string[];
  is_active: boolean;
  compatible_device_count?: number;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  droplet: <Droplet className="w-8 h-8" />,
  zap: <Zap className="w-8 h-8" />,
  cloud: <Cloud className="w-8 h-8" />,
  truck: <Truck className="w-8 h-8" />,
  factory: <Factory className="w-8 h-8" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  utilities: "bg-blue-100 text-blue-700",
  environmental: "bg-green-100 text-green-700",
  fleet: "bg-purple-100 text-purple-700",
  industry_4_0: "bg-red-100 text-red-700",
};

export default function TemplateGalleryPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<SolutionTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);

      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/solution-templates`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch templates");
      }

      const data = await response.json();
      setTemplates(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching templates:", err);
      setError("Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    try {
      setApplyingTemplate(templateId);

      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const template = templates.find((t) => t.id === templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/solution-templates/${templateId}/apply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dashboard_name: `${template.name} Dashboard`,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to apply template");
      }

      const data = await response.json();
      router.push(`/dashboard`);
    } catch (err) {
      console.error("Error applying template:", err);
      alert("Failed to apply template");
    } finally {
      setApplyingTemplate(null);
    }
  };

  const categories = Array.from(new Set(templates.map((t) => t.category)));
  const filteredTemplates = selectedCategory
    ? templates.filter((t) => t.category === selectedCategory)
    : templates;

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Solution Templates
                </h1>
                <p className="text-gray-600 mt-1">
                  Pre-built dashboards for industry-specific use cases
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8">
          {/* Info Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-blue-900">
                Quick Start with Templates
              </h3>
              <p className="text-sm text-blue-700 mt-1">
                Templates provide ready-to-use dashboards with widgets configured for specific industries.
                Simply select a template, and we&apos;ll create a customized dashboard you can further personalize.
              </p>
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                selectedCategory === null
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              All Categories
            </button>
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedCategory === category
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </button>
            ))}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-red-900">{error}</h3>
                <button
                  onClick={fetchTemplates}
                  className="text-sm text-red-700 hover:text-red-900 underline mt-2"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Template Grid */}
          {!isLoading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-all group"
                >
                  {/* Template Header */}
                  <div
                    className="p-6 flex items-center gap-4"
                    style={{ backgroundColor: `${template.color}10` }}
                  >
                    <div
                      className="p-3 rounded-lg"
                      style={{ backgroundColor: template.color, color: "white" }}
                    >
                      {ICON_MAP[template.icon] || <Factory className="w-8 h-8" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-lg">
                        {template.name}
                      </h3>
                      <span
                        className={`inline-block text-xs px-2 py-1 rounded-full mt-1 ${
                          CATEGORY_COLORS[template.category] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {template.category.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  {/* Template Body */}
                  <div className="p-6">
                    <p className="text-sm text-gray-600 mb-4">
                      {template.description}
                    </p>

                    <div className="space-y-2 mb-4">
                      {template.compatible_device_count !== undefined && template.compatible_device_count > 0 ? (
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-gray-600">
                            {template.compatible_device_count} compatible {template.compatible_device_count === 1 ? 'device' : 'devices'} found
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-gray-600">
                            No compatible devices yet
                          </span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-gray-600">
                          Pre-configured widgets and layouts
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleApplyTemplate(template.id)}
                      disabled={applyingTemplate === template.id}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {applyingTemplate === template.id ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Applying...
                        </>
                      ) : (
                        "Use Template"
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && filteredTemplates.length === 0 && (
            <div className="text-center py-20">
              <Info className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No templates found
              </h3>
              <p className="text-gray-600">
                Try selecting a different category or check back later.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
