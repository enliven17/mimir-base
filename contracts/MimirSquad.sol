// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISquadERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Two-sided USDC pool. Shares equal deposited atomic units; captains have no economic privilege.
contract MimirSquad {
    uint8 public constant SIDE_A = 1;
    uint8 public constant SIDE_B = 2;
    uint8 public constant RESULT_CANCELLED = 3;
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint256 public constant MAX_PARTICIPANTS_PER_SIDE = 200;
    uint256 public constant MIN_DURATION = 10 minutes;
    uint256 public constant MAX_DURATION = 365 days;

    struct Market {
        address captain;
        uint64 deadline;
        uint16 feeBps;
        uint8 result;
        bool resolved;
        uint256 poolA;
        uint256 poolB;
        uint256 remainingEscrow;
        uint32 participantsA;
        uint32 participantsB;
        uint32 winnerClaims;
    }

    ISquadERC20 public immutable usdc;
    address public immutable oracle;
    address public immutable feeRecipient;
    uint256 public marketCount;
    uint256 public accruedFees;
    uint256 private entered = 1;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) public deposits;
    mapping(uint256 => mapping(uint8 => mapping(address => bool))) public claimed;

    event MarketCreated(uint256 indexed marketId, address indexed captain, uint64 deadline, uint16 feeBps, string question);
    event Deposited(uint256 indexed marketId, uint8 indexed side, address indexed participant, uint256 amount, uint256 shares);
    event Withdrawn(uint256 indexed marketId, uint8 indexed side, address indexed participant, uint256 amount);
    event Resolved(uint256 indexed marketId, uint8 result, uint256 poolA, uint256 poolB);
    event Claimed(uint256 indexed marketId, address indexed participant, uint256 gross, uint256 fee, uint256 net);
    event FeesClaimed(address indexed recipient, uint256 amount);

    modifier nonReentrant() { require(entered == 1, "reentrant"); entered = 2; _; entered = 1; }
    modifier onlyOracle() { require(msg.sender == oracle, "not oracle"); _; }

    constructor(address usdc_, address oracle_, address feeRecipient_) {
        require(usdc_ != address(0) && oracle_ != address(0) && feeRecipient_ != address(0), "zero address");
        usdc = ISquadERC20(usdc_);
        oracle = oracle_;
        feeRecipient = feeRecipient_;
    }

    function createMarket(string calldata question, uint64 deadline, uint16 feeBps) external returns (uint256 id) {
        require(bytes(question).length != 0, "empty question");
        require(deadline >= block.timestamp + MIN_DURATION && deadline <= block.timestamp + MAX_DURATION, "bad deadline");
        require(feeBps <= MAX_FEE_BPS, "fee cap");
        id = ++marketCount;
        markets[id] = Market(msg.sender, deadline, feeBps, 0, false, 0, 0, 0, 0, 0, 0);
        emit MarketCreated(id, msg.sender, deadline, feeBps, question);
    }

    function deposit(uint256 id, uint8 side, uint256 amount) external nonReentrant {
        Market storage m = markets[id];
        require(m.captain != address(0) && !m.resolved && block.timestamp < m.deadline, "closed");
        require(side == SIDE_A || side == SIDE_B, "bad side");
        require(amount > 0, "zero amount");
        uint256 previous = deposits[id][side][msg.sender];
        if (previous == 0) {
            if (side == SIDE_A) { require(m.participantsA < MAX_PARTICIPANTS_PER_SIDE, "side full"); m.participantsA++; }
            else { require(m.participantsB < MAX_PARTICIPANTS_PER_SIDE, "side full"); m.participantsB++; }
        }
        _pullExact(msg.sender, amount);
        deposits[id][side][msg.sender] = previous + amount;
        if (side == SIDE_A) m.poolA += amount; else m.poolB += amount;
        emit Deposited(id, side, msg.sender, amount, amount);
    }

    function withdrawBeforeDeadline(uint256 id, uint8 side, uint256 amount) external nonReentrant {
        Market storage m = markets[id];
        require(!m.resolved && block.timestamp < m.deadline, "locked");
        uint256 balance = deposits[id][side][msg.sender];
        require(amount > 0 && amount <= balance, "bad amount");
        uint256 next = balance - amount;
        deposits[id][side][msg.sender] = next;
        if (side == SIDE_A) { m.poolA -= amount; if (next == 0) m.participantsA--; }
        else if (side == SIDE_B) { m.poolB -= amount; if (next == 0) m.participantsB--; }
        else revert("bad side");
        require(usdc.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(id, side, msg.sender, amount);
    }

    function resolve(uint256 id, uint8 result) external onlyOracle {
        Market storage m = markets[id];
        require(!m.resolved && block.timestamp >= m.deadline, "not resolvable");
        require(result == SIDE_A || result == SIDE_B || result == RESULT_CANCELLED, "bad result");
        if (result != RESULT_CANCELLED) require((result == SIDE_A ? m.poolA : m.poolB) > 0, "empty winner");
        m.resolved = true;
        m.result = result;
        m.remainingEscrow = m.poolA + m.poolB;
        emit Resolved(id, result, m.poolA, m.poolB);
    }

    function claim(uint256 id, uint8 side) external nonReentrant returns (uint256 net) {
        Market storage m = markets[id];
        require(m.resolved && (side == SIDE_A || side == SIDE_B) && !claimed[id][side][msg.sender], "not claimable");
        uint256 principal = deposits[id][side][msg.sender];
        require(principal > 0 && (m.result == RESULT_CANCELLED || side == m.result), "not winner");
        claimed[id][side][msg.sender] = true;
        uint256 gross;
        uint256 fee;
        if (m.result == RESULT_CANCELLED) {
            gross = principal;
        } else {
            uint256 winnerPool = m.result == SIDE_A ? m.poolA : m.poolB;
            uint256 winnerCount = m.result == SIDE_A ? m.participantsA : m.participantsB;
            m.winnerClaims++;
            gross = m.winnerClaims == winnerCount ? m.remainingEscrow : ((m.poolA + m.poolB) * principal) / winnerPool;
            uint256 profit = gross > principal ? gross - principal : 0;
            fee = (profit * m.feeBps) / 10_000;
        }
        m.remainingEscrow -= gross;
        net = gross - fee;
        accruedFees += fee;
        require(usdc.transfer(msg.sender, net), "transfer failed");
        emit Claimed(id, msg.sender, gross, fee, net);
    }

    function claimFees() external nonReentrant {
        require(msg.sender == feeRecipient, "not recipient");
        uint256 amount = accruedFees;
        accruedFees = 0;
        require(usdc.transfer(msg.sender, amount), "transfer failed");
        emit FeesClaimed(msg.sender, amount);
    }

    function _pullExact(address from, uint256 amount) internal {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        require(usdc.transferFrom(from, address(this), amount), "transferFrom failed");
        require(usdc.balanceOf(address(this)) == beforeBalance + amount, "non-exact token");
    }
}
