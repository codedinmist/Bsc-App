import { expect } from "chai";
import { ethers, network } from "hardhat";
import { fixture, E, DAY } from "./fixture";

async function setup() {
  const f = await fixture();
  const { admin, alice, bob, registry, token, daily, fd, rd, receipts, staking } = f;
  const [, , , , , , , agent] = await ethers.getSigners();
  const T = await token.getAddress();
  const pool = await (await ethers.getContractFactory("LoanLiquidityPool")).deploy(admin.address, T, await f.forwarder.getAddress());
  const score = await (await ethers.getContractFactory("CreditScoreNFT")).deploy(admin.address, await f.forwarder.getAddress());
  const micro = await (await ethers.getContractFactory("MicroCredit")).deploy(admin.address, T, await registry.getAddress(), await staking.getAddress(), await pool.getAddress(), await score.getAddress(), await daily.getAddress(), await receipts.getAddress(), await f.forwarder.getAddress());
  const coll = await (await ethers.getContractFactory("CollateralLoan")).deploy(admin.address, T, await pool.getAddress(), await score.getAddress(), await receipts.getAddress(), await f.forwarder.getAddress());
  for (const c of [micro, coll]) {
    await pool.grantRole(await pool.BORROWER_ROLE(), await c.getAddress());
    await score.grantRole(await score.SCORER_ROLE(), await c.getAddress());
    await receipts.grantRole(await receipts.ISSUER_ROLE(), await c.getAddress());
  }
  await pool.setCreditLine(await micro.getAddress(), E(300_000));
  await pool.setCreditLine(await coll.getAddress(), E(600_000));
  for (const v of [daily, rd, fd]) { await v.grantRole(await v.COLLATERAL_ROLE(), await coll.getAddress()); await coll.setVault(await v.getAddress(), true); }
  await token.approve(await pool.getAddress(), ethers.MaxUint256);
  await pool.deposit(E(2_000_000));
  // agent with stake
  await registry.connect(agent).register(); await registry.assignAgent(agent.address, 1, 1, 1); await registry.setAgentVerified(agent.address, true);
  await token.transfer(agent.address, E(100_000)); await token.connect(agent).approve(await staking.getAddress(), ethers.MaxUint256);
  await staking.connect(agent).stake(E(30_000));
  for (const u of [alice, bob]) { await token.connect(u).approve(await micro.getAddress(), ethers.MaxUint256); await token.connect(u).approve(await coll.getAddress(), ethers.MaxUint256); }
  return { ...f, agent, pool, score, micro, coll };
}

async function fifteenDailies(s: any, who: any) {
  await s.daily.connect(who).open(E(100));
  const id = (await s.daily.idsOf(who.address)).at(-1);
  for (let i = 0; i < 15; i++) { await s.daily.connect(who).deposit(id, i); await network.provider.send("evm_increaseTime", [DAY]); await network.provider.send("evm_mine"); }
  return id;
}

