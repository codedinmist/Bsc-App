import { expect } from "chai";
import { ethers, network } from "hardhat";
import { fixture, E, DAY } from "./fixture";

async function base() {
  const f = await fixture();
  const T = await f.token.getAddress();
  const vaults = [await f.daily.getAddress(), await f.rd.getAddress(), await f.fd.getAddress()];
  return { ...f, T, vaults };
}
const mine = async (n: number) => { for (let i = 0; i < n; i++) await network.provider.send("evm_mine"); };

describe("SundayJackpot", () => {
  async function setup() {
    const s = await base();
    const jp = await (await ethers.getContractFactory("SundayJackpot")).deploy(s.admin.address, s.T, await s.registry.getAddress(), s.vaults, await s.forwarder.getAddress());
    await s.token.approve(await jp.getAddress(), ethers.MaxUint256);
    await jp.fund(E(500_000));
    for (const u of [s.alice, s.bob, s.carol]) await s.fd.connect(u).open(1, E(5_000), false);
    return { ...s, jp };
  }

  it("needs savings to enter, one entry per week, draws after the week, pays prizes from the pool only", async () => {
    const { jp, alice, bob, carol, admin, token } = await setup();
    await expect(jp.connect(admin).enter()).to.be.revertedWithCustomError(jp, "NotEligible");
    for (const u of [alice, bob, carol]) await jp.connect(u).enter();
    await expect(jp.connect(alice).enter()).to.be.revertedWithCustomError(jp, "AlreadyEntered");
    const week = await jp.weekNow();
    await expect(jp.commitDraw(week)).to.be.revertedWithCustomError(jp, "WeekNotOver");
    await network.provider.send("evm_increaseTime", [8 * DAY]); await mine(1);
    await jp.commitDraw(week);
    await expect(jp.reveal(week)).to.be.revertedWithCustomError(jp, "TooSoon");
    await mine(4);
    await jp.reveal(week);
    const d = await jp.draws(week);
    expect(d.winners).to.equal(3n);
    let total = 0n;
    for (const u of [alice, bob, carol]) {
      const p = await jp.prize(week, u.address);
      expect(p).to.be.gte(E(500)).and.lte(E(10_000));
      expect(p % E(500)).to.equal(0n);
      total += p;
      const b = await token.balanceOf(u.address);
      await jp.connect(u).claim(week);
      expect((await token.balanceOf(u.address)) - b).to.equal(p);
      await expect(jp.connect(u).claim(week)).to.be.revertedWithCustomError(jp, "NothingToClaim");
    }
    expect(await jp.pool()).to.equal(E(500_000) - total);
    expect(await jp.isSolvent()).to.equal(true);
    await expect(jp.reveal(week)).to.be.revertedWithCustomError(jp, "AlreadyDone");
  });

  it("never promises more than the pool: an underfunded draw pays fewer winners", async () => {
    const s = await setup(); const { admin, alice, bob, carol, registry, token, fd } = s;
    const jp = await (await ethers.getContractFactory("SundayJackpot")).deploy(admin.address, s.T, await registry.getAddress(), s.vaults, await s.forwarder.getAddress());
    await token.approve(await jp.getAddress(), ethers.MaxUint256);
    await jp.fund(E(600));
    for (const u of [alice, bob, carol]) await jp.connect(u).enter();
    const week = await jp.weekNow();
    await network.provider.send("evm_increaseTime", [8 * DAY]); await mine(1);
    await jp.commitDraw(week); await mine(4); await jp.reveal(week);
    expect((await jp.draws(week)).winners).to.be.lte(1n);
    expect(await jp.isSolvent()).to.equal(true);
  });

  it("an expired reveal can be re-committed", async () => {
    const { jp, alice } = await setup();
    await jp.connect(alice).enter();
    const week = await jp.weekNow();
    await network.provider.send("evm_increaseTime", [8 * DAY]); await mine(1);
    await jp.commitDraw(week);
    await expect(jp.commitDraw(week)).to.be.revertedWithCustomError(jp, "TooSoon");
    await mine(300);
    await expect(jp.reveal(week)).to.be.revertedWithCustomError(jp, "Expired");
    await jp.commitDraw(week); await mine(4); await jp.reveal(week);
    expect((await jp.draws(week)).done).to.equal(true);
  });
});

