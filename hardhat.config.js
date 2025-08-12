require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

const { RPC_URL, PRIVATE_KEY } = process.env;
const networks = {};
if (RPC_URL && PRIVATE_KEY) {
  networks.rinkeby = {
    url: RPC_URL,
    accounts: [PRIVATE_KEY]
  };
}

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.17" },
      { version: "0.8.20" }
    ]
  }
  // External networks disabled until valid RPC_URL and PRIVATE_KEY are provided
};