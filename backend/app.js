require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors(), bodyParser.json());

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

// Purchase endpoint
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

// Match start
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

// Submit result
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Gateway running on http://localhost:${PORT}`));