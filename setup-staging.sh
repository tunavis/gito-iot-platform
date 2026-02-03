#!/bin/bash
# Gito IoT Staging Server Setup Script
# Run this on your staging server: bash setup-staging.sh

set -e  # Exit on error

echo "🚀 Setting up Gito IoT Staging Server..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed: $(docker --version)"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed: $(docker-compose --version)"
fi

# Create app directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/gito-iot
sudo chown $USER:$USER /opt/gito-iot
cd /opt/gito-iot

# Clone or update repository
if [ ! -d ".git" ]; then
    echo "📥 Cloning repository..."
    git clone https://github.com/tunavis/gito-iot-platform.git .
    git checkout staging
    echo "✅ Repository cloned"
else
    echo "📥 Updating repository..."
    git fetch origin
    git checkout staging
    git pull origin staging
    echo "✅ Repository updated"
fi

# Copy environment file
if [ ! -f ".env.staging" ]; then
    echo "⚙️  Creating environment file..."
    cp .env.staging.example .env.staging
    echo "✅ Environment file created at /opt/gito-iot/.env.staging"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env.staging with your actual values:"
    echo "   nano /opt/gito-iot/.env.staging"
    echo ""
    echo "   Set these values:"
    echo "   - DATABASE_URL password"
    echo "   - JWT_SECRET_KEY (generate: openssl rand -hex 32)"
    echo "   - MQTT_PASSWORD"
    echo "   - CORS_ORIGINS"
else
    echo "✅ Environment file already exists"
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Edit environment file: nano /opt/gito-iot/.env.staging"
echo "2. Generate JWT secret: openssl rand -hex 32"
echo "3. Logout and login for Docker group: exit && ssh mark@192.168.0.9"
echo "4. Start services: cd /opt/gito-iot && docker-compose -f docker-compose.staging.yml up -d"
echo ""
echo "📍 Application directory: /opt/gito-iot"
echo "🌿 Branch: staging"