describe("MicroCredit (Vyapar)", () => {
  it("full lifecycle: 15 dailies, agent verification, 10,000 loan, 120 repayments, score up, pool earns 2,000", async () => {
    const s = await setup(); const { micro, alice, agent, token, pool, score } = s;
    const pid = await fifteenDailies(s, alice);
    await micro.connect(agent).verifyApplicant(alice.address);
    const before = await token.balanceOf(alice.address);
    await micro.connect(alice).borrow(0, pid);
    expect((await token.balanceOf(alice.address)) - before).to.equal(E(10_000));
    const lpBefore = await pool.totalAssets();
    await micro.connect(alice).repay(1, 60);
    await micro.connect(alice).repay(1, 60);
    expect((await micro.getLoan(1)).status).to.equal(2n);
    expect(await pool.totalAssets()).to.equal(lpBefore + E(2_000));
    expect(await pool.outstanding()).to.equal(0n);
    expect(await score.scoreOf(alice.address)).to.be.gt(500n);
    expect(await micro.completedCount(alice.address)).to.equal(1n);
  });

  it("rejects: no verification, too few deposits, someone else's position, second loan, reused position", async () => {
    const s = await setup(); const { micro, alice, bob, agent } = s;
    const pid = await fifteenDailies(s, alice);
    await expect(micro.connect(alice).borrow(0, pid)).to.be.revertedWithCustomError(micro, "NotVerified");
    await micro.connect(agent).verifyApplicant(alice.address);
    await micro.connect(agent).verifyApplicant(bob.address);
    await expect(micro.connect(bob).borrow(0, pid)).to.be.revertedWithCustomError(micro, "BadPosition");
    await s.daily.connect(bob).open(E(100)); await s.daily.connect(bob).deposit(2, 0);
    await expect(micro.connect(bob).borrow(0, 2)).to.be.revertedWithCustomError(micro, "BadPosition");
    await micro.connect(alice).borrow(0, pid);
    await expect(micro.connect(alice).borrow(0, pid)).to.be.revertedWithCustomError(micro, "HasLoan");
    await expect(micro.connect(bob).verifyApplicant(alice.address)).to.be.revertedWithCustomError(micro, "NotAgent");
  });

  it("an agent whose stake dropped below the minimum cannot verify", async () => {
    const s = await setup(); const { micro, alice, agent, staking } = s;
    await staking.connect(agent).requestUnstake(E(10_000));
    await expect(micro.connect(agent).verifyApplicant(alice.address)).to.be.revertedWithCustomError(micro, "AgentNotStaked");
  });

  it("late payment lowers score; default writes off unpaid principal and blocks new loans", async () => {
    const s = await setup(); const { micro, alice, agent, pool, score } = s;
    const pid = await fifteenDailies(s, alice);
    await micro.connect(agent).verifyApplicant(alice.address);
    await micro.connect(alice).borrow(0, pid);
    await network.provider.send("evm_increaseTime", [3 * DAY]); await network.provider.send("evm_mine");
    await micro.connect(alice).repay(1, 1); // late
    expect(await score.scoreOf(alice.address)).to.equal(490n);
    await expect(micro.markDefault(1)).to.be.revertedWithCustomError(micro, "NotYetDefault");
    await network.provider.send("evm_increaseTime", [20 * DAY]); await network.provider.send("evm_mine");
    const out = await pool.outstanding();
    await micro.markDefault(1);
    expect(await pool.outstanding()).to.be.lt(out);
    expect(await pool.outstanding()).to.equal(0n);
    expect(await score.scoreOf(alice.address)).to.equal(340n);
    await expect(micro.connect(alice).borrow(1, 0)).to.be.reverted;
  });

  it("tier 1 needs a past completed loan and enough score", async () => {
    const s = await setup(); const { micro, alice, agent } = s;
    await expect(micro.connect(alice).borrow(1, 0)).to.be.revertedWithCustomError(micro, "NotEligible");
    const pid = await fifteenDailies(s, alice);
    await micro.connect(agent).verifyApplicant(alice.address);
    await micro.connect(alice).borrow(0, pid);
    await micro.connect(alice).repay(1, 120);
    await expect(micro.connect(alice).borrow(1, 0)).to.be.revertedWithCustomError(micro, "NotEligible"); // score ~ 500+25+3 < 650
    await micro.setTerms(E(10_000), 120, E(50_000), 300, 500, 86400, 14 * 86400);
    await micro.connect(alice).borrow(1, 0);
    expect((await micro.getLoan(2)).principal).to.equal(E(50_000));
  });

  it("insurance relief extends the due date once", async () => {
    const s = await setup(); const { micro, alice, agent, admin } = s;
    const pid = await fifteenDailies(s, alice);
    await micro.connect(agent).verifyApplicant(alice.address);
    await micro.connect(alice).borrow(0, pid);
    await micro.grantRole(await micro.RELIEF_ROLE(), admin.address);
    const due = (await micro.getLoan(1)).nextDue;
    await micro.grantRelief(1);
    expect((await micro.getLoan(1)).nextDue).to.equal(due + BigInt(30 * DAY));
    await expect(micro.grantRelief(1)).to.be.revertedWithCustomError(micro, "NotActive");
  });
});

describe("LoanLiquidityPool", () => {
  it("enforces credit lines, utilisation cap and idle-cash withdrawals", async () => {
    const s = await setup(); const { pool, admin, micro } = s;
    await expect(pool.connect(admin).lend(admin.address, 1)).to.be.reverted; // no role
    expect(await pool.lpValue(admin.address)).to.be.closeTo(E(2_000_000), E(1));
    const sh = await pool.shares(admin.address);
    await pool.withdraw(sh / 2n);
    await expect(pool.withdraw(sh)).to.be.reverted; // only half remains
    expect(await pool.maxUtilBps()).to.equal(8000n);
  });
});

