// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title Non-transferable digital receipts. Metadata holds no personal information.
contract DigitalReceiptNFT is ERC721, AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    enum Kind { DailyDeposit, RdInstallment, FdDeposit, P2P, LoanRepayment, LoanCompletion }

    struct Receipt {
        Kind kind;
        address source; // issuing contract
        uint256 refId;  // position / escrow / loan id inside the source contract
        uint256 amount;
        uint64 timestamp;
        uint64 blockNumber;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Receipt) private _receipts;

    event ReceiptIssued(uint256 indexed receiptId, address indexed to, Kind kind, address indexed source, uint256 refId, uint256 amount);

    error Soulbound();

    constructor(address admin) ERC721("JanSetu Digital Receipt", "JSR") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function issue(address to, Kind kind, uint256 refId, uint256 amount) external onlyRole(ISSUER_ROLE) returns (uint256 id) {
        id = nextId++;
        _receipts[id] = Receipt(kind, msg.sender, refId, amount, uint64(block.timestamp), uint64(block.number));
        _mint(to, id); // plain mint: soulbound receipts must never call back into the recipient
        emit ReceiptIssued(id, to, kind, msg.sender, refId, amount);
    }

    function receiptOf(uint256 id) external view returns (Receipt memory) {
        _requireOwned(id);
        return _receipts[id];
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Receipt memory r = _receipts[id];
        bytes memory json = abi.encodePacked(
            '{"name":"JanSetu Receipt #', Strings.toString(id),
            '","description":"Testnet receipt. Not a legal or bank document.","attributes":[',
            '{"trait_type":"Kind","value":"', Strings.toString(uint256(r.kind)), '"},',
            '{"trait_type":"Amount (wei)","value":"', Strings.toString(r.amount), '"},',
            '{"trait_type":"Source","value":"', Strings.toHexString(r.source), '"},',
            '{"trait_type":"Ref","value":"', Strings.toString(r.refId), '"},',
            '{"trait_type":"Timestamp","value":"', Strings.toString(r.timestamp), '"}]}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    /// @dev Mint only. No transfers, no burns: receipts are permanent records.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 id) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(id);
    }
}
