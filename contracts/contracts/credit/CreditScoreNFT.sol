// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title Soulbound on-chain credit score (300-900). One token per wallet, never transferable.
/// @dev Only loan contracts (SCORER_ROLE) can change a score. Holds no personal data.
contract CreditScoreNFT is ERC721, AccessControl, ERC2771Context {
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");
    uint16 public constant MIN = 300; uint16 public constant MAX = 900; uint16 public constant START = 500;

    struct Record { uint16 score; uint16 onTime; uint16 late; uint16 completed; uint16 defaults; }
    mapping(address => Record) private _r;
    mapping(address => uint256) public tokenOf;
    uint256 public nextId = 1;

    event ScoreChanged(address indexed user, uint16 oldScore, uint16 newScore, string reason);
    error Soulbound();

    constructor(address admin, address forwarder) ERC721("JanSetu Credit Score", "JSCS") ERC2771Context(forwarder) { _grantRole(DEFAULT_ADMIN_ROLE, admin); }

    function scoreOf(address u) public view returns (uint256) { return _r[u].score == 0 ? START : _r[u].score; }
    function recordOf(address u) external view returns (Record memory r) { r = _r[u]; if (r.score == 0) r.score = START; }

    /// @notice Anyone may mint their own score token (no cost, no data).
    function mint() external { _ensure(_msgSender()); }

    function recordOnTime(address u) external onlyRole(SCORER_ROLE) { _ensure(u); _r[u].onTime++; _move(u, 3, true, "on-time"); }
    function recordLate(address u) external onlyRole(SCORER_ROLE) { _ensure(u); _r[u].late++; _move(u, 10, false, "late"); }
    function recordCompleted(address u) external onlyRole(SCORER_ROLE) { _ensure(u); _r[u].completed++; _move(u, 25, true, "completed"); }
    function recordDefault(address u) external onlyRole(SCORER_ROLE) { _ensure(u); _r[u].defaults++; _move(u, 150, false, "default"); }

    function _ensure(address u) private {
        if (tokenOf[u] != 0) return;
        uint256 id = nextId++;
        tokenOf[u] = id; _r[u].score = START;
        _mint(u, id);
    }

    function _move(address u, uint16 d, bool up, string memory why) private {
        uint16 old = _r[u].score;
        uint16 nu = up ? (old + d > MAX ? MAX : old + d) : (old < MIN + d ? MIN : old - d);
        _r[u].score = nu;
        emit ScoreChanged(u, old, nu, why);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound(); // mint only
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        address o = _requireOwned(id);
        Record memory r = _r[o];
        bytes memory json = abi.encodePacked('{"name":"JanSetu Credit Score #', Strings.toString(id), '","description":"Testnet soulbound score. No personal data.","attributes":[{"trait_type":"Score","value":', Strings.toString(r.score), '},{"trait_type":"On-time","value":', Strings.toString(r.onTime), '},{"trait_type":"Completed","value":', Strings.toString(r.completed), '},{"trait_type":"Defaults","value":', Strings.toString(r.defaults), '}]}');
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function supportsInterface(bytes4 i) public view override(ERC721, AccessControl) returns (bool) { return super.supportsInterface(i); }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
