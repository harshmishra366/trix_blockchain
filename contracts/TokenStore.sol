// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./GameToken.sol";

contract TokenStore is Ownable, ReentrancyGuard {
  IERC20 public usdt;            // 6-decimals
  GameToken public gameToken;
  uint256 public gtPerUsdt;      // e.g. 1e18 for 1 GT per 1 USDT

  event Purchase(address indexed buyer, uint256 usdtAmount, uint256 gtOut);
  event USDTWithdrawn(address indexed to, uint256 amount);

  constructor(address usdt_, address gameToken_, uint256 rate_) Ownable(msg.sender) {
    usdt = IERC20(usdt_);
    gameToken = GameToken(gameToken_);
    gtPerUsdt = rate_;
  }

  function buy(uint256 usdtAmount) external nonReentrant {
    require(usdtAmount > 0, "Zero amount");
    usdt.transferFrom(msg.sender, address(this), usdtAmount);
    uint256 gtOut = (usdtAmount * gtPerUsdt) / 1e6;
    gameToken.mint(msg.sender, gtOut);
    emit Purchase(msg.sender, usdtAmount, gtOut);
  }

  function withdrawUSDT(address to, uint256 amount) external onlyOwner {
    usdt.transfer(to, amount);
    emit USDTWithdrawn(to, amount);
  }
}