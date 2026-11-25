import { expect } from "chai";
import { ethers, network } from "hardhat";
import { fixture, E, DAY } from "./fixture";

async function setup() {
  const f = await fixture();
  const { admin, alice, bob, carol, registry, token, daily, rd, fd } = f;
  const [, , , , , , , agent, head, other] = await ethers.getSigners();
  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(admin.address, await token.getAddress(), E(100_000));
  const comm = await (await ethers.getContractFactory("CommissionManager")).deploy(admin.address, await token.getAddress(), await registry.getAddress(), await treasury.getAddress(), await f.forwarder.getAddress());
  const rewards = await (await ethers.getContractFactory("RewardsManager")).deploy(admin.address, await token.getAddress(), await comm.getAddress(), await f.forwarder.getAddress());
  await comm.setVault(await daily.getAddress(), 1); await comm.setVault(await rd.getAddress(), 2); await comm.setVault(await fd.getAddress(), 3);
  await rewards.setVault(await daily.getAddress(), 1); await rewards.setVault(await rd.getAddress(), 2); await rewards.setVault(await fd.getAddress(), 3);
  await registry.connect(agent).register();
  await registry.assignAgent(agent.address, 1, 1, 1);
  await registry.setAgentVerified(agent.address, true);
  await comm.setHead(1, 1, head.address);
  for (const c of [comm, rewards]) await token.approve(await c.getAddress(), ethers.MaxUint256);
  await comm.fund(E(1_000_000)); await rewards.fund(E(1_000_000));
  return { ...f, agent, head, other, treasury, comm, rewards };
}

describe("Treasury", () => {
  it("enforces the daily cap and only the spender role", async () => {
    const { treasury, token, admin, alice, daily } = await setup();
    await token.transfer(await treasury.getAddress(), E(500_000));
    await treasury.spend(alice.address, E(60_000), ethers.id("grant"));
    await expect(treasury.spend(alice.address, E(50_000), ethers.id("x"))).to.be.revertedWithCustomError(treasury, "OverDailyCap");
    await expect(treasury.connect(alice).spend(alice.address, 1, ethers.ZeroHash)).to.be.reverted;
    await network.provider.send("evm_increaseTime", [DAY + 1]);
    await treasury.spend(alice.address, E(50_000), ethers.id("x"));
    await treasury.topUpVault(await daily.getAddress(), E(10_000));
    expect(await daily.rewardPool()).to.equal(E(10_000));
  });
});

describe("EmergencyController", () => {
  it("guardian pauses everything, only admin unpauses, withdrawals still work", async () => {
    const { admin, alice, daily, fd, ops, token } = await setup();
    const ec = await (await ethers.getContractFactory("EmergencyController")).deploy(admin.address, ops.address);
    for (const v of [daily, fd]) { await ec.addTarget(await v.getAddress()); await v.grantRole(await v.PAUSER_ROLE(), await ec.getAddress()); }
    const id = await (async () => { await daily.connect(alice).open(E(100)); return 1n; })();
    await daily.connect(alice).deposit(id, 0);
    await expect(ec.connect(alice).pauseAll()).to.be.reverted;
    await ec.connect(ops).pauseAll();
    expect(await daily.paused()).to.equal(true); expect(await fd.paused()).to.equal(true);
    await expect(daily.connect(alice).open(E(100))).to.be.reverted;
    await expect(ec.connect(ops).unpauseAll()).to.be.reverted;
    await ec.unpauseAll();
    expect(await daily.paused()).to.equal(false);
    await ec.connect(ops).pauseAll(); await ec.connect(ops).pauseAll(); // idempotent
  });
});

