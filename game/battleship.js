// Crypto Naval Battle - Battleship Game Logic
// Author: Custom implementation for TriX blockchain integration
// Game: 5x5 grid, 3 ships (1x3, 2x2), real-time Socket.IO multiplayer

class NavalBattle {
  constructor() {
    // Contract addresses - update these with your deployment
    this.MOCK_USDT_ADDRESS = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
    this.TOKEN_STORE_ADDRESS = '0x0165878A594ca255338adfa4d48449f69242Eb8F';
    this.GAME_TOKEN_ADDRESS = '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707';
    this.PLAY_GAME_ADDRESS = '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6';

    // Game state
    this.provider = null;
    this.signer = null;
    this.socket = null;
    this.gameState = 'disconnected'; // disconnected, wallet_connected, matchmaking, placing_ships, battle, game_over
    this.playerGrid = Array(25).fill(null); // 5x5 = 25 cells
    this.enemyGrid = Array(25).fill(null);
    this.ships = [
      { name: 'destroyer', size: 2, placed: false, cells: [] },
      { name: 'cruiser', size: 2, placed: false, cells: [] },
      { name: 'battleship', size: 3, placed: false, cells: [] }
    ];
    this.selectedShip = null;
    this.isHorizontal = true;
    this.gameRoom = null;
    this.playerRole = null; // 'player1' or 'player2'
    this.currentTurn = null;
    
    // Contract ABIs (simplified for essential functions)
    this.tokenStoreAbi = [
      "function buy(uint256) external",
      "event Purchase(address indexed buyer, uint256 usdtAmount, uint256 gtOut)"
    ];
    this.usdtAbi = ["function approve(address,uint256) external returns (bool)", "function balanceOf(address) view returns (uint256)"];
    this.gameTokenAbi = ["function balanceOf(address) view returns (uint256)"];
    this.playGameAbi = [
      "function createMatch(bytes32,address,address,uint256) external",
      "function stake(bytes32) external", 
      "function commitResult(bytes32,address) external"
    ];

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupMetaMaskListeners();
    this.initializeSocket();
    this.generateGrids();
    this.logEvent("🌊 Naval Battle System initialized");
  }

