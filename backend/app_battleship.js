require("dotenv").config({ path: '../.env' });
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { ethers } = require("ethers");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Change this to your frontend URL in production
    methods: ["GET", "POST"]
  }
});

app.use(cors(), bodyParser.json());

// Serve static files from game directory
app.use(express.static(path.join(__dirname, '../game')));

// Ensure contract addresses are set
const { TOKEN_STORE_ADDRESS, PLAY_GAME_ADDRESS } = process.env;
if (!TOKEN_STORE_ADDRESS || !PLAY_GAME_ADDRESS) {
  console.error("Missing contract addresses. Set TOKEN_STORE_ADDRESS and PLAY_GAME_ADDRESS in .env");
  process.exit(1);
}

// Load RPC, private key, contract addresses
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const tokenStoreAbi = require("../artifacts/contracts/TokenStore.sol/TokenStore.json").abi;
const playGameAbi = require("../artifacts/contracts/PlayGame.sol/PlayGame.json").abi;

const tokenStore = new ethers.Contract(TOKEN_STORE_ADDRESS, tokenStoreAbi, wallet);
const playGame = new ethers.Contract(PLAY_GAME_ADDRESS, playGameAbi, wallet);

// =================== GAME STATE MANAGEMENT ===================
let waitingPlayers = [];
let activeGames = {};
let playerSockets = {};

// =================== REST API ENDPOINTS ===================

app.get("/purchase", async (req, res) => {
  try {
    const usdtAmount = ethers.parseUnits(req.query.amount, 6);
    const tx = await tokenStore.buy(usdtAmount);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Match start (keeping your existing one but modified for multiplayer)
app.post("/match/start", async (req, res) => {
  try {
    let { matchId, p1, p2, stake } = req.body;
    // Trim whitespace
    matchId = matchId.trim();
    p1 = p1.trim();
    p2 = p2.trim();
    
    // Validate and normalize player addresses
    if (!ethers.isAddress(p1)) {
      return res.status(400).json({ error: 'Invalid player1 address' });
    }
    if (!ethers.isAddress(p2)) {
      return res.status(400).json({ error: 'Invalid player2 address' });
    }
    
    p1 = ethers.getAddress(p1);
    p2 = ethers.getAddress(p2);
    
    const idHash = ethers.id(matchId);
    const tx1 = await playGame.createMatch(idHash, p1, p2, ethers.parseUnits(stake, 18));
    await tx1.wait();
    
    res.json({ txHash: tx1.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Submit result (keeping your existing one)
app.post("/match/result", async (req, res) => {
  try {
    let { matchId, winner } = req.body;
    // Ensure winner address is hex prefixed
    winner = winner.startsWith('0x') ? winner : `0x${winner}`;
    const idHash = ethers.id(matchId);
    const tx = await playGame.commitResult(idHash, winner);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get game statistics
app.get("/api/stats", (req, res) => {
  res.json({
    activeGames: Object.keys(activeGames).length,
    waitingPlayers: waitingPlayers.length,
    connectedPlayers: Object.keys(playerSockets).length,
    uptime: process.uptime()
  });
});

// Get active games (for debugging)
app.get("/api/games", (req, res) => {
  res.json({
    waitingPlayers: waitingPlayers.map(p => ({
      address: p.playerAddress.substring(0,10) + '...',
      stake: p.stakeAmount,
      waiting: Math.floor((Date.now() - p.timestamp)/1000) + 's'
    })),
    activeGames: Object.keys(activeGames).map(gameId => ({
      gameId,
      status: activeGames[gameId].status,
      players: [
        activeGames[gameId].player1.address.substring(0,10) + '...', 
        activeGames[gameId].player2.address.substring(0,10) + '...'
      ],
      stake: activeGames[gameId].stake
    }))
  });
});

// =================== SOCKET.IO BATTLESHIP GAME INTEGRATION ===================

io.on('connection', (socket) => {
  console.log(`⚓ Admiral connected: ${socket.id}`);

  // Handle matchmaking for naval battles
  socket.on('findMatch', async (data) => {
    const { stake, address } = data;
    const playerAddress = await address; // Resolve promise
    
    console.log(`🔍 Admiral ${playerAddress.slice(0,6)}... seeking battle with ${stake} GT stake`);
    
    // Find opponent with same stake
    const matchingPlayerIndex = waitingPlayers.findIndex(
      p => p.stakeAmount === stake && p.playerAddress.toLowerCase() !== playerAddress.toLowerCase()
    );

    if (matchingPlayerIndex !== -1) {
      // Match found!
      const opponent = waitingPlayers[matchingPlayerIndex];
      const roomId = generateGameId();
      
      console.log(`⚔️ Naval battle matched! Room: ${roomId}`);
      
      // Remove opponent from waiting list  
      waitingPlayers.splice(matchingPlayerIndex, 1);
      
      // Create battle room
      const battle = {
        id: roomId,
        player1: { address: playerAddress, socketId: socket.id, ships: [], ready: false },
        player2: { address: opponent.playerAddress, socketId: opponent.socketId, ships: [], ready: false },
        stake: stake,
        status: 'ship_placement',
        currentTurn: 'player1',
        attackGrid1: Array(25).fill(null), // Player 1's attacks on Player 2
        attackGrid2: Array(25).fill(null), // Player 2's attacks on Player 1
        hitCounts: { player1: 0, player2: 0 },
        sunkShips: { player1: 0, player2: 0 },
        createdAt: Date.now(),
        matchIdHash: null
      };
      
      activeGames[roomId] = battle;
      playerSockets[socket.id] = roomId;
      playerSockets[opponent.socketId] = roomId;
      
      // Join socket rooms
      socket.join(roomId);
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        opponentSocket.join(roomId);
      }

      // Create blockchain match
      try {
        await createBlockchainMatch(roomId, playerAddress, opponent.playerAddress, stake);
        
        // Notify both players
        socket.emit('matchFound', { 
          roomId, 
          role: 'player1',
          opponent: opponent.playerAddress,
          stake: stake
        });
        
        if (opponentSocket) {
          opponentSocket.emit('matchFound', { 
            roomId, 
            role: 'player2',
            opponent: playerAddress,
            stake: stake
          });
        }
      } catch (error) {
        console.error('Blockchain match creation failed:', error);
        socket.emit('error', 'Failed to create blockchain match');
      }
      
    } else {
      // No match, add to waiting list
      waitingPlayers.push({
        socketId: socket.id,
        playerAddress: playerAddress,
        stakeAmount: stake,
        timestamp: Date.now()
      });
      
      console.log(`⏳ Admiral ${playerAddress.slice(0,6)}... added to waiting list`);
    }
  });

  // Handle ship placement
  socket.on('shipsPlaced', (data) => {
    const { roomId, ships } = data;
    const battle = activeGames[roomId];
    
    if (!battle) return;
    
    const playerRole = battle.player1.socketId === socket.id ? 'player1' : 'player2';
    battle[playerRole].ships = ships;
    battle[playerRole].ready = true;
    
    console.log(`🚢 ${playerRole} fleet deployed in room ${roomId}`);
    
    // Check if both players ready
    if (battle.player1.ready && battle.player2.ready) {
      battle.status = 'battle';
      console.log(`⚔️ Battle commences in room ${roomId}!`);
      
      io.to(roomId).emit('shipsReady', {
        player1: battle.player1,
        player2: battle.player2,
        stake: battle.stake,
        currentTurn: battle.currentTurn
      });
      
      io.to(roomId).emit('gameStart', {
        player1: battle.player1,
        player2: battle.player2,
        stake: battle.stake,
        currentTurn: battle.currentTurn
      });
    }
  });

  // Handle attacks
  socket.on('attack', (data) => {
    const { roomId, cellIndex } = data;
    const battle = activeGames[roomId];
    
    if (!battle || battle.status !== 'battle') return;
    
    const playerRole = battle.player1.socketId === socket.id ? 'player1' : 'player2';
    const opponentRole = playerRole === 'player1' ? 'player2' : 'player1';
    
    // Check if it's player's turn
    if (battle.currentTurn !== playerRole) return;
    
    // Check if cell already attacked
    const attackGrid = playerRole === 'player1' ? battle.attackGrid1 : battle.attackGrid2;
    if (attackGrid[cellIndex] !== null) return;
    
    // Process attack
    const opponentShips = battle[opponentRole].ships;
    let result = 'miss';
    let sunkShip = null;
    
    // Check if attack hits any ship
    for (const ship of opponentShips) {
      if (ship.cells.includes(cellIndex)) {
        result = 'hit';
        battle.hitCounts[playerRole]++;
        
        // Check if ship is sunk (all cells hit)
        const shipHits = ship.cells.filter(cell => {
          const grid = playerRole === 'player1' ? battle.attackGrid1 : battle.attackGrid2;
          return grid[cell] === 'hit' || cell === cellIndex;
        });
        
        if (shipHits.length === ship.cells.length) {
          result = 'sunk';
          battle.sunkShips[playerRole]++;
          sunkShip = ship;
          console.log(`💥 ${ship.name} sunk in room ${roomId}!`);
        }
        break;
      }
    }
    
    // Record attack
    attackGrid[cellIndex] = result;
    
    console.log(`🎯 Attack in room ${roomId}: ${playerRole} -> ${cellIndex} = ${result}`);
    
    // Check for game over (all 3 ships sunk)
    if (battle.sunkShips[playerRole] >= 3) {
      battle.status = 'game_over';
      const winner = battle[playerRole];
      const loser = battle[opponentRole];
      
      console.log(`🏆 Game over in room ${roomId}! Winner: ${winner.address}`);
      
      // Process blockchain result
      processGameResult(roomId, winner.address, loser.address, battle.stake)
        .then((txHash) => {
          io.to(roomId).emit('gameOver', {
            winner: winner,
            loser: loser,
            stake: battle.stake,
            txHash: txHash
          });
          
          // Clean up
          delete activeGames[roomId];
          delete playerSockets[battle.player1.socketId];
          delete playerSockets[battle.player2.socketId];
        })
        .catch((error) => {
          console.error('Failed to process game result:', error);
          io.to(roomId).emit('error', 'Failed to process victory');
        });
      
    } else {
      // Switch turns
      battle.currentTurn = opponentRole;
      
      // Notify both players of attack result
      io.to(roomId).emit('attackResult', {
        cellIndex: cellIndex,
        result: result,
        attacker: playerRole,
        nextTurn: battle.currentTurn,
        sunkShip: sunkShip
      });
    }
  });

  // Handle cancel search
  socket.on('cancelSearch', () => {
    const index = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      waitingPlayers.splice(index, 1);
      console.log(`❌ Player ${socket.id} cancelled search`);
    }
  });

  // Handle leave game
  socket.on('leaveGame', (data) => {
    const { roomId } = data;
    const battle = activeGames[roomId];
    
    if (battle) {
      // Notify opponent
      socket.to(roomId).emit('playerLeft');
      
      // Clean up
      delete activeGames[roomId];
      if (battle.player1.socketId) delete playerSockets[battle.player1.socketId];
      if (battle.player2.socketId) delete playerSockets[battle.player2.socketId];
      
      console.log(`🏃‍♂️ Player abandoned battle in room ${roomId}`);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`⚓ Admiral disconnected: ${socket.id}`);
    
    // Remove from waiting list
    const waitingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Handle active game
    const gameId = playerSockets[socket.id];
    if (gameId && activeGames[gameId]) {
      const battle = activeGames[gameId];
      
      // Notify opponent
      socket.to(gameId).emit('playerLeft');
      
      // Clean up
      delete activeGames[gameId];
      delete playerSockets[battle.player1?.socketId];
      delete playerSockets[battle.player2?.socketId];
      
      console.log(`💀 Battle ${gameId} terminated due to disconnection`);
    }
    
    delete playerSockets[socket.id];
  });
});

// =================== BLOCKCHAIN HELPER FUNCTIONS ===================

async function createBlockchainMatch(gameId, player1Address, player2Address, stake) {
  try {
    const idHash = ethers.id(gameId);
    const stakeAmount = ethers.parseUnits(stake.toString(), 18);
    
    const tx = await playGame.createMatch(idHash, player1Address, player2Address, stakeAmount);
    await tx.wait();
    
    console.log(`⛓️ Blockchain match created: ${tx.hash}`);
    
    if (activeGames[gameId]) {
      activeGames[gameId].matchIdHash = idHash;
    }
    
    return tx.hash;
  } catch (error) {
    console.error('Blockchain match creation failed:', error);
    throw error;
  }
}

async function processGameResult(gameId, winnerAddress, loserAddress, stake) {
  try {
    const idHash = ethers.id(gameId);
    const tx = await playGame.commitResult(idHash, winnerAddress);
    await tx.wait();
    
    console.log(`⛓️ Victory recorded on blockchain: ${tx.hash}`);
    console.log(`🏆 Winner: ${winnerAddress} | Prize: ${stake * 2} GT`);
    
    return tx.hash;
  } catch (error) {
    console.error('Failed to process blockchain result:', error);
    throw error;
  }
}

function generateGameId() {
  return 'battle_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// =================== START SERVER ===================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌊 Crypto Naval Battle Server running on port ${PORT}`);
  console.log(`⚓ Ready for blockchain battleship battles!`);
  console.log(`🎮 Game available at: http://localhost:${PORT}`);
});
