'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface Device {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  last_seen: string | null;
  battery_level: number | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface Alarm {
  id: string;
  device_id: string;
  alarm_type: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING';
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED';
  message?: string | null;
  fired_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [recentAlarms, setRecentAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        // Load devices
        const devResponse = await fetch(`/api/v1/tenants/${tenant}/devices`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const devData = await devResponse.json();

        if (!devResponse.ok) {
          throw new Error(devData.error?.message || 'Failed to load devices');
        }

        setDevices(devData.data || []);

        // Load recent alarms (all statuses, latest 5)
        const alarmResponse = await fetch(`/api/v1/tenants/${tenant}/alarms?page=1&per_page=5`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const alarmData = await alarmResponse.json();

        if (alarmResponse.ok) {
          console.log('Loaded alarms:', alarmData.data); // DEBUG
          setRecentAlarms(alarmData.data || []);
        } else {
          console.error('Failed to load alarms:', alarmData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [router]);

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + 
           ' ' + date.toTimeString().slice(0, 5);
  };

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    idle: devices.filter(d => d.status === 'idle').length,
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 ml-64">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button className="p-1 text-gray-600 hover:text-gray-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-gray-900">Home</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setEditMode(!editMode)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {editMode ? 'Done editing' : 'Edit widgets'}
            </button>
            
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Dashboard settings
            </button>
            
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset widgets
            </button>
            
            <button
              onClick={() => {
                localStorage.removeItem('auth_token');
                document.cookie = 'auth_token=; path=/; max-age=0';
                window.location.href = '/auth/login';
              }}
              className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            
            {/* Quick Links Widget */}
            <div className="bg-white rounded border border-gray-200 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Quick Links</h2>
                <div className="flex gap-2">
                  <button className="p-1 text-gray-400 hover:text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  </button>
                  <button className="p-1 text-gray-400 hover:text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-3 gap-4">
                  <Link href="/dashboard/devices" className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">All devices</span>
                  </Link>
                  
                  <Link href="/dashboard/devices/new" className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">Register device</span>
                  </Link>
                  
                  <button className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">Add group</span>
                  </button>
                  
                  <button className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">Add device profile</span>
                  </button>
                  
                  <button className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">Add software</span>
                  </button>
                  
                  <button className="flex flex-col items-center gap-3 p-4 rounded hover:bg-gray-50 transition-colors group">
                    <div className="w-12 h-12 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors">Add firmware</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Recent Alarms Widget */}
            <div className="bg-white rounded border border-gray-200 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Recent Alarms</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">AUTO REFRESH</span>
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </button>
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {recentAlarms.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-500">
                    <p className="text-sm">No active alarms</p>
                  </div>
                ) : (
                  recentAlarms.map((alarm) => {
                    const severityColor = alarm.severity === 'CRITICAL' ? 'bg-red-100 text-red-600' : alarm.severity === 'MAJOR' ? 'bg-orange-100 text-orange-600' : 'bg-yellow-100 text-yellow-600';
                    const icon = alarm.severity === 'CRITICAL' ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    );
                    const deviceName = devices.find(d => d.id === alarm.device_id)?.name || 'Unknown Device';
                    return (
                      <div key={alarm.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={`flex-shrink-0 mt-0.5 w-8 h-8 rounded-full ${severityColor} flex items-center justify-center`}>
                            {icon}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{alarm.alarm_type}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-500">{deviceName}</span>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500">{alarm.message || 'No details'}</span>
                            </div>
                          </div>
                          
                          <div className="flex-shrink-0 text-right">
                            <div className="text-xs text-gray-500">
                              {formatTimestamp(alarm.fired_at).split(' ')[0]}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              <div className="px-4 py-2 border-t border-gray-200 text-center">
                <Link href="/dashboard/alarms" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  View all alarms →
                </Link>
              </div>
            </div>
          </div>

          {/* Device Statistics */}
          <div className="bg-white rounded border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Device Overview</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
                  <div className="text-sm text-gray-600 mt-1">Total Devices</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{stats.online}</div>
                  <div className="text-sm text-gray-600 mt-1">Online</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-600">{stats.offline}</div>
                  <div className="text-sm text-gray-600 mt-1">Offline</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-yellow-600">{stats.idle}</div>
                  <div className="text-sm text-gray-600 mt-1">Idle</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
