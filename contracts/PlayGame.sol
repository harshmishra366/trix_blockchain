// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PlayGame is Ownable, ReentrancyGuard {
  IERC20 public gameToken;
  address public operator;
  uint256 public timeout = 24 hours;

  enum Status { NONE, CREATED, STAKED, SETTLED, REFUNDED }
  struct Match {
    address p1;
    address p2;
    uint256 stake;
    uint256 startTime;
    Status status;
    mapping(address => bool) staked;
  }
  mapping(bytes32 => Match) private matches;

  event MatchCreated(bytes32 matchId, address indexed p1, address indexed p2, uint256 stake);
  event Staked(bytes32 indexed matchId, address indexed player);
  event Settled(bytes32 indexed matchId, address indexed winner, uint256 amount);
  event Refunded(bytes32 indexed matchId);

  constructor(address gt_) Ownable(msg.sender) {
    gameToken = IERC20(gt_);
  }

  function setOperator(address op_) external onlyOwner {
    operator = op_;
  }

  function createMatch(bytes32 id, address p1, address p2, uint256 stake_) external onlyOwner {
    Match storage m = matches[id];
    require(m.status == Status.NONE, "Exists");
    m.p1 = p1; m.p2 = p2; m.stake = stake_; m.status = Status.CREATED;
    emit MatchCreated(id, p1, p2, stake_);
  }

  function stake(bytes32 id) external nonReentrant {
    Match storage m = matches[id];
    require(m.status == Status.CREATED, "Bad status");
    require(msg.sender == m.p1 || msg.sender == m.p2, "Not player");
    require(!m.staked[msg.sender], "Already staked");
    gameToken.transferFrom(msg.sender, address(this), m.stake);
    m.staked[msg.sender] = true;
    emit Staked(id, msg.sender);
    if (m.staked[m.p1] && m.staked[m.p2]) {
      m.status = Status.STAKED;
      m.startTime = block.timestamp;
    }
  }

  function commitResult(bytes32 id, address winner) external nonReentrant {
    Match storage m = matches[id];
    require(msg.sender == operator, "Not operator");
    require(m.status == Status.STAKED, "Bad status");
    require(winner == m.p1 || winner == m.p2, "Invalid winner");
    m.status = Status.SETTLED;
    uint256 payout = m.stake * 2;
    gameToken.transfer(winner, payout);
    emit Settled(id, winner, payout);
  }

  function refund(bytes32 id) external nonReentrant {
    Match storage m = matches[id];
    require(m.status == Status.STAKED, "Bad status");
    require(block.timestamp >= m.startTime + timeout, "No timeout");
    m.status = Status.REFUNDED;
    gameToken.transfer(m.p1, m.stake);
    gameToken.transfer(m.p2, m.stake);
    emit Refunded(id);
  }
}