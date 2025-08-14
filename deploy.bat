@echo off
echo 🚀 Deploying TriX Naval Battle...

REM Check if all required files exist
if not exist "backend\app.js" (
    echo ❌ Backend server not found!
    exit /b 1
)

if not exist "game\index.html" (
    echo ❌ Frontend files not found!
    exit /b 1
)

if not exist "hardhat.config.js" (
    echo ❌ Hardhat config not found!
    exit /b 1
)

echo ✅ All files present

REM Install dependencies
echo 📦 Installing dependencies...
npm install

REM Start blockchain in background
echo ⛓️ Starting blockchain...
start /b npx hardhat node

REM Wait for blockchain to start
timeout /t 5 /nobreak

REM Deploy contracts
echo 📋 Deploying contracts...
npx hardhat run scripts/deploy.js --network localhost

echo ⚠️ Remember to update .env with deployed contract addresses
echo 🎮 Starting game server...
echo 🌐 Game will be available at http://localhost:3000
echo 🔗 Configure MetaMask: http://127.0.0.1:8545, Chain ID: 31337
echo.
echo 🚀 Deployment complete!

REM Start the game server
node backend/app.js
