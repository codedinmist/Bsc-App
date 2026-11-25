import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { fixture, E, k, DAY } from "./fixture";
import { handOverGovernance } from "../scripts/lib/deployAll";

describe("INRToken (tINR)", () => {
  it("has the right identity, supply and cap", async () => {
    const { token, admin } = await fixture();
    expect(await token.name()).to.equal("JanSetu Test Rupee");
    expect(await token.symbol()).to.equal("tINR");
    expect(await token.decimals()).to.equal(18);
    expect(await token.cap()).to.equal(E(1_000_000_000));
    expect(await token.totalSupply()).to.equal(E(100_000_000));
    expect(await token.hasRole(await token.MINTER_ROLE(), admin.address)).to.equal(false);
  });
  it("rejects initial supply above the cap", async () => {
    const [a] = await ethers.getSigners();
    const f = await (await ethers.deployContract("JanSetuForwarder")).getAddress();
    await expect(ethers.deployContract("INRToken", [a.address, a.address, E(11), E(10), f])).to.be.reverted;
  });
  it("only MINTER_ROLE mints, never above cap", async () => {
    const { token, admin, alice } = await fixture();
    await expect(token.connect(alice).mint(alice.address, 1)).to.be.reverted;
    await token.connect(admin).grantRole(await token.MINTER_ROLE(), admin.address);
    await expect(token.connect(admin).mint(alice.address, E(900_000_001))).to.be.reverted; // 100M + 900M + 1 > cap
    await token.connect(admin).mint(alice.address, E(5));
  });
  it("burn only affects the caller's own balance", async () => {
    const { token, admin, alice } = await fixture();
    await token.connect(admin).grantRole(await token.BURNER_ROLE(), alice.address);
    const before = await token.balanceOf(alice.address);
    await token.connect(alice).burn(E(10));
    expect(await token.balanceOf(alice.address)).to.equal(before - E(10));
    await expect(token.connect(admin).burn(1)).to.be.reverted; // admin has no burner role
  });
  it("pause blocks transfers, unpause restores them", async () => {
    const { token, admin, alice, bob } = await fixture();
    await token.connect(admin).pause();
    await expect(token.connect(alice).transfer(bob.address, 1)).to.be.reverted;
    await token.connect(admin).unpause();
    await token.connect(alice).transfer(bob.address, 1);
  });
  it("charges no transfer tax", async () => {
    const { token, alice, bob } = await fixture();
    const b = await token.balanceOf(bob.address);
    await token.connect(alice).transfer(bob.address, E(123));
    expect(await token.balanceOf(bob.address)).to.equal(b + E(123));
  });
});

describe("Faucet", () => {
  async function funded() {
    const f = await fixture();
    await f.token.connect(f.admin).transfer(await f.faucet.getAddress(), E(1_000_000));
    return f;
  }
  it("pays a fixed amount, then enforces cooldown", async () => {
    const { faucet, token, alice } = await funded();
    await faucet.connect(alice).claim();
    await expect(faucet.connect(alice).claim()).to.be.revertedWithCustomError(faucet, "CooldownActive");
    await time.increase(DAY + 1);
    await faucet.connect(alice).claim();
    expect(await faucet.totalClaimed(alice.address)).to.equal(E(2000));
  });
  it("enforces lifetime per-wallet limit", async () => {
    const { faucet, alice } = await funded();
    for (let i = 0; i < 10; i++) { await faucet.connect(alice).claim(); await time.increase(DAY + 1); }
    await expect(faucet.connect(alice).claim()).to.be.revertedWithCustomError(faucet, "WalletLimitReached");
  });
  it("fails when empty, never mints", async () => {
    const { faucet, alice } = await fixture();
    await expect(faucet.connect(alice).claim()).to.be.revertedWithCustomError(faucet, "FaucetEmpty");
  });
  it("only admin changes limits, within hard bounds", async () => {
    const { faucet, admin, alice } = await funded();
    await expect(faucet.connect(alice).setLimits(1, 3600, 1)).to.be.reverted;
    await expect(faucet.connect(admin).setLimits(E(1000), 60, E(1000))).to.be.revertedWithCustomError(faucet, "InvalidLimits");
    await expect(faucet.connect(admin).setLimits(E(200_000), 3600, E(300_000))).to.be.revertedWithCustomError(faucet, "InvalidLimits");
  });
  it("can be paused", async () => {
    const { faucet, admin, alice } = await funded();
    await faucet.connect(admin).pause();
    await expect(faucet.connect(alice).claim()).to.be.revertedWithCustomError(faucet, "EnforcedPause");
  });
});

