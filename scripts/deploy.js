const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy MockUSDT
  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await MockUSDT.deploy(ethers.parseUnits("1000000", 6));
  await usdt.waitForDeployment();
  console.log("MockUSDT deployed to", usdt.target);

  // Deploy GameToken
  const GameToken = await ethers.getContractFactory("GameToken");
  const gt = await GameToken.deploy();
  await gt.waitForDeployment();
  console.log("GameToken deployed to", gt.target);

  // Deploy TokenStore
  const TokenStore = await ethers.getContractFactory("TokenStore");
  const store = await TokenStore.deploy(usdt.target, gt.target, ethers.parseUnits("1", 18));
  await store.waitForDeployment();
  console.log("TokenStore deployed to", store.target);

  // Set TokenStore in GameToken
  await (await gt.setTokenStore(store.target)).wait();

  // Deploy PlayGame
  const PlayGame = await ethers.getContractFactory("PlayGame");
  const game = await PlayGame.deploy(gt.target);
  await game.waitForDeployment();
  console.log("PlayGame deployed to", game.target);

  // Set operator
  await (await game.setOperator(deployer.address)).wait();

  console.log("Deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