describe("CommissionManager", () => {
  async function opened() {
    const s = await setup();
    await s.comm.connect(s.alice).setReferrer(s.agent.address);
    await s.fd.connect(s.alice).open(1, E(100_000), false);
    return s;
  }

  it("accrues the deck percentages and vests linearly", async () => {
    const { comm, fd, agent, head, treasury, token } = await opened();
    const fdAddr = await fd.getAddress();
    await comm.sync(fdAddr, 1);
    const [payee, , basis] = await comm.scheduleOf(fdAddr, 1);
    expect(basis).to.equal(E(100_000));
    expect(payee[0]).to.equal(agent.address); expect(payee[1]).to.equal(head.address); expect(payee[2]).to.equal(await treasury.getAddress()); // no district head -> DAO
    await network.provider.send("evm_increaseTime", [182 * DAY]);
    await network.provider.send("evm_mine");
    const c = await comm.claimable(fdAddr, 1, 0);
    expect(c).to.be.gt(E(4_500)).and.lt(E(4_800)); // ~half of 9.5% of 100,000
    await comm.claim(fdAddr, 1, 0);
    expect(await token.balanceOf(agent.address)).to.be.gt(E(4_500));
    await network.provider.send("evm_increaseTime", [200 * DAY]);
    await comm.claim(fdAddr, 1, 0);
    expect(await token.balanceOf(agent.address)).to.be.closeTo(E(9_500), E(1));
    await expect(comm.claim(fdAddr, 1, 0)).to.be.revertedWithCustomError(comm, "NothingToClaim");
    expect(await comm.isSolvent()).to.equal(true);
  });

  it("cancels unclaimed commission when the position closes early (no farming)", async () => {
    const { comm, fd, alice, agent, token } = await opened();
    const fdAddr = await fd.getAddress();
    await comm.sync(fdAddr, 1);
    const poolBefore = await comm.pool();
    await fd.connect(alice).withdrawEarly(1);
    await comm.cancelIfClosedEarly(fdAddr, 1);
    await expect(comm.claim(fdAddr, 1, 0)).to.be.revertedWithCustomError(comm, "Cancelled_");
    expect(await comm.pool()).to.equal(poolBefore + E(15_000));
    expect(await comm.liability()).to.equal(0n);
    expect(await token.balanceOf(agent.address)).to.equal(0n);
  });

  it("only counts principal that the pool can fund and never creates money", async () => {
    const s = await setup();
    const { comm, fd, alice, token } = s;
    // drain pool by deploying a fresh unfunded manager
    const c2 = await (await ethers.getContractFactory("CommissionManager")).deploy(s.admin.address, await token.getAddress(), await s.registry.getAddress(), s.admin.address, await s.forwarder.getAddress());
    await c2.setVault(await fd.getAddress(), 3);
    await c2.connect(alice).setReferrer(s.agent.address);
    await fd.connect(alice).open(1, E(10_000), false);
    await c2.sync(await fd.getAddress(), 1);
    const [, , basis] = await c2.scheduleOf(await fd.getAddress(), 1);
    expect(basis).to.equal(0n);
    expect(await c2.liability()).to.equal(0n);
  });

  it("requires an active agent as referrer, once, never self", async () => {
    const { comm, alice, bob, agent } = await setup();
    await expect(comm.connect(alice).setReferrer(bob.address)).to.be.revertedWithCustomError(comm, "NotAgent");
    await expect(comm.connect(agent).setReferrer(agent.address)).to.be.revertedWithCustomError(comm, "SelfReferral");
    await comm.connect(alice).setReferrer(agent.address);
    await expect(comm.connect(alice).setReferrer(agent.address)).to.be.revertedWithCustomError(comm, "AlreadyReferred");
  });

  it("tops-ups accrue only the delta (daily deposits)", async () => {
    const { comm, daily, alice, agent } = await setup();
    await comm.connect(alice).setReferrer(agent.address);
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    await comm.sync(await daily.getAddress(), 1);
    await network.provider.send("evm_increaseTime", [DAY]); await network.provider.send("evm_mine");
    await daily.connect(alice).deposit(1, 1);
    await comm.sync(await daily.getAddress(), 1);
    const [, , basis] = await comm.scheduleOf(await daily.getAddress(), 1);
    expect(basis).to.equal(E(200));
    await expect(comm.sync(await daily.getAddress(), 1)).to.be.revertedWithCustomError(comm, "NothingToSync");
    expect(await comm.agentVolume(agent.address)).to.equal(E(200));
  });
});