describe("Gas-sponsoring forwarder (ERC-2771)", () => {
  it("lets a relayer pay gas while the USER is the msg.sender", async () => {
    const { forwarder, faucet, token, admin, alice, relayer } = await fixture();
    await token.connect(admin).transfer(await faucet.getAddress(), E(10_000));
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = (await time.latest()) + 3600;
    const data = faucet.interface.encodeFunctionData("claim");
    const req = {
      from: alice.address, to: await faucet.getAddress(), value: 0n, gas: 200000n,
      nonce: await forwarder.nonces(alice.address), deadline, data,
    };
    const signature = await alice.signTypedData(
      { name: "JanSetuForwarder", version: "1", chainId, verifyingContract: await forwarder.getAddress() },
      { ForwardRequest: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" } ] },
      req
    );
    const { nonce, ...rest } = req;
    const before = await token.balanceOf(alice.address);
    await forwarder.connect(relayer).execute({ ...rest, signature });
    expect(await token.balanceOf(alice.address)).to.equal(before + E(1000));
    // replay must fail
    await expect(forwarder.connect(relayer).execute({ ...rest, signature })).to.be.reverted;
  });
  it("rejects a forged request", async () => {
    const { forwarder, faucet, bob, alice, relayer } = await fixture();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = (await time.latest()) + 3600;
    const req = { from: alice.address, to: await faucet.getAddress(), value: 0n, gas: 200000n, nonce: 0n, deadline, data: faucet.interface.encodeFunctionData("claim") };
    const sig = await bob.signTypedData( // signed by the wrong person
      { name: "JanSetuForwarder", version: "1", chainId, verifyingContract: await forwarder.getAddress() },
      { ForwardRequest: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] },
      req);
    const { nonce, ...rest } = req;
    await expect(forwarder.connect(relayer).execute({ ...rest, signature: sig })).to.be.reverted;
  });
});

describe("ProtocolConfig", () => {
  it("enforces bounds and unknown keys", async () => {
    const { config, admin } = await fixture();
    await expect(config.connect(admin).setUint(k("DAILY_DURATION_DAYS"), 5)).to.be.revertedWithCustomError(config, "OutOfBounds");
    await expect(config.connect(admin).setUint(k("NOPE"), 1)).to.be.revertedWithCustomError(config, "UnknownKey");
    await expect(config.connect(admin).defineKey(k("REQUIRE_KYC"), 0, 1, 0)).to.be.revertedWithCustomError(config, "AlreadyDefined");
    await expect(config.connect(admin).setUint(k("DAILY_DURATION_DAYS"), 400)).to.emit(config, "ConfigChanged");
  });
  it("rejects unauthorised changes", async () => {
    const { config, alice } = await fixture();
    await expect(config.connect(alice).setUint(k("REQUIRE_KYC"), 1)).to.be.reverted;
  });
});

