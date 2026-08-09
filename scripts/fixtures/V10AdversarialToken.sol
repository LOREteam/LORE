// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.36;

/// @dev Test-only ERC-20 used by the local V10 bytecode property runner.
contract V10AdversarialToken {
    string public constant name = "V10 adversarial fixture";
    string public constant symbol = "V10TEST";
    uint8 public constant decimals = 18;

    enum Mode {
        Normal,
        ReturnFalseTransfer,
        ReturnFalseTransferFrom,
        RevertTransfer,
        RevertTransferFrom,
        ReenterTransfer,
        ReenterTransferFrom
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    Mode public mode;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bool private _insideCallback;

    error ForcedTokenRevert();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function configure(Mode nextMode, address target, bytes calldata data) external {
        mode = nextMode;
        callbackTarget = target;
        callbackData = data;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (mode == Mode.ReturnFalseTransfer) return false;
        if (mode == Mode.RevertTransfer) revert ForcedTokenRevert();
        if (mode == Mode.ReenterTransfer) _attemptCallback();
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (mode == Mode.ReturnFalseTransferFrom) return false;
        if (mode == Mode.RevertTransferFrom) revert ForcedTokenRevert();
        if (mode == Mode.ReenterTransferFrom) _attemptCallback();

        uint256 available = allowance[from][msg.sender];
        if (available < amount) revert InsufficientAllowance();
        if (available != type(uint256).max) {
            allowance[from][msg.sender] = available - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _attemptCallback() private {
        if (_insideCallback || callbackTarget == address(0)) return;
        _insideCallback = true;
        callbackAttempted = true;
        (callbackSucceeded, ) = callbackTarget.call(callbackData);
        _insideCallback = false;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
