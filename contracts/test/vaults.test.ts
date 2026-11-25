import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { fixture, E, k, DAY } from "./fixture";

const ONE = E(1);
const near = (a: bigint, b: bigint) => expect(a >= b - 1n && a <= b + 1n, `${a} !~ ${b}`).to.equal(true);

describe("DailyVault (J-Daily)", () => {
  it("opens only for allowed tiers, registered users, and respects KYC when required", async () => {
    const { daily, config, admin, alice } = await fixture();
    await expect(daily.connect(alice).open(E(75))).to.be.revertedWithCustomError(daily, "TierNotAvailable");
    const [, , , , , , , stranger] = await ethers.getSigners();
    await expect(daily.connect(stranger).open(E(100))).to.be.revertedWithCustomError(daily, "NotRegistered");
    await config.connect(admin).setUint(k("REQUIRE_KYC"), 1);
    await expect(daily.connect(alice).open(E(100))).to.be.revertedWithCustomError(daily, "KycRequired");
  });

  it("accepts one deposit per day, rejects future/duplicate days, allows catch-up", async () => {
    const { daily, alice, token } = await fixture();
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    await expect(daily.connect(alice).deposit(1, 0)).to.be.revertedWithCustomError(daily, "AlreadyPaid");
    await expect(daily.connect(alice).deposit(1, 1)).to.be.revertedWithCustomError(daily, "InvalidDay");
    await time.increase(3 * DAY);
    await daily.connect(alice).deposit(1, 3);
    await daily.connect(alice).deposit(1, 1); // missed day caught up
    expect((await daily.getPosition(1)).principal).to.equal(E(300));
    expect(await daily.totalPrincipal()).to.equal(E(300));
    expect(await daily.isSolvent()).to.equal(true);
  });

  it("lets an agent pay for a customer; credit goes to the owner", async () => {
    const { daily, alice, bob, receipts } = await fixture();
    await daily.connect(alice).open(E(100));
    await daily.connect(bob).deposit(1, 0);
    const pos = await daily.getPosition(1);
    expect(pos.owner).to.equal(alice.address);
    expect(await receipts.ownerOf(1)).to.equal(alice.address);
  });

  it("blocks pre-maturity withdrawal in the first 30 days, then returns principal and forfeits reward", async () => {
    const { daily, alice, admin, config, token } = await fixture();
    await config.connect(admin).setUint(k("DAILY_REWARD_BPS"), 959);
    await daily.connect(admin).fundRewards(E(1000));
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    expect(await daily.totalRewardLiability()).to.be.gt(0n);
    await time.increase(29 * DAY);
    await expect(daily.connect(alice).withdrawEarly(1)).to.be.revertedWithCustomError(daily, "TooEarly");
    await time.increase(2 * DAY);
    const before = await token.balanceOf(alice.address);
    await daily.connect(alice).withdrawEarly(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(100));
    expect(await daily.totalRewardLiability()).to.equal(0n);
    expect(await daily.rewardPool()).to.equal(E(1000)); // reserved reward went back to the pool
    expect(await daily.isSolvent()).to.equal(true);
  });

  it("pays funded reward at maturity", async () => {
    const { daily, alice, admin, config, token } = await fixture();
    await config.connect(admin).setUint(k("DAILY_REWARD_BPS"), 1000); // 10%
    await daily.connect(admin).fundRewards(E(100));
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    await expect(daily.connect(alice).claim(1)).to.be.revertedWithCustomError(daily, "NotMatured");
    await time.increase(366 * DAY);
    const before = await token.balanceOf(alice.address);
    await daily.connect(alice).claim(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(110));
    await expect(daily.connect(alice).claim(1)).to.be.revertedWithCustomError(daily, "NotActive"); // no double claim
  });

  it("records an unfunded reward but NEVER pays it from principal", async () => {
    const { daily, alice, bob, admin, config, token } = await fixture();
    await config.connect(admin).setUint(k("DAILY_REWARD_BPS"), 1000);
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0); // pool empty
    expect((await daily.getPosition(1)).rewardUnfunded).to.equal(E(10));
    expect((await daily.getPosition(1)).rewardReserved).to.equal(0n);
    await daily.connect(bob).open(E(500));
    await daily.connect(bob).deposit(2, 0);
    await time.increase(366 * DAY);
    const before = await token.balanceOf(alice.address);
    await daily.connect(alice).claim(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(100)); // principal only
    expect(await daily.isSolvent()).to.equal(true);
  });

  it("only the owner can withdraw or claim", async () => {
    const { daily, alice, bob } = await fixture();
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    await time.increase(31 * DAY);
    await expect(daily.connect(bob).withdrawEarly(1)).to.be.revertedWithCustomError(daily, "NotOwner");
  });

  it("rejects fee-on-transfer tokens", async () => {
    const { admin, alice, forwarder, config, registry, receipts } = await fixture();
    const fee = await ethers.deployContract("FeeOnTransferToken");
    const vault = await ethers.deployContract("DailyVault", [admin.address, await forwarder.getAddress(), await fee.getAddress(), await config.getAddress(), await registry.getAddress(), await receipts.getAddress(), [E(100)]]);
    await receipts.connect(admin).grantRole(await receipts.ISSUER_ROLE(), await vault.getAddress());
    await fee.transfer(alice.address, E(1000));
    await fee.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(alice).open(E(100));
    await expect(vault.connect(alice).deposit(1, 0)).to.be.revertedWithCustomError(vault, "UnsupportedToken");
  });

  it("pause stops new deposits but never blocks withdrawal or maturity claims", async () => {
    const { daily, alice, admin } = await fixture();
    await daily.connect(alice).open(E(100));
    await daily.connect(alice).deposit(1, 0);
    await daily.connect(admin).pause();
    await expect(daily.connect(alice).open(E(100))).to.be.revertedWithCustomError(daily, "EnforcedPause");
    await expect(daily.connect(alice).deposit(1, 0)).to.be.revertedWithCustomError(daily, "EnforcedPause");
    await time.increase(31 * DAY);
    await daily.connect(alice).withdrawEarly(1);
  });

  it("collateral: owner-initiated pledge, locked funds cannot leave, pledgee limited to what was pledged", async () => {
    const { daily, alice, bob, admin, loan, token } = await fixture();
    await daily.connect(admin).grantRole(await daily.COLLATERAL_ROLE(), loan.address);
    await daily.connect(alice).open(E(500));
    await daily.connect(alice).deposit(1, 0);
    await time.increase(DAY); await daily.connect(alice).deposit(1, 1); // principal 1000? no: 2 x 500
    // pledging to an address without COLLATERAL_ROLE is refused; so is pledging more than unlocked
    await expect(daily.connect(alice).pledge(1, E(100), bob.address)).to.be.revertedWithCustomError(daily, "InvalidPledgee");
    await expect(daily.connect(alice).pledge(1, E(5000), loan.address)).to.be.revertedWithCustomError(daily, "InsufficientUnlocked");
    await daily.connect(alice).pledge(1, E(800), loan.address);
    expect(await daily.unlockedPrincipal(1)).to.equal(E(200));
    await time.increase(31 * DAY);
    await expect(daily.connect(alice).withdrawEarly(1)).to.be.revertedWithCustomError(daily, "CollateralLocked");
    // the role holder cannot touch more than pledged
    await expect(daily.connect(loan).seize(1, E(801), loan.address)).to.be.revertedWithCustomError(daily, "NotPledgee");
    await expect(daily.connect(bob).seize(1, E(1), bob.address)).to.be.revertedWithCustomError(daily, "NotPledgee");
    // seize part, release rest
    const before = await token.balanceOf(loan.address);
    await daily.connect(loan).seize(1, E(300), loan.address);
    expect(await token.balanceOf(loan.address)).to.equal(before + E(300));
    await daily.connect(loan).release(1, E(500));
    expect((await daily.getPosition(1)).locked).to.equal(0n);
    expect((await daily.getPosition(1)).principal).to.equal(E(700));
    expect(await daily.isSolvent()).to.equal(true);
    await daily.connect(alice).withdrawEarly(1);
  });
});