describe("JanSetuRegistry", () => {
  it("registers once, no self-granted privilege", async () => {
    const { registry, alice, admin } = await fixture();
    await expect(registry.connect(alice).register()).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    await expect(registry.connect(alice).setKyc(alice.address, true)).to.be.reverted;
    await expect(registry.connect(alice).assignRole(alice.address, 3, 1, 1, 1)).to.be.reverted;
    await expect(registry.connect(admin).assignRole(admin.address, 3, 1, 1, 1)).to.be.reverted; // not registered
  });
  it("operator verifies agents; governor assigns higher roles; everything is logged", async () => {
    const { registry, admin, alice, bob } = await fixture();
    await expect(registry.connect(admin).assignAgent(alice.address, 1, 2, 3)).to.emit(registry, "RoleAssigned");
    expect(await registry.isActiveAgent(alice.address)).to.equal(false);
    await registry.connect(admin).setAgentVerified(alice.address, true);
    expect(await registry.isActiveAgent(alice.address)).to.equal(true);
    await registry.connect(admin).suspend(alice.address, k("evidence-1"));
    expect(await registry.isActiveAgent(alice.address)).to.equal(false);
    await registry.connect(admin).reinstate(alice.address);
    expect(await registry.isActiveAgent(alice.address)).to.equal(true);
    await registry.connect(admin).assignRole(bob.address, 3, 1, 1, 1);
    expect(await registry.roleOf(bob.address)).to.equal(3);
    await registry.connect(admin).revokeParticipantRole(bob.address);
    expect(await registry.roleOf(bob.address)).to.equal(1);
    await expect(registry.connect(admin).assignRole(bob.address, 2, 1, 1, 1)).to.be.revertedWithCustomError(registry, "InvalidRole");
  });
  it("setAgentVerified fails for non-agents", async () => {
    const { registry, admin, bob } = await fixture();
    await expect(registry.connect(admin).setAgentVerified(bob.address, true)).to.be.revertedWithCustomError(registry, "NotAnAgent");
  });
});

describe("DigitalReceiptNFT", () => {
  it("only issuers mint; receipts are non-transferable; metadata has no personal data", async () => {
    const { receipts, daily, alice, bob } = await fixture();
    await expect(receipts.connect(alice).issue(alice.address, 0, 1, 1)).to.be.reverted;
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    expect(await receipts.ownerOf(1)).to.equal(alice.address);
    await expect(receipts.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWithCustomError(receipts, "Soulbound");
    const uri = await receipts.tokenURI(1);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.name).to.equal("JanSetu Receipt #1");
    expect(JSON.stringify(json).toLowerCase()).to.not.contain(alice.address.toLowerCase());
  });
});

describe("Governance hand-over and 48h timelock", () => {
  it("deployer keeps no power; config changes need 48h via the timelock", async () => {
    const f = await fixture();
    const [, , , , , , , safe, guardian, ops2] = await ethers.getSigners();
    const delay = 48 * 3600;
    const timelock = await ethers.deployContract("JanSetuTimelock", [delay, [safe.address], [safe.address]]);
    await handOverGovernance(f, f.admin, { timelock: await timelock.getAddress(), ops: ops2.address, guardian: guardian.address });

    // deployer is powerless
    await expect(f.config.connect(f.admin).setUint(k("REQUIRE_KYC"), 1)).to.be.reverted;
    await expect(f.token.connect(f.admin).pause()).to.be.reverted;
    await expect(f.daily.connect(f.admin).setTier(E(7), true)).to.be.reverted;
    expect(await f.token.hasRole(await f.token.DEFAULT_ADMIN_ROLE(), f.admin.address)).to.equal(false);

    // guardian can pause but cannot move funds or change config
    await f.daily.connect(guardian).pause();
    await f.daily.connect(guardian).unpause();
    await expect(f.config.connect(guardian).setUint(k("REQUIRE_KYC"), 1)).to.be.reverted;

    // a config change must go through the timelock
    const data = f.config.interface.encodeFunctionData("setUint", [k("REQUIRE_KYC"), 1]);
    const salt = ethers.id("kyc-on");
    await timelock.connect(safe).schedule(await f.config.getAddress(), 0, data, ethers.ZeroHash, salt, delay);
    await expect(timelock.connect(safe).execute(await f.config.getAddress(), 0, data, ethers.ZeroHash, salt)).to.be.reverted;
    await time.increase(delay + 1);
    await timelock.connect(safe).execute(await f.config.getAddress(), 0, data, ethers.ZeroHash, salt);
    expect(await f.config.getUint(k("REQUIRE_KYC"))).to.equal(1);
  });
});
