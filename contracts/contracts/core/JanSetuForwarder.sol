// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title Gas-sponsoring forwarder (ERC-2771). Users sign EIP-712 requests; a relayer pays BNB gas.
/// @dev Unmodified OpenZeppelin forwarder. Replay-protected by per-signer nonces and deadlines.
contract JanSetuForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("JanSetuForwarder") {}
}