describe("CreditScoreNFT", () => {
  it("is soulbound and changeable only by scorers", async () => {
    const s = await setup(); const { score, alice, bob } = s;
    await score.connect(alice).mint();
    await expect(score.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWithCustomError(score, "Soulbound");
    await expect(score.connect(alice).recordOnTime(alice.address)).to.be.reverted;
    expect(await score.scoreOf(bob.address)).to.equal(500n);
    expect(await score.tokenURI(1)).to.contain("data:application/json;base64,");
  });
});

describe("CollateralLoan", () => {
  async function pledged(s: any, amount = E(100_000)) {
    await s.fd.connect(s.alice).open(1, amount, false);
    await s.fd.connect(s.alice).pledge(1, amount, await s.coll.getAddress());
  }

  it("lends up to 80%, locks the position, and a full repayment frees it", async () => {
    const s = await setup(); await pledged(s); const { coll, fd, alice, pool } = s;
    await expect(coll.connect(alice).borrow(await fd.getAddress(), 1, E(100_000), E(80_001), 30)).to.be.revertedWithCustomError(coll, "OverLtv");
    await coll.connect(alice).borrow(await fd.getAddress(), 1, E(100_000), E(80_000), 30);
    await expect(fd.connect(alice).withdrawEarly(1)).to.be.revertedWithCustomError(fd, "CollateralLocked");
    const l = await coll.getLoan(1);
    await coll.connect(alice).repay(1, l.owed);
    expect(await fd.pledgedTo(1, await coll.getAddress())).to.equal(0n);
    expect((await coll.getLoan(1)).status).to.equal(2n);
    await fd.connect(alice).withdrawEarly(1);
    expect(await pool.outstanding()).to.equal(0n);
  });

  it("unused pledges can be released by the owner only, and never collateral backing a loan", async () => {
    const s = await setup(); await pledged(s, E(10_000)); const { coll, fd, alice, bob } = s;
    const v = await fd.getAddress();
    await expect(coll.connect(bob).releaseUnused(v, 1, E(1_000))).to.be.revertedWithCustomError(coll, "NotOwner");
    await coll.connect(alice).borrow(v, 1, E(6_000), E(4_000), 30);
    await expect(coll.connect(alice).releaseUnused(v, 1, E(4_001))).to.be.revertedWithCustomError(coll, "PledgeShort"); // only 4,000 is free
    await coll.connect(alice).releaseUnused(v, 1, E(4_000));
    expect(await fd.pledgedTo(1, await coll.getAddress())).to.equal(E(6_000));
    await expect(fd.connect(alice).withdrawEarly(1)).to.be.revertedWithCustomError(fd, "CollateralLocked");
  });

  it("cannot borrow beyond what was pledged or against someone else's position", async () => {
    const s = await setup(); await pledged(s, E(10_000)); const { coll, fd, alice, bob } = s;
    await expect(coll.connect(alice).borrow(await fd.getAddress(), 1, E(20_000), E(5_000), 30)).to.be.revertedWithCustomError(coll, "PledgeShort");
    await expect(coll.connect(bob).borrow(await fd.getAddress(), 1, E(10_000), E(5_000), 30)).to.be.revertedWithCustomError(coll, "NotOwner");
    await coll.connect(alice).borrow(await fd.getAddress(), 1, E(10_000), E(8_000), 30);
    await expect(coll.connect(alice).borrow(await fd.getAddress(), 1, E(10_000), E(1_000), 30)).to.be.revertedWithCustomError(coll, "PledgeShort"); // collateral already used
  });

  it("liquidates only after due + grace and seizes only what is owed", async () => {
    const s = await setup(); await pledged(s); const { coll, fd, alice, pool, score, token } = s;
    await coll.connect(alice).borrow(await fd.getAddress(), 1, E(100_000), E(50_000), 30);
    await expect(coll.liquidate(1)).to.be.revertedWithCustomError(coll, "NotDue");
    await network.provider.send("evm_increaseTime", [34 * DAY]); await network.provider.send("evm_mine");
    const l = await coll.getLoan(1);
    await coll.liquidate(1);
    const pos = await fd.getPosition(1);
    expect(pos.principal).to.equal(E(100_000) - l.owed);
    expect(await fd.pledgedTo(1, await coll.getAddress())).to.equal(0n);
    expect(await pool.outstanding()).to.equal(0n);
    expect(await score.scoreOf(alice.address)).to.equal(350n);
    expect(await fd.isSolvent()).to.equal(true);
    expect(await token.balanceOf(await coll.getAddress())).to.equal(0n);
  });
});
