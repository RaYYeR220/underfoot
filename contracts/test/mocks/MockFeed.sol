// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(int256 a) {
        set(a);
    }

    function set(int256 a) public {
        answer = a;
        updatedAt = block.timestamp;
        roundId++;
    }

    function setUpdatedAt(uint256 ts) external {
        updatedAt = ts;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "mock";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