describe("RecurringDepositVault (J-Recurring)", () => {
  it("opens plan 1 (1,000 x 12) and pays the first instalment immediately", async () => {
    const { rd, alice } = await fixture();
    await rd.connect(alice).open(1);
    const pos = await rd.getPosition(1);
    expect(pos.principal).to.equal(E(1000));
    expect((await rd.accounts(1)).paidCount).to.equal(1);
  });

  it("enforces due dates, grace period and late penalty", async () => {
    const { rd, alice } = await fixture();
    await rd.connect(alice).open(1);
    await expect(rd.connect(alice).pay(1, 1)).to.be.revertedWithCustomError(rd, "InvalidInstallment"); // not due yet
    const opened = BigInt((await rd.getPosition(1)).openedAt);
    await time.increaseTo(opened + 30n * BigInt(DAY));
    await rd.connect(alice).pay(1, 1); // on time
    expect((await rd.accounts(1)).onTimeCount).to.equal(2);
    // instalment 2 paid after the 5-day grace window => 2% penalty goes to the reward pool
    await time.increaseTo(opened + 60n * BigInt(DAY) + 6n * BigInt(DAY));
    expect(await rd.missedCount(1)).to.equal(1n);
    const poolBefore = await rd.rewardPool();
    await rd.connect(alice).pay(1, 2);
    expect(await rd.rewardPool()).to.equal(poolBefore + E(20));
    expect((await rd.accounts(1)).onTimeCount).to.equal(2);
    await expect(rd.connect(alice).pay(1, 2)).to.be.revertedWithCustomError(rd, "AlreadyPaid");
  });

  it("pays reserved rewards + a loyalty bonus ONLY when every instalment was on time and the pool is funded", async () => {
    const { rd, alice, admin, token } = await fixture(true); // deck reward targets
    await rd.connect(admin).fundRewards(E(5000));
    await rd.connect(alice).open(1);
    const opened = BigInt((await rd.getPosition(1)).openedAt);
    for (let i = 1; i < 12; i++) {
      await time.increaseTo(opened + BigInt(i) * 30n * BigInt(DAY));
      await rd.connect(alice).pay(1, i);
    }
    await time.increaseTo(opened + 12n * 30n * BigInt(DAY));
    const before = await token.balanceOf(alice.address);
    await rd.connect(alice).claim(1);
    // 12,000 principal + 1,140 reserved (9.5%) + 120 loyalty (1% of principal)
    expect(await token.balanceOf(alice.address)).to.equal(before + E(12000 + 1140 + 120));
    expect(await rd.isSolvent()).to.equal(true);
  });

  it("pays no reward when the pool is empty (principal only)", async () => {
    const { rd, alice, token } = await fixture(true); // targets set, pool NOT funded
    await rd.connect(alice).open(1);
    const opened = BigInt((await rd.getPosition(1)).openedAt);
    await time.increaseTo(opened + 12n * 30n * BigInt(DAY));
    const before = await token.balanceOf(alice.address);
    await rd.connect(alice).claim(1); // only 1 instalment ever paid
    expect(await token.balanceOf(alice.address)).to.equal(before + E(1000));
  });

  it("one late instalment removes the loyalty bonus but keeps the funded reserved rewards", async () => {
    const { rd, alice, admin, token } = await fixture(true);
    await rd.connect(admin).fundRewards(E(5000));
    await rd.connect(alice).open(1);
    const opened = BigInt((await rd.getPosition(1)).openedAt);
    const M = 30n * BigInt(DAY);
    for (let i = 1; i < 12; i++) {
      // instalment 5 is paid 6 days late (grace is 5)
      await time.increaseTo(opened + BigInt(i) * M + (i === 5 ? 6n * BigInt(DAY) : 0n));
      await rd.connect(alice).pay(1, i);
    }
    await time.increaseTo(opened + 12n * M);
    const before = await token.balanceOf(alice.address);
    await rd.connect(alice).claim(1);
    // 12,000 principal + 1,140 reserved rewards, NO 120 loyalty bonus (late penalty of 20 went to the pool, not back to alice)
    expect(await token.balanceOf(alice.address)).to.equal(before + E(12000 + 1140));
  });

  it("early withdrawal after 90 days costs the configured penalty", async () => {
    const { rd, alice, token } = await fixture();
    await rd.connect(alice).open(1);
    await time.increase(89 * DAY);
    await expect(rd.connect(alice).withdrawEarly(1)).to.be.revertedWithCustomError(rd, "TooEarly");
    await time.increase(2 * DAY);
    const before = await token.balanceOf(alice.address);
    await rd.connect(alice).withdrawEarly(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(950)); // 5% penalty
  });

  it("disabled plans cannot be opened; only admin adds plans", async () => {
    const { rd, alice, admin } = await fixture();
    await rd.connect(admin).setPlanEnabled(1, false);
    await expect(rd.connect(alice).open(1)).to.be.revertedWithCustomError(rd, "PlanNotAvailable");
    await expect(rd.connect(alice).addPlan(E(10), 12, 0)).to.be.reverted;
  });
});

