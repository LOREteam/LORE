// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title LineaOre7702Delegate
 * @notice Narrow executor for EIP-7702 delegated EOAs.
 *         This contract is intentionally game-specific and self-call only:
 *         the delegated EOA must send the outer tx to itself with a 7702
 *         authorization that points at this contract.
 *
 *         Design goals:
 *         - No arbitrary target execution
 *         - One-tx approve + bet batching
 *         - Claims/rebates/resolve wrappers for the LORE game only
 *         - Safe failure surface for sponsored / delegated UX
 */
contract LineaOre7702Delegate {
    using SafeERC20 for IERC20;

    error OnlyDelegatedSelf();
    error ZeroAddress();
    error EmptyArray();
    error ZeroAmount();

    modifier onlyDelegatedSelf() {
        if (msg.sender != address(this)) revert OnlyDelegatedSelf();
        _;
    }

    function approveAndPlaceBatchSameAmount(
        address token,
        address game,
        uint256[] calldata tileIds,
        uint256 amount,
        address spender,
        uint256 approvalAmount
    ) external onlyDelegatedSelf {
        if (token == address(0) || game == address(0) || spender == address(0)) revert ZeroAddress();
        if (tileIds.length == 0) revert EmptyArray();
        if (amount == 0 || approvalAmount == 0) revert ZeroAmount();

        IERC20(token).forceApprove(spender, approvalAmount);
        _callGame(game, abi.encodeWithSignature("placeBatchBetsSameAmount(uint256[],uint256)", tileIds, amount));
    }

    function placeBatchSameAmount(
        address game,
        uint256[] calldata tileIds,
        uint256 amount
    ) external onlyDelegatedSelf {
        if (game == address(0)) revert ZeroAddress();
        if (tileIds.length == 0) revert EmptyArray();
        if (amount == 0) revert ZeroAmount();

        _callGame(game, abi.encodeWithSignature("placeBatchBetsSameAmount(uint256[],uint256)", tileIds, amount));
    }

    function claimRewards(address game, uint256[] calldata epochs) external onlyDelegatedSelf {
        if (game == address(0)) revert ZeroAddress();
        if (epochs.length == 0) revert EmptyArray();

        _callGame(game, abi.encodeWithSignature("claimRewards(uint256[])", epochs));
    }

    function claimEpochsRebate(address game, uint256[] calldata epochs) external onlyDelegatedSelf {
        if (game == address(0)) revert ZeroAddress();
        if (epochs.length == 0) revert EmptyArray();

        _callGame(game, abi.encodeWithSignature("claimEpochsRebate(uint256[])", epochs));
    }

    function resolveEpoch(address game, uint256 epoch) external onlyDelegatedSelf {
        if (game == address(0)) revert ZeroAddress();
        _callGame(game, abi.encodeWithSignature("resolveEpoch(uint256)", epoch));
    }

    function claimResolverRewards(address game) external onlyDelegatedSelf {
        if (game == address(0)) revert ZeroAddress();
        _callGame(game, abi.encodeWithSignature("claimResolverRewards()"));
    }

    function _callGame(address target, bytes memory data) internal {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            if (result.length == 0) revert();
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}
