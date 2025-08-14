#!/bin/bash

# TriX Naval Battle - Deployment Script
echo "🚀 Deploying TriX Naval Battle..."

# Check if all required files exist
if [ ! -f "backend/app.js" ]; then
    echo "❌ Backend server not found!"
    exit 1
fi

if [ ! -f "game/index.html" ]; then
    echo "❌ Frontend files not found!"
    exit 1
fi

if [ ! -f "hardhat.config.js" ]; then
    echo "❌ Hardhat config not found!"
    exit 1
fi

echo "✅ All files present"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Start blockchain (background)
echo "⛓️ Starting blockchain..."
npx hardhat node &
BLOCKCHAIN_PID=$!

# Wait for blockchain to start
sleep 5

# Deploy contracts
echo "📋 Deploying contracts..."
npx hardhat run scripts/deploy.js --network localhost

# Update .env with addresses (this would need to be done manually)
echo "⚠️ Remember to update .env with deployed contract addresses"

echo "🎮 Starting game server..."
echo "🌐 Game will be available at http://localhost:3000"
echo "🔗 Configure MetaMask: http://127.0.0.1:8545, Chain ID: 31337"
echo ""
echo "🚀 Deployment complete!"
echo "To stop: kill $BLOCKCHAIN_PID"

# Start the game server
node backend/app.js