describe("FixedDepositVault (J-Treasury)", () => {
  it("rejects below minimum and unavailable terms", async () => {
    const { fd, alice } = await fixture();
    await expect(fd.connect(alice).open(1, E(10), false)).to.be.revertedWithCustomError(fd, "BelowMinimum");
    await expect(fd.connect(alice).open(9, E(5000), false)).to.be.revertedWithCustomError(fd, "TermNotAvailable");
  });

  it("locks principal, reserves funded reward, pays at maturity and mints a receipt NFT", async () => {
    const { fd, alice, admin, token, receipts } = await fixture(true);
    await fd.connect(admin).fundRewards(E(20000));
    await fd.connect(alice).open(1, E(25000), true); // 20% => 5,000 reward
    expect(await receipts.ownerOf(1)).to.equal(alice.address);
    expect((await fd.getPosition(1)).rewardReserved).to.equal(E(5000));
    await expect(fd.connect(alice).claim(1)).to.be.revertedWithCustomError(fd, "NotMatured");
    await time.increase(366 * DAY);
    const before = await token.balanceOf(alice.address);
    await fd.connect(alice).claim(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(30000)); // deck: 25,000 -> 30,000 (1yr, 20%)
    expect(await fd.isSolvent()).to.equal(true);
  });

  it("refuses to open when a funded reward is demanded but the pool is short — no synthetic funding", async () => {
    const { fd, alice } = await fixture(true);
    await expect(fd.connect(alice).open(1, E(25000), true)).to.be.revertedWithCustomError(fd, "RewardNotFunded");
    await fd.connect(alice).open(1, E(25000), false); // allowed, but the reward is flagged unfunded
    expect((await fd.getPosition(1)).rewardUnfunded).to.equal(E(5000));
    await time.increase(366 * DAY);
    const bal = await (await ethers.getContractAt("INRToken", await fd.token())).balanceOf(alice.address);
    await fd.connect(alice).claim(1);
    expect((await (await ethers.getContractAt("INRToken", await fd.token())).balanceOf(alice.address)) - bal).to.equal(E(25000));
  });

  it("early withdrawal: penalty, forfeited reward, can be disabled by config", async () => {
    const { fd, alice, admin, config, token } = await fixture(true);
    await fd.connect(admin).fundRewards(E(20000));
    await fd.connect(alice).open(1, E(10000), true);
    const before = await token.balanceOf(alice.address);
    await fd.connect(alice).withdrawEarly(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(9000)); // 10% penalty
    expect(await fd.rewardPool()).to.equal(E(20000 + 1000)); // reward returned + penalty replenishes pool
    await config.connect(admin).setUint(k("FD_EARLY_ALLOWED"), 0);
    await fd.connect(alice).open(1, E(10000), false);
    await expect(fd.connect(alice).withdrawEarly(2)).to.be.revertedWithCustomError(fd, "EarlyWithdrawalDisabled");
  });

  it("terms snapshot: later config changes do not alter existing deposits", async () => {
    const { fd, alice, admin, config, token } = await fixture();
    await fd.connect(alice).open(1, E(10000), false);
    await config.connect(admin).setUint(k("FD_EARLY_PENALTY_BPS"), 3000);
    const before = await token.balanceOf(alice.address);
    await fd.connect(alice).withdrawEarly(1);
    expect(await token.balanceOf(alice.address)).to.equal(before + E(9000)); // still 10%
  });
});

