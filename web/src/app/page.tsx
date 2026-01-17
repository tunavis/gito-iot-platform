'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is logged in by checking for auth token
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    
    if (token) {
      router.push('/dashboard');
    } else {
      router.push('/auth/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="text-center">
        <div className="inline-block animate-spin mb-4">
          <div className="w-12 h-12 border-4 border-gray-300 border-t-gray-700 rounded-full"></div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Gito IoT Platform</h1>
        <p className="text-gray-600 mt-2">Loading...</p>
      </div>
    </div>
  );
}
