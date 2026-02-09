#!/bin/bash
# Fix divergent branches on staging server

set -e

echo "🔧 Fixing git divergent branches on staging server..."

cd /opt/gito-iot

echo "📊 Current git status:"
git status

echo ""
echo "⚙️  Configuring git pull strategy..."
git config pull.rebase false

echo ""
echo "📥 Fetching latest from remote..."
git fetch origin

echo ""
echo "🔄 Resetting to match remote staging branch..."
git reset --hard origin/staging

echo ""
echo "✅ Git repository fixed!"
echo ""
echo "📊 Final status:"
git status

echo ""
echo "🚀 Ready to deploy! The next GitHub Actions run will succeed."