  setupEventListeners() {
    // Wallet connection
    document.getElementById('connectWallet').addEventListener('click', () => this.connectWallet());
    
    // Token purchase
    document.getElementById('getTestUSDT').addEventListener('click', () => this.getTestUSDT());
    document.getElementById('buyGT').addEventListener('click', () => this.buyGameTokens());
    document.getElementById('switchAccount').addEventListener('click', () => this.switchAccount());
    
    // Matchmaking
    document.getElementById('findMatch').addEventListener('click', () => this.findMatch());
    document.getElementById('cancelSearch').addEventListener('click', () => this.cancelSearch());
    
    // Ship placement
    document.getElementById('randomizeShips').addEventListener('click', () => this.randomizeShips());
    document.getElementById('confirmPlacement').addEventListener('click', () => this.confirmShipPlacement());
    document.getElementById('resetShips').addEventListener('click', () => this.resetShips());
    
    // Ship selection buttons
    document.querySelectorAll('.ship-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const shipName = e.target.dataset.ship;
        this.selectShip(shipName);
      });
    });
    
    // Game actions
    document.getElementById('leaveGame').addEventListener('click', () => this.leaveGame());
    
    // Modal actions
        const playAgainBtn = document.getElementById('playAgain');
    const backToLobbyBtn = document.getElementById('backToLobby');
    
    if (playAgainBtn && backToLobbyBtn) {
      playAgainBtn.addEventListener('click', () => this.playAgain());
      backToLobbyBtn.addEventListener('click', () => this.backToLobby());
      console.log('Event listeners attached for playAgain and backToLobby buttons');
    } else {
      console.error('Could not find playAgain or backToLobby buttons');
    }
  }

  setupMetaMaskListeners() {
    if (window.ethereum) {
      // Listen for account changes
      window.ethereum.on('accountsChanged', async (accounts) => {
        if (accounts.length > 0) {
          this.logEvent(`🔄 MetaMask account changed to: ${accounts[0].substring(0, 6)}...${accounts[0].substring(accounts[0].length - 4)}`);
          
          // Update signer and UI
          this.signer = this.provider.getSigner();
          document.getElementById('walletAddress').textContent = 
            `Admiral: ${accounts[0].substring(0, 6)}...${accounts[0].substring(accounts[0].length - 4)}`;
          
          // Refresh balances with new account
          await this.updateBalances();
        } else {
          // User disconnected all accounts
          this.logEvent(`⚠️ All MetaMask accounts disconnected`);
          this.gameState = 'disconnected';
          this.showSection('walletSection');
        }
      });

      // Listen for chain changes
      window.ethereum.on('chainChanged', (chainId) => {
        this.logEvent(`🔗 Network changed to chain ID: ${chainId}`);
        // Reload page on network change to avoid issues
        window.location.reload();
      });
    }
  }

  initializeSocket() {
    this.socket = io();
    
    this.socket.on('matchFound', (data) => this.onMatchFound(data));
    this.socket.on('playerJoined', (data) => this.onPlayerJoined(data));
    this.socket.on('shipsReady', (data) => this.onShipsReady(data));
    this.socket.on('gameStart', (data) => this.onGameStart(data));
    this.socket.on('attackResult', (data) => this.onAttackResult(data));
    this.socket.on('gameOver', (data) => this.onGameOver(data));
    this.socket.on('playerLeft', () => this.onPlayerLeft());
    this.socket.on('error', (error) => this.logEvent(`❌ ${error}`));
  }

  generateGrids() {
    // Generate player's ship placement grid
    const playerGrid = document.getElementById('playerGrid');
    if (playerGrid) {
      playerGrid.innerHTML = '';
      for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;
        cell.addEventListener('click', () => this.onPlayerGridClick(i));
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.rotateSelectedShip();
        });
        playerGrid.appendChild(cell);
      }
    }

    // Generate battle grids (will be populated during battle phase)
    this.generateBattleGrids();
  }

  generateBattleGrids() {
    // Own fleet grid (read-only during battle)
    const ownFleetGrid = document.getElementById('ownFleetGrid');
    if (ownFleetGrid) {
      ownFleetGrid.innerHTML = '';
      for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;
        ownFleetGrid.appendChild(cell);
      }
    }

    // Enemy grid for attacks
    const enemyGrid = document.getElementById('enemyGrid');
    if (enemyGrid) {
      enemyGrid.innerHTML = '';
      for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;
        cell.addEventListener('click', () => this.attackCell(i));
        enemyGrid.appendChild(cell);
      }
    }
  }

  async connectWallet() {
    if (!window.ethereum) {
      alert("🦊 Install MetaMask to play!");
      return;
    }

    try {
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      await this.provider.send("eth_requestAccounts", []);
      this.signer = this.provider.getSigner();
      
      const address = await this.signer.getAddress();
      document.getElementById('userAddress').textContent = this.formatAddress(address);
      
      await this.updateBalances();
      this.showSection('walletInfo');
      this.showSection('matchmakingSection');
      this.updateGameStatus("⚓ Wallet connected! Ready for naval combat.");
      this.gameState = 'wallet_connected';
      
      this.logEvent(`🎖️ Admiral ${this.formatAddress(address)} reporting for duty!`);
    } catch (error) {
      this.logEvent(`❌ Wallet connection failed: ${error.message}`);
    }
  }

  async updateBalances() {
    try {
      const address = await this.signer.getAddress();
      
      // GT balance
      const gtContract = new ethers.Contract(this.GAME_TOKEN_ADDRESS, this.gameTokenAbi, this.signer);
      const gtBalance = await gtContract.balanceOf(address);
      document.getElementById('gtBalance').textContent = ethers.utils.formatUnits(gtBalance, 18);
      
      // USDT balance
      const usdtContract = new ethers.Contract(this.MOCK_USDT_ADDRESS, this.usdtAbi, this.signer);
      const usdtBalance = await usdtContract.balanceOf(address);
      document.getElementById('usdtBalance').textContent = ethers.utils.formatUnits(usdtBalance, 6);
      
    } catch (error) {
      this.logEvent(`⚠️ Balance update failed: ${error.message}`);
    }
  }

  async buyGameTokens() {
    const amount = document.getElementById('usdtAmount').value;
    if (!amount || amount <= 0) {
      alert("Enter valid USDT amount");
      return;
    }

    try {
      // Check USDT balance first
      const usdtContract = new ethers.Contract(this.MOCK_USDT_ADDRESS, this.usdtAbi, this.signer);
      const address = await this.signer.getAddress();
      const usdtBalance = await usdtContract.balanceOf(address);
      const requiredAmount = ethers.utils.parseUnits(amount, 6);
      
      if (usdtBalance.lt(requiredAmount)) {
        alert(`Insufficient USDT! You have ${ethers.utils.formatUnits(usdtBalance, 6)} USDT but need ${amount} USDT. Click "Get Test USDT" first.`);
        return;
      }

      const usdtAmount = ethers.utils.parseUnits(amount, 6);
      
      // First approve USDT spending
      this.logEvent(`🔄 Approving ${amount} USDT for spending...`);
      const approveTx = await usdtContract.approve(this.TOKEN_STORE_ADDRESS, usdtAmount);
      await approveTx.wait();
      
      // Then buy GT tokens
      this.logEvent(`🔄 Purchasing ${amount} GT tokens...`);
      const storeContract = new ethers.Contract(this.TOKEN_STORE_ADDRESS, this.tokenStoreAbi, this.signer);
      const buyTx = await storeContract.buy(usdtAmount);
      await buyTx.wait();
      
      this.logEvent(`⛽ Purchased ${amount} GT tokens! TX: ${buyTx.hash.substring(0, 10)}...`);
      await this.updateBalances();
      
    } catch (error) {
      this.logEvent(`❌ Token purchase failed: ${error.message}`);
    }
  }

  async getTestUSDT() {
    try {
      // In test environment, mint some USDT directly
      const amount = "1000"; // Give 1000 test USDT
      const usdtContract = new ethers.Contract(this.MOCK_USDT_ADDRESS, [
        "function mint(address,uint256) external",
        "function balanceOf(address) view returns (uint256)"
      ], this.signer);
      
      const address = await this.signer.getAddress();
      const mintAmount = ethers.utils.parseUnits(amount, 6);
      
      this.logEvent(`🔄 Getting ${amount} test USDT...`);
      const mintTx = await usdtContract.mint(address, mintAmount);
      await mintTx.wait();
      
      this.logEvent(`💰 Received ${amount} test USDT! TX: ${mintTx.hash.substring(0, 10)}...`);
      await this.updateBalances();
      
    } catch (error) {
      this.logEvent(`❌ Failed to get test USDT: ${error.message}`);
    }
  }

  async switchAccount() {
    try {
      this.logEvent(`🔄 Switching MetaMask account...`);
      
      // Request account change
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
      });
      
      // Small delay to ensure MetaMask has switched
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get new accounts
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      if (accounts.length > 0) {
        // Update the signer with new account
        this.signer = this.provider.getSigner();
        
        // Update UI with new account
        const address = accounts[0];
        document.getElementById('walletAddress').textContent = 
          `Admiral: ${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
        
        // Force refresh balances with new account
        this.logEvent(`⚓ Switched to account: ${address.substring(0, 6)}...${address.substring(address.length - 4)}`);
        await this.updateBalances();
        
        this.logEvent(`✅ Account switch completed successfully!`);
      }
      
    } catch (error) {
      this.logEvent(`❌ Account switch failed: ${error.message}`);
    }
  }

  async findMatch() {
    const stakeAmount = document.getElementById('stakeAmount').value;
    if (!stakeAmount || stakeAmount <= 0) {
      alert("Enter valid stake amount");
      return;
    }

    // Get the address properly
    const playerAddress = await this.signer.getAddress();

    this.socket.emit('findMatch', { 
      stake: parseFloat(stakeAmount),
      address: playerAddress 
    });
    
    this.gameState = 'matchmaking';
    this.showSection('waitingSection');
    this.hideSection('matchmakingSection');
    document.getElementById('currentStake').textContent = stakeAmount;
    this.updateGameStatus("🔍 Scanning the seven seas for a worthy opponent...");
    this.logEvent(`🔍 Searching for battle with ${stakeAmount} GT stake`);
  }

  cancelSearch() {
    this.socket.emit('cancelSearch');
    this.gameState = 'wallet_connected';
    this.showSection('matchmakingSection');
    this.hideSection('waitingSection');
    this.updateGameStatus("Search cancelled. Ready for new battle.");
    this.logEvent("🏃‍♂️ Search cancelled");
  }

  onMatchFound(data) {
    this.gameRoom = data.roomId;
    this.playerRole = data.role;
    this.updateGameStatus(`⚔️ Opponent found! Entering battle room...`);
    this.logEvent(`⚔️ Matched with opponent! Stakes: ${data.stake} GT`);
    
    // Start ship placement phase
    setTimeout(() => {
      this.startShipPlacement();
    }, 2000);
  }

  startShipPlacement() {
    this.gameState = 'placing_ships';
    this.hideSection('waitingSection');
    this.showSection('placementPhase');
    this.updateGameStatus("🚢 Deploy your fleet! Place 3 ships on your grid.");
    this.logEvent("🚢 Ship deployment phase started");
    this.selectShip('destroyer'); // Auto-select first ship
  }

  selectShip(shipName) {
    const ship = this.ships.find(s => s.name === shipName);
    if (ship.placed) return;

    this.selectedShip = ship;
    this.isHorizontal = true; // Reset to horizontal
    
    // Update UI
    document.querySelectorAll('.ship-button').forEach(btn => {
      btn.classList.remove('selected');
      if (btn.dataset.ship === shipName) {
        btn.classList.add('selected');
      }
    });
    
    document.getElementById('placementStatus').textContent = 
      `Selected: ${ship.name.toUpperCase()} (${ship.size} cells). Click grid to place. Right-click to rotate.`;
  }

  rotateSelectedShip() {
    if (this.selectedShip) {
      this.isHorizontal = !this.isHorizontal;
      const orientation = this.isHorizontal ? 'horizontal' : 'vertical';
      document.getElementById('placementStatus').textContent = 
        `${this.selectedShip.name.toUpperCase()} - ${orientation}. Click to place.`;
    }
  }

  onPlayerGridClick(index) {
    if (!this.selectedShip || this.gameState !== 'placing_ships') return;

    if (this.canPlaceShip(index, this.selectedShip.size, this.isHorizontal)) {
      this.placeShip(index, this.selectedShip, this.isHorizontal);
    } else {
      this.logEvent("❌ Cannot place ship there!");
    }
  }

  canPlaceShip(startIndex, size, horizontal) {
    const row = Math.floor(startIndex / 5);
    const col = startIndex % 5;
    
    for (let i = 0; i < size; i++) {
      let checkIndex;
      if (horizontal) {
        if (col + i >= 5) return false; // Out of bounds
        checkIndex = startIndex + i;
      } else {
        if (row + i >= 5) return false; // Out of bounds
        checkIndex = startIndex + (i * 5);
      }
      
      if (this.playerGrid[checkIndex] !== null) return false; // Cell occupied
    }
    
    return true;
  }

  placeShip(startIndex, ship, horizontal) {
    const cells = [];
    
    for (let i = 0; i < ship.size; i++) {
      const cellIndex = horizontal ? startIndex + i : startIndex + (i * 5);
      cells.push(cellIndex);
      this.playerGrid[cellIndex] = ship.name;
      
      // Update visual
      const cell = document.querySelector(`#playerGrid [data-index="${cellIndex}"]`);
      cell.classList.add('ship');
      cell.textContent = ship.name === 'battleship' ? '🚢' : ship.name === 'cruiser' ? '⛵' : '🛥️';
    }
    
    ship.cells = cells;
    ship.placed = true;
    
    // Update button
    const button = document.querySelector(`[data-ship="${ship.name}"]`);
    button.disabled = true;
    button.textContent += ' ✅';
    
    this.logEvent(`🚢 ${ship.name.toUpperCase()} deployed!`);
    
    // Check if all ships placed
    const allPlaced = this.ships.every(s => s.placed);
    if (allPlaced) {
      document.getElementById('confirmPlacement').classList.remove('hidden');
      document.getElementById('placementStatus').textContent = "All ships deployed! Confirm your fleet position.";
    } else {
      // Auto-select next ship
      const nextShip = this.ships.find(s => !s.placed);
      if (nextShip) this.selectShip(nextShip.name);
    }
  }

  randomizeShips() {
    this.resetShips();
    
    for (const ship of this.ships) {
      let placed = false;
      let attempts = 0;
      
      while (!placed && attempts < 50) {
        const startIndex = Math.floor(Math.random() * 25);
        const horizontal = Math.random() > 0.5;
        
        if (this.canPlaceShip(startIndex, ship.size, horizontal)) {
          this.placeShip(startIndex, ship, horizontal);
          placed = true;
        }
        attempts++;
      }
    }
    
    this.logEvent("🎲 Fleet randomly deployed!");
  }

  resetShips() {
    // Reset game state
    this.playerGrid.fill(null);
    this.ships.forEach(ship => {
      ship.placed = false;
      ship.cells = [];
    });
    
    // Reset UI
    document.querySelectorAll('#playerGrid .grid-cell').forEach(cell => {
      cell.classList.remove('ship');
      cell.textContent = '';
    });
    
    document.querySelectorAll('.ship-button').forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('selected');
      const shipName = btn.dataset.ship;
      const size = btn.dataset.size;
      const emoji = shipName === 'battleship' ? '🚢' : shipName === 'cruiser' ? '⛵' : '🛥️';
      btn.textContent = `${emoji} ${shipName.charAt(0).toUpperCase() + shipName.slice(1)} (${size})`;
    });
    
    document.getElementById('confirmPlacement').classList.add('hidden');
    this.selectShip('destroyer');
    this.logEvent("🔄 Fleet reset");
  }

  confirmShipPlacement() {
    // Send ship positions to server (in a real game, this would be hashed for privacy)
    this.socket.emit('shipsPlaced', {
      roomId: this.gameRoom,
      ships: this.ships.map(ship => ({
        name: ship.name,
        cells: ship.cells
      }))
    });
    
    this.hideSection('placementPhase');
    this.updateGameStatus("⏳ Fleet deployed! Waiting for opponent to finish deployment...");
    this.logEvent("⚓ Fleet confirmed! Waiting for enemy...");
  }

  onShipsReady(data) {
    this.logEvent("🌊 Both fleets ready! Battle commencing...");
    this.startBattle(data);
  }

  startBattle(data) {
    this.gameState = 'battle';
    this.showSection('battlePhase');
    this.populateBattleGrids();
    
    // Set player info
    document.getElementById('player1Address').textContent = this.formatAddress(data.player1.address);
    document.getElementById('player2Address').textContent = this.formatAddress(data.player2.address);
    document.getElementById('player1Stake').textContent = data.stake;
    document.getElementById('player2Stake').textContent = data.stake;
    
    this.currentTurn = data.currentTurn;
    this.updateTurnDisplay();
    
    document.getElementById('leaveGame').classList.remove('hidden');
    this.logEvent("⚔️ BATTLE STATIONS! The naval battle begins!");
  }

  populateBattleGrids() {
    // Show player's own ships
    const ownGrid = document.querySelectorAll('#ownFleetGrid .grid-cell');
    this.playerGrid.forEach((cell, index) => {
      if (cell) {
        ownGrid[index].classList.add('ship');
        const ship = this.ships.find(s => s.name === cell);
        ownGrid[index].textContent = ship.name === 'battleship' ? '🚢' : ship.name === 'cruiser' ? '⛵' : '🛥️';
      }
    });
  }

  updateTurnDisplay() {
    const isMyTurn = this.currentTurn === this.playerRole;
    const turnText = isMyTurn ? "🎯 Your turn - Attack enemy waters!" : "⏳ Enemy's turn - Brace for impact!";
    document.getElementById('battleStatus').textContent = turnText;
    
    // Enable/disable enemy grid
    document.querySelectorAll('#enemyGrid .grid-cell').forEach(cell => {
      cell.style.pointerEvents = isMyTurn ? 'auto' : 'none';
      cell.style.opacity = isMyTurn ? '1' : '0.7';
    });
  }

  attackCell(index) {
    if (this.currentTurn !== this.playerRole) return;
    if (this.enemyGrid[index] !== null) return; // Already attacked
    
    this.socket.emit('attack', {
      roomId: this.gameRoom,
      cellIndex: index
    });
    
    // Disable cell immediately
    const cell = document.querySelector(`#enemyGrid [data-index="${index}"]`);
    cell.style.pointerEvents = 'none';
    cell.textContent = '⏳';
  }

  onAttackResult(data) {
    const { cellIndex, result, attacker, ships } = data;
    
    if (attacker === this.playerRole) {
      // My attack result
      const cell = document.querySelector(`#enemyGrid [data-index="${cellIndex}"]`);
      if (result === 'hit') {
        cell.classList.add('hit');
        cell.textContent = '💥';
        this.logEvent(`🎯 Direct hit on enemy position ${this.indexToCoords(cellIndex)}!`);
      } else if (result === 'sunk') {
        cell.classList.add('sunk');
        cell.textContent = '☠️';
        this.logEvent(`💥 Enemy ship SUNK at ${this.indexToCoords(cellIndex)}!`);
      } else {
        cell.classList.add('miss');
        cell.textContent = '🌊';
        this.logEvent(`❌ Missed at ${this.indexToCoords(cellIndex)}`);
      }
      this.enemyGrid[cellIndex] = result;
    } else {
      // Enemy attacked me
      const cell = document.querySelector(`#ownFleetGrid [data-index="${cellIndex}"]`);
      if (result === 'hit') {
        cell.classList.add('hit');
        cell.textContent = '💥';
        this.logEvent(`💥 Enemy hit our fleet at ${this.indexToCoords(cellIndex)}!`);
      } else if (result === 'sunk') {
        cell.classList.add('sunk');
        cell.textContent = '☠️';
        this.logEvent(`☠️ Our ship SUNK at ${this.indexToCoords(cellIndex)}!`);
      } else {
        this.logEvent(`🌊 Enemy missed at ${this.indexToCoords(cellIndex)}`);
      }
    }
    
    // Update turn
    this.currentTurn = data.nextTurn;
    this.updateTurnDisplay();
    
    // Update hit counters (simplified)
    if (result !== 'miss') {
      const hitCountEl = attacker === 'player1' ? 
        document.getElementById('player1Hits') : 
        document.getElementById('player2Hits');
      const currentHits = parseInt(hitCountEl.textContent);
      hitCountEl.textContent = currentHits + 1;
    }
  }

  onGameOver(data) {
    this.gameState = 'game_over';
    const { winner, loser, stake, txHash } = data;
    
    const isWinner = winner.address === this.signer.getAddress();
    const resultTitle = isWinner ? '🏆 VICTORY!' : '💀 DEFEAT!';
    const resultText = isWinner ? 
      `Congratulations Admiral! You've won ${stake * 2} GT!` :
      `Your fleet has been sunk! You lost ${stake} GT.`;
    
    document.getElementById('resultTitle').textContent = resultTitle;
    document.getElementById('resultText').textContent = resultText;
    document.getElementById('rewardText').textContent = 
      isWinner ? `Prize: +${stake * 2} GT` : `Loss: -${stake} GT`;
    
    if (txHash) {
      document.getElementById('txHashText').innerHTML = 
        `<a href="https://etherscan.io/tx/${txHash}" target="_blank">View Transaction: ${txHash.substring(0, 20)}...</a>`;
    }
    
    this.showModal('gameResultModal');
    this.logEvent(`🏁 Game Over! Winner: ${this.formatAddress(winner.address)}`);
    
    // Update balances
    setTimeout(() => this.updateBalances(), 3000);
  }

  onPlayerLeft() {
    this.logEvent("🏃‍♂️ Opponent abandoned ship!");
    this.backToLobby();
  }

  leaveGame() {
    if (confirm("Are you sure you want to abandon the battle?")) {
      this.socket.emit('leaveGame', { roomId: this.gameRoom });
      this.backToLobby();
    }
  }

  playAgain() {
    console.log('playAgain() called');
    this.hideModal('gameResultModal');
    this.resetGame();
    this.showSection('matchmakingSection');
    console.log('playAgain() completed');
  }

  backToLobby() {
    console.log('backToLobby() called');
    this.hideModal('gameResultModal');
    this.resetGame();
    this.showSection('matchmakingSection');
    console.log('backToLobby() completed');
  }

  resetGame() {
    console.log('resetGame() called');
    this.gameState = 'wallet_connected';
    this.playerGrid.fill(null);
    this.enemyGrid.fill(null);
    this.ships.forEach(ship => {
      ship.placed = false;
      ship.cells = [];
    });
    this.selectedShip = null;
    this.gameRoom = null;
    this.playerRole = null;
    this.currentTurn = null;
    
    // Hide all game sections
    this.hideSection('waitingSection');
    this.hideSection('placementPhase');
    this.hideSection('battlePhase');
    
    this.updateGameStatus("⚓ Ready for new naval battle!");
    this.logEvent("🔄 Returned to harbor");
    console.log('resetGame() completed');
  }

  // Utility functions
  indexToCoords(index) {
    const row = Math.floor(index / 5);
    const col = index % 5;
    return `${String.fromCharCode(65 + col)}${row + 1}`;
  }

  formatAddress(address) {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  updateGameStatus(message) {
    document.getElementById('gameStatus').textContent = message;
  }

  showSection(sectionId) {
    // Hide all game sections first
    const sections = ['matchmakingSection', 'waitingSection', 'placementPhase', 'battlePhase'];
    sections.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.classList.add('hidden');
      }
    });
    
    // Show the requested section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
      targetSection.classList.remove('hidden');
      // Clear any debug styling
      targetSection.style.backgroundColor = '';
      targetSection.style.padding = '';
      targetSection.style.border = '';
      targetSection.style.position = '';
      targetSection.style.top = '';
      targetSection.style.left = '';
      targetSection.style.zIndex = '';
      targetSection.style.width = '';
      console.log(`Showing section: ${sectionId}`);
    } else {
      console.error(`Section not found: ${sectionId}`);
    }
  }

  hideSection(sectionId) {
    document.getElementById(sectionId).classList.add('hidden');
  }

  showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
  }

  hideModal(modalId) {
    console.log(`Hiding modal: ${modalId}`);
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none'; // Force hide the modal
      console.log('Modal hidden, display style:', window.getComputedStyle(modal).display);
    }
  }

  logEvent(message) {
    const events = document.getElementById('events');
    const timestamp = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.textContent = `[${timestamp}] ${message}`;
    events.insertBefore(div, events.firstChild);
    
    // Keep only last 50 events
    while (events.children.length > 50) {
      events.removeChild(events.lastChild);
    }
  }
}

// Initialize the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.navalBattle = new NavalBattle();
});
