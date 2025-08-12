// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GameToken is ERC20, Ownable {
  address public tokenStore;
  event Minted(address indexed to, uint256 amount);

  modifier onlyTokenStore() {
    require(msg.sender == tokenStore, "Not TokenStore");
    _;
  }

  constructor() ERC20("GameToken","GT") Ownable(msg.sender) {}

  function setTokenStore(address _store) external onlyOwner {
    tokenStore = _store;
  }

  function mint(address to, uint256 amount) external onlyTokenStore {
    _mint(to, amount);
    emit Minted(to, amount);
  }
}