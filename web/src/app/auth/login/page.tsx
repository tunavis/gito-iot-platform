'use client';

import { useState, FormEvent } from 'react';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (isLoading || isRedirecting) {
      console.log('Already processing, ignoring submission');
      return;
    }
    
    setError('');
    setIsLoading(true);

    try {
      console.log('Attempting login...');
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);

      if (!response.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      // Store token
      if (data.data?.access_token) {
        console.log('Token received, storing...');
        const token = data.data.access_token;
        
        // Store in localStorage
        localStorage.setItem('auth_token', token);
        
        // CRITICAL: Also store in cookie for middleware
        document.cookie = `auth_token=${token}; path=/; max-age=86400; SameSite=Lax`;
        
        console.log('Token stored in localStorage and cookie');
        setIsRedirecting(true);
        
        // Use router.push for proper Next.js navigation
        console.log('Navigating to dashboard...');
        window.location.href = '/dashboard';
      } else {
        console.error('No access token in response');
        setError('No access token received');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <Image
              src="/images/GitoLogo.png"
              alt="Gito IT Solutions"
              width={168}
              height={50}
              style={{ maxHeight: '56px', width: 'auto', height: 'auto' }}
              priority
              unoptimized
            />
          </div>

          <p className="text-gray-600">Sign in to your account</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded border border-gray-300 shadow-lg p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <div className="rounded-md bg-red-50 p-4 border border-red-200">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Demo Credentials */}
          <div className="rounded-md bg-blue-50 p-4 border border-blue-200">
            <p className="text-sm text-blue-800 font-medium">Demo Credentials:</p>
            <p className="text-sm text-blue-700 mt-1">Email: admin@gito.demo</p>
            <p className="text-sm text-blue-700">Password: admin123</p>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="name@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="••••••••"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || isRedirecting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2.5 px-4 rounded transition-colors"
          >
            {isRedirecting ? 'Redirecting...' : isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-600">
          Phase 1 Demo • Production-grade IoT Platform
        </p>
      </div>
    </div>
  );
}
