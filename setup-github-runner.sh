#!/bin/bash
# Install GitHub Actions Self-Hosted Runner
# Run this on your staging server

set -e

echo "🚀 Setting up GitHub Actions Runner..."

# Create runner directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download latest runner
echo "📥 Downloading GitHub Runner..."
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz

# Extract
echo "📦 Extracting..."
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

echo ""
echo "✅ Runner downloaded and extracted!"
echo ""
echo "📋 Next steps:"
echo "1. Go to: https://github.com/tunavis/gito-iot-platform/settings/actions/runners/new"
echo "2. Select 'Linux' as OS"
echo "3. Copy the configuration command that looks like:"
echo "   ./config.sh --url https://github.com/tunavis/gito-iot-platform --token YOUR_TOKEN"
echo ""
echo "4. Run that command in ~/actions-runner directory"
echo "5. When prompted:"
echo "   - Runner name: staging-server"
echo "   - Labels: staging,self-hosted"
echo "   - Work folder: press Enter for default"
echo ""
echo "6. Start the runner as a service:"
echo "   sudo ./svc.sh install"
echo "   sudo ./svc.sh start"
echo ""
echo "Current directory: $(pwd)"