describe("InsurancePool", () => {
  async function setup() {
    const s = await base();
    const { admin, alice, bob, token, registry, staking, daily, receipts } = s;
    const [, , , , , , , agent, , , claims] = await ethers.getSigners();
    const pool = await (await ethers.getContractFactory("LoanLiquidityPool")).deploy(admin.address, s.T, await s.forwarder.getAddress());
    const score = await (await ethers.getContractFactory("CreditScoreNFT")).deploy(admin.address, await s.forwarder.getAddress());
    const micro = await (await ethers.getContractFactory("MicroCredit")).deploy(admin.address, s.T, await registry.getAddress(), await staking.getAddress(), await pool.getAddress(), await score.getAddress(), await daily.getAddress(), await receipts.getAddress(), await s.forwarder.getAddress());
    const ins = await (await ethers.getContractFactory("InsurancePool")).deploy(admin.address, s.T, s.vaults, await micro.getAddress(), await s.forwarder.getAddress());
    await ins.grantRole(await ins.CLAIMS_ROLE(), claims.address);
    await micro.grantRole(await micro.RELIEF_ROLE(), await ins.getAddress());
    await token.approve(await ins.getAddress(), ethers.MaxUint256); await ins.fund(E(1_000_000));
    await s.fd.connect(alice).open(1, E(60_000), false);
    await s.fd.connect(bob).open(1, E(10_000), false);
    return { ...s, ins, micro, claims };
  }

  it("covers only savers above the threshold, pays up to the cap from the pool, once per cooldown", async () => {
    const { ins, alice, bob, claims, token } = await setup();
    await expect(ins.connect(bob).fileClaim(0, E(5_000), 0, ethers.id("e"))).to.be.revertedWithCustomError(ins, "NotEligible");
    await expect(ins.connect(alice).fileClaim(0, E(300_000), 0, ethers.id("e"))).to.be.revertedWithCustomError(ins, "BadParam");
    await ins.connect(alice).fileClaim(0, E(150_000), 0, ethers.id("hospital"));
    await expect(ins.connect(alice).fileClaim(0, E(1), 0, ethers.id("e"))).to.be.revertedWithCustomError(ins, "HasOpenClaim");
    await expect(ins.connect(alice).decide(1, true, E(1))).to.be.reverted;
    const b = await token.balanceOf(alice.address);
    await ins.connect(claims).decide(1, true, E(500_000)); // clamped to requested
    expect((await token.balanceOf(alice.address)) - b).to.equal(E(150_000));
    await expect(ins.connect(alice).fileClaim(0, E(1_000), 0, ethers.id("e"))).to.be.revertedWithCustomError(ins, "Cooldown");
    expect(await ins.isSolvent()).to.equal(true);
    await expect(ins.connect(claims).decide(1, true, 1)).to.be.revertedWithCustomError(ins, "NotOpen");
  });

  it("rejections pay nothing and free the claimant", async () => {
    const { ins, alice, claims } = await setup();
    await ins.connect(alice).fileClaim(0, E(1_000), 0, ethers.id("x"));
    await ins.connect(claims).decide(1, false, 0);
    await ins.connect(alice).fileClaim(0, E(1_000), 0, ethers.id("y"));
  });

  it("EMI relief claim is only for the borrower of that loan", async () => {
    const { ins, alice, bob } = await setup();
    await expect(ins.connect(alice).fileClaim(1, 0, 1, ethers.id("e"))).to.be.revertedWithCustomError(ins, "NotBorrower");
  });
});

describe("PredictionLP + MockPredictionMarket (simulated)", () => {
  it("splits 2% fees 50/50, LPs withdraw principal anytime, solvency holds", async () => {
    const s = await base(); const { admin, alice, bob, token } = s;
    const [, , , , , , , , , sink] = await ethers.getSigners();
    const lp = await (await ethers.getContractFactory("PredictionLP")).deploy(admin.address, s.T, sink.address, await s.forwarder.getAddress());
    const mkt = await (await ethers.getContractFactory("MockPredictionMarket")).deploy(admin.address, s.T, await lp.getAddress());
    await lp.grantRole(await lp.FEE_ROLE(), await mkt.getAddress());
    await token.approve(await mkt.getAddress(), ethers.MaxUint256);
    for (const u of [alice, bob]) await token.connect(u).approve(await lp.getAddress(), ethers.MaxUint256);
    await lp.connect(alice).deposit(E(30_000)); await lp.connect(bob).deposit(E(10_000));
    await expect(mkt.connect(alice).simulateTrade(E(1_000))).to.be.reverted;
    await mkt.simulateTrade(E(100_000)); // fee 2,000 -> 1,000 LPs, 1,000 sink
    expect(await token.balanceOf(sink.address)).to.equal(E(1_000));
    expect(await lp.pendingOf(alice.address)).to.be.closeTo(E(750), E(0.001));
    expect(await lp.pendingOf(bob.address)).to.be.closeTo(E(250), E(0.001));
    const before = await token.balanceOf(alice.address);
    await lp.connect(alice).claimRewards();
    expect((await token.balanceOf(alice.address)) - before).to.be.closeTo(E(750), E(0.001));
    await lp.connect(alice).withdraw(E(30_000));
    await lp.connect(bob).withdraw(E(10_000));
    await lp.connect(bob).claimRewards();
    expect(await lp.isSolvent()).to.equal(true);
    await expect(lp.connect(alice).withdraw(1)).to.be.revertedWithCustomError(lp, "TooMuch");
    expect(await token.balanceOf(await lp.getAddress())).to.be.lt(E(0.01));
  });

  it("with no LPs all fees go to the protocol", async () => {
    const s = await base(); const { admin, token } = s;
    const [, , , , , , , , , sink] = await ethers.getSigners();
    const lp = await (await ethers.getContractFactory("PredictionLP")).deploy(admin.address, s.T, sink.address, await s.forwarder.getAddress());
    const mkt = await (await ethers.getContractFactory("MockPredictionMarket")).deploy(admin.address, s.T, await lp.getAddress());
    await lp.grantRole(await lp.FEE_ROLE(), await mkt.getAddress());
    await token.approve(await mkt.getAddress(), ethers.MaxUint256);
    await mkt.simulateTrade(E(10_000));
    expect(await token.balanceOf(sink.address)).to.equal(E(200));
  });
});