describe("Accounting invariants (randomised sequences)", () => {
  // Deterministic PRNG so failures are reproducible.
  function prng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

  for (const seed of [1, 7, 42]) {
    it(`vault balance always covers principal + reward liabilities (seed ${seed})`, async function () {
      this.timeout(300000);
      const { daily, rd, fd, alice, bob, carol, admin, config } = await fixture(true);
      const r = prng(seed);
      const users = [alice, bob, carol];
      await config.connect(admin).setUint(k("DAILY_REWARD_BPS"), 959);
      await daily.connect(admin).fundRewards(E(2000));
      await rd.connect(admin).fundRewards(E(2000));
      await fd.connect(admin).fundRewards(E(2000)); // deliberately small so some rewards are unfunded
      const tiers = [E(50), E(100), E(200), E(500)];

      let settled = 0;
      for (let step = 0; step < 120; step++) {
        const u = users[Math.floor(r() * 3)];
        const op = Math.floor(r() * 9);
        try {
          if (op === 0) await daily.connect(u).open(tiers[Math.floor(r() * 4)]);
          else if (op === 1) { const ids = await daily.idsOf(u.address); if (ids.length) await daily.connect(u).deposit(ids[Math.floor(r() * ids.length)], Math.floor(r() * 30)); }
          else if (op === 2) { const ids = await daily.idsOf(u.address); if (ids.length) await (r() < 0.5 ? daily.connect(u).withdrawEarly(ids[0]) : daily.connect(u).claim(ids[0])); }
          else if (op === 3) await rd.connect(u).open(1 + Math.floor(r() * 4));
          else if (op === 4) { const ids = await rd.idsOf(u.address); if (ids.length) await rd.connect(u).pay(ids[Math.floor(r() * ids.length)], Math.floor(r() * 12)); }
          else if (op === 5) { const ids = await rd.idsOf(u.address); if (ids.length) await (r() < 0.5 ? rd.connect(u).withdrawEarly(ids[0]) : rd.connect(u).claim(ids[0])); }
          else if (op === 6) await fd.connect(u).open(1 + Math.floor(r() * 3), E(1000 + Math.floor(r() * 50000)), false);
          else if (op === 7) { const ids = await fd.idsOf(u.address); if (ids.length) await (r() < 0.5 ? fd.connect(u).withdrawEarly(ids[0]) : fd.connect(u).claim(ids[0])); }
          else await time.increase(Math.floor(r() * 60 * DAY));
        } catch { /* reverts are expected; invariants must still hold */ }

        for (const v of [daily, rd, fd]) {
          expect(await v.isSolvent(), `insolvent at step ${step}, op ${op}`).to.equal(true);
        }
        // principal bookkeeping equals the sum over positions
        for (const v of [daily, rd, fd]) {
          let sum = 0n;
          const n = Number(await v.nextPositionId());
          for (let id = 1; id < n; id++) sum += (await v.getPosition(id)).principal;
          expect(sum).to.equal(await v.totalPrincipal());
        }
      }
      // prove the run did real work: positions were opened AND some were settled
      let opened = 0, closed = 0;
      for (const v of [daily, rd, fd]) {
        const n = Number(await v.nextPositionId());
        opened += n - 1;
        for (let id = 1; id < n; id++) if ((await v.getPosition(id)).status === 2n) closed++;
      }
      expect(opened).to.be.gte(15);
      expect(closed).to.be.gte(1);
    });
  }
});