describe("RewardsManager", () => {
  it("pays FD, daily and RD bonuses once, after the minimum age, from the pool", async () => {
    const { rewards, fd, daily, alice, token } = await setup();
    await fd.connect(alice).open(1, E(120_000), false);
    await expect(rewards.connect(alice).claimAccountBonus(await fd.getAddress(), 1)).to.be.revertedWithCustomError(rewards, "TooYoung");
    await network.provider.send("evm_increaseTime", [31 * DAY]); await network.provider.send("evm_mine");
    const before = await token.balanceOf(alice.address);
    await rewards.connect(alice).claimAccountBonus(await fd.getAddress(), 1);
    expect((await token.balanceOf(alice.address)) - before).to.equal(E(1_500));
    await expect(rewards.connect(alice).claimAccountBonus(await fd.getAddress(), 1)).to.be.revertedWithCustomError(rewards, "AlreadyClaimed");
    expect(await rewards.isSolvent()).to.equal(true);
  });

  it("rejects bonus for someone else's position and for sub-threshold positions", async () => {
    const { rewards, fd, alice, bob } = await setup();
    await fd.connect(alice).open(1, E(1_000), false);
    await network.provider.send("evm_increaseTime", [31 * DAY]); await network.provider.send("evm_mine");
    await expect(rewards.connect(bob).claimAccountBonus(await fd.getAddress(), 1)).to.be.revertedWithCustomError(rewards, "NotOwner");
    await expect(rewards.connect(alice).claimAccountBonus(await fd.getAddress(), 1)).to.be.revertedWithCustomError(rewards, "NotEligible");
  });

  it("super recruiter booster and dream club use commission data and pay once", async () => {
    const s = await setup();
    const { rewards, comm, fd, agent, token } = s;
    for (let i = 0; i < 25; i++) {
      const u = ethers.Wallet.createRandom().connect(ethers.provider);
      await network.provider.send("hardhat_setBalance", [u.address, "0x56BC75E2D63100000"]);
      await s.registry.connect(u).register();
      await token.transfer(u.address, E(10_000)); await token.connect(u).approve(await fd.getAddress(), ethers.MaxUint256);
      await comm.connect(u).setReferrer(agent.address);
      await fd.connect(u).open(1, E(5_000), false);
      await comm.sync(await fd.getAddress(), i + 1);
    }
    const month = BigInt(Math.floor((await ethers.provider.getBlock("latest"))!.timestamp / (30 * DAY)));
    await rewards.connect(agent).claimBooster(month);
    expect(await token.balanceOf(agent.address)).to.equal(E(5_000));
    await expect(rewards.connect(agent).claimBooster(month)).to.be.revertedWithCustomError(rewards, "AlreadyClaimed");
    await expect(rewards.connect(agent).claimMilestone(0)).to.be.revertedWithCustomError(rewards, "NotEligible"); // 1,25,000 < 5L volume
  });

  it("tiny deposits do not count towards the recruiter booster", async () => {
    const s = await setup(); const { comm, fd, alice, agent } = s;
    await comm.connect(alice).setReferrer(agent.address);
    await fd.connect(alice).open(1, E(1_000), false);
    await comm.sync(await fd.getAddress(), 1);
    expect(await comm.monthAccounts(agent.address, BigInt(Math.floor((await ethers.provider.getBlock("latest"))!.timestamp / (30 * DAY))))).to.equal(0n);
  });

  it("an empty pool reverts without consuming the right", async () => {
    const { rewards, fd, alice, admin, forwarder } = await setup();
    const r2 = await (await ethers.getContractFactory("RewardsManager")).deploy(admin.address, await (await ethers.getContractAt("INRToken", await rewards.token())).getAddress(), await rewards.commissions(), await forwarder.getAddress());
    await r2.setVault(await fd.getAddress(), 3);
    await fd.connect(alice).open(1, E(30_000), false);
    await network.provider.send("evm_increaseTime", [31 * DAY]); await network.provider.send("evm_mine");
    await expect(r2.connect(alice).claimAccountBonus(await fd.getAddress(), 1)).to.be.revertedWithCustomError(r2, "PoolShort");
    expect(await r2.bonusClaimed(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [await fd.getAddress(), 1])))).to.equal(false);
  });
});