describe("YieldStrategyAdapter + MockStrategy (simulated)", () => {
  it("invests only treasury funds up to the cap, yield only from the reserve", async () => {
    const s = await base(); const { admin, token } = s;
    const tre = await (await ethers.getContractFactory("Treasury")).deploy(admin.address, s.T, E(1_000_000));
    const ad = await (await ethers.getContractFactory("YieldStrategyAdapter")).deploy(admin.address, s.T, await tre.getAddress(), E(100_000));
    const st = await (await ethers.getContractFactory("MockStrategy")).deploy(admin.address, s.T, await ad.getAddress());
    await ad.setStrategy(await st.getAddress());
    await token.approve(await st.getAddress(), ethers.MaxUint256); await st.fundReserve(E(10_000));
    await token.transfer(await ad.getAddress(), E(200_000));
    await expect(ad.invest(E(100_001))).to.be.revertedWithCustomError(ad, "OverCap");
    await ad.invest(E(100_000));
    await network.provider.send("evm_increaseTime", [365 * DAY]); await mine(1);
    expect(await st.totalAssets()).to.be.closeTo(E(108_000), E(5));
    await ad.divest(E(100_000));
    expect(await token.balanceOf(await ad.getAddress())).to.be.closeTo(E(208_000), E(5));
    await ad.returnToTreasury(E(50_000));
    expect(await token.balanceOf(await tre.getAddress())).to.equal(E(50_000));
    await expect(ad.connect(s.alice).invest(1)).to.be.reverted;
  });

  it("yield stops at the reserve and the strategy never owes more than it holds", async () => {
    const s = await base(); const { admin, token } = s;
    const ad = await (await ethers.getContractFactory("YieldStrategyAdapter")).deploy(admin.address, s.T, admin.address, E(100_000));
    const st = await (await ethers.getContractFactory("MockStrategy")).deploy(admin.address, s.T, await ad.getAddress());
    await ad.setStrategy(await st.getAddress());
    await token.approve(await st.getAddress(), ethers.MaxUint256); await st.fundReserve(E(100));
    await token.transfer(await ad.getAddress(), E(100_000));
    await ad.invest(E(100_000));
    await network.provider.send("evm_increaseTime", [3 * 365 * DAY]); await mine(1);
    expect(await st.totalAssets()).to.equal(E(100_100));
    await ad.divest(E(100_000));
    expect(await token.balanceOf(await st.getAddress())).to.equal(0n);
  });
});

describe("Gas-free transactions on Phase 4 contracts", () => {
  it("a relayer can execute a user's signed jackpot entry and credit-score mint; the user is the sender", async () => {
    const s = await base();
    const { forwarder, alice, relayer, admin } = s;
    const jp = await (await ethers.getContractFactory("SundayJackpot")).deploy(admin.address, s.T, await s.registry.getAddress(), s.vaults, await forwarder.getAddress());
    const score = await (await ethers.getContractFactory("CreditScoreNFT")).deploy(admin.address, await forwarder.getAddress());
    await s.fd.connect(alice).open(1, E(5_000), false);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const send = async (to: any, data: string) => {
      const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
      const req = { from: alice.address, to: await to.getAddress(), value: 0n, gas: 500000n, nonce: await forwarder.nonces(alice.address), deadline, data };
      const signature = await alice.signTypedData(
        { name: "JanSetuForwarder", version: "1", chainId, verifyingContract: await forwarder.getAddress() },
        { ForwardRequest: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] },
        req);
      await forwarder.connect(relayer).execute({ ...req, signature });
    };
    await send(jp, jp.interface.encodeFunctionData("enter"));
    expect(await jp.entered(await jp.weekNow(), alice.address)).to.equal(true);
    await send(score, score.interface.encodeFunctionData("mint"));
    expect(await score.tokenOf(alice.address)).to.equal(1n);
    expect(await score.ownerOf(1)).to.equal(alice.address);
  });
});
