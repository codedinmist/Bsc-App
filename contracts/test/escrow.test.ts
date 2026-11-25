import { expect } from "chai";
import { ethers, network } from "hardhat";
import { fixture, E } from "./fixture";

const HOUR = 3600;
const MIN_STAKE = E(25_000);

async function setup() {
  const f = await fixture();
  const { admin, alice, bob, carol, ops, registry, token, forwarder } = f;
  const [, , , , , , , agent, resolver, gov, treasury] = await ethers.getSigners();
  const fwd = await forwarder.getAddress();

  const staking = await (await ethers.getContractFactory("AgentStaking")).deploy(
    admin.address, fwd, await token.getAddress(), MIN_STAKE, 7 * 24 * HOUR, treasury.address);
  const escrow = await (await ethers.getContractFactory("P2PEscrow")).deploy(
    admin.address, fwd, await token.getAddress(), await registry.getAddress(), await staking.getAddress(),
    2 * HOUR, 24 * HOUR, E(10), E(100_000), 1000);
  await staking.grantRole(await staking.RESERVER_ROLE(), await escrow.getAddress());
  await staking.grantRole(await staking.SLASHER_ROLE(), await escrow.getAddress());
  await escrow.grantRole(await escrow.RESOLVER_ROLE(), resolver.address);
  await escrow.grantRole(await escrow.GOVERNOR_ROLE(), gov.address);

  await registry.connect(agent).register();
  await registry.assignAgent(agent.address, 1, 1, 1);
  await registry.setAgentVerified(agent.address, true);
  await token.transfer(agent.address, E(500_000));
  await token.connect(agent).approve(await staking.getAddress(), ethers.MaxUint256);
  await token.connect(agent).approve(await escrow.getAddress(), ethers.MaxUint256);
  for (const u of [alice, bob, carol]) await token.connect(u).approve(await escrow.getAddress(), ethers.MaxUint256);
  await staking.connect(agent).stake(E(50_000));
  return { ...f, agent, resolver, gov, treasury, staking, escrow };
}

const CASH_IN = 0, CASH_OUT = 1;

describe("AgentStaking", () => {
  it("stakes, enforces unstake delay and never allows unstaking reserved stake", async () => {
    const { staking, agent, escrow, alice } = await setup();
    expect(await staking.isEligible(agent.address)).to.equal(true);
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(40_000), 2 * HOUR);
    await expect(staking.connect(agent).requestUnstake(E(10_001))).to.be.revertedWithCustomError(staking, "InsufficientFreeStake");
    await staking.connect(agent).requestUnstake(E(10_000));
    await expect(staking.connect(agent).withdraw()).to.be.revertedWithCustomError(staking, "NotUnlocked");
    await network.provider.send("evm_increaseTime", [7 * 24 * HOUR + 1]);
    await staking.connect(agent).withdraw();
    expect(await staking.isSolvent()).to.equal(true);
  });

  it("only the escrow role can reserve or slash", async () => {
    const { staking, agent, bob } = await setup();
    await expect(staking.connect(bob).reserve(agent.address, 1)).to.be.reverted;
    await expect(staking.connect(bob).slash(agent.address, 1, ethers.ZeroHash)).to.be.reverted;
  });

  it("rejects a reservation larger than free stake", async () => {
    const { staking, agent, escrow, alice } = await setup();
    await expect(escrow.connect(agent).createOrder(CASH_IN, alice.address, E(60_000), 2 * HOUR)).to.be.revertedWithCustomError(staking, "InsufficientFreeStake");
  });
});

describe("P2PEscrow", () => {
  it("cash-in: agent locks, then releases to the customer", async () => {
    const { escrow, agent, alice, token, staking } = await setup();
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(1000), HOUR);
    const before = await token.balanceOf(alice.address);
    await escrow.connect(agent).release(1);
    expect((await token.balanceOf(alice.address)) - before).to.equal(E(1000));
    expect((await staking.accounts(agent.address)).reserved).to.equal(0);
    expect(await escrow.isSolvent()).to.equal(true);
  });

  it("customer cannot release an order they do not lock; stranger cannot either", async () => {
    const { escrow, agent, alice, bob } = await setup();
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(1000), HOUR);
    await expect(escrow.connect(alice).release(1)).to.be.revertedWithCustomError(escrow, "NotParticipant");
    await expect(escrow.connect(bob).release(1)).to.be.revertedWithCustomError(escrow, "NotParticipant");
  });

  it("cash-out: customer locks, signature released by agent", async () => {
    const { escrow, agent, alice, token } = await setup();
    await escrow.connect(alice).createOrder(CASH_OUT, agent.address, E(2000), HOUR);
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
    const domain = { name: "JanSetuP2PEscrow", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await escrow.getAddress() };
    const types = { Release: [
      { name: "orderId", type: "uint256" }, { name: "locker", type: "address" }, { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" }, { name: "deadline", type: "uint256" } ] };
    const value = { orderId: 1, locker: alice.address, beneficiary: agent.address, amount: E(2000), deadline };
    const sig = await alice.signTypedData(domain, types, value);
    const before = await token.balanceOf(agent.address);
    await escrow.connect(agent).releaseWithSignature(1, deadline, sig);
    expect((await token.balanceOf(agent.address)) - before).to.equal(E(2000));
    // replay impossible
    await expect(escrow.connect(agent).releaseWithSignature(1, deadline, sig)).to.be.revertedWithCustomError(escrow, "BadStatus");
  });

  it("rejects a signature from the wrong signer, a tampered one and an expired one", async () => {
    const { escrow, agent, alice, bob } = await setup();
    await escrow.connect(alice).createOrder(CASH_OUT, agent.address, E(2000), HOUR);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const domain = { name: "JanSetuP2PEscrow", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await escrow.getAddress() };
    const types = { Release: [
      { name: "orderId", type: "uint256" }, { name: "locker", type: "address" }, { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" }, { name: "deadline", type: "uint256" } ] };
    const v = { orderId: 1, locker: alice.address, beneficiary: agent.address, amount: E(2000), deadline: now + 600 };
    const bad = await bob.signTypedData(domain, types, v);
    await expect(escrow.connect(agent).releaseWithSignature(1, now + 600, bad)).to.be.revertedWithCustomError(escrow, "BadSignature");
    const good = await alice.signTypedData(domain, types, v);
    await expect(escrow.connect(agent).releaseWithSignature(1, now + 601, good)).to.be.revertedWithCustomError(escrow, "BadSignature");
    const old = await alice.signTypedData(domain, types, { ...v, deadline: now - 1 });
    await expect(escrow.connect(agent).releaseWithSignature(1, now - 1, old)).to.be.revertedWithCustomError(escrow, "Expired");
  });

  it("refund only after the deadline and only by the locker", async () => {
    const { escrow, agent, alice } = await setup();
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(1000), HOUR);
    await expect(escrow.connect(agent).refund(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
    await network.provider.send("evm_increaseTime", [HOUR + 1]);
    await expect(escrow.connect(alice).refund(1)).to.be.revertedWithCustomError(escrow, "NotParticipant");
    await escrow.connect(agent).refund(1);
    await expect(escrow.connect(agent).refund(1)).to.be.revertedWithCustomError(escrow, "BadStatus");
  });

  it("window and amount limits, eligibility checks", async () => {
    const { escrow, agent, alice, bob } = await setup();
    await expect(escrow.connect(agent).createOrder(CASH_IN, alice.address, E(1000), 3 * HOUR)).to.be.revertedWithCustomError(escrow, "BadParam");
    await expect(escrow.connect(agent).createOrder(CASH_IN, alice.address, E(1), HOUR)).to.be.revertedWithCustomError(escrow, "AmountOutOfRange");
    await expect(escrow.connect(alice).createOrder(CASH_IN, bob.address, E(100), HOUR)).to.be.revertedWithCustomError(escrow, "NotEligible"); // alice is not an agent
  });

  describe("disputes", () => {
    async function disputed() {
      const s = await setup();
      await s.escrow.connect(s.agent).createOrder(CASH_IN, s.alice.address, E(10_000), 2 * HOUR);
      await s.escrow.connect(s.alice).openDispute(1, ethers.id("photo-of-handover"));
      return s;
    }

    it("a disputed order cannot be released or refunded by the locker", async () => {
      const { escrow, agent } = await disputed();
      await expect(escrow.connect(agent).release(1)).to.be.revertedWithCustomError(escrow, "BadStatus");
      await network.provider.send("evm_increaseTime", [3 * HOUR]);
      await expect(escrow.connect(agent).refund(1)).to.be.revertedWithCustomError(escrow, "BadStatus");
    });

    it("unappealed decision against the agent: funds to customer, stake slashed to treasury", async () => {
      const { escrow, resolver, alice, agent, token, staking, treasury } = await disputed();
      await escrow.connect(resolver).proposeResolution(1, true);
      await expect(escrow.finalise(1, true)).to.be.revertedWithCustomError(escrow, "AppealWindowOpen");
      await network.provider.send("evm_increaseTime", [24 * HOUR + 1]);
      const a0 = await token.balanceOf(alice.address), t0 = await token.balanceOf(treasury.address);
      await escrow.finalise(1, false); // the argument is ignored when no appeal
      expect((await token.balanceOf(alice.address)) - a0).to.equal(E(10_000));
      expect((await token.balanceOf(treasury.address)) - t0).to.equal(E(1000)); // 10%
      expect((await staking.accounts(agent.address)).staked).to.equal(E(49_000));
      expect(await staking.isSolvent()).to.equal(true);
      expect(await escrow.isSolvent()).to.equal(true);
    });

    it("only the losing side can appeal, and a governor then decides", async () => {
      const { escrow, resolver, gov, alice, agent, token } = await disputed();
      await escrow.connect(resolver).proposeResolution(1, true);
      await expect(escrow.connect(alice).appeal(1)).to.be.revertedWithCustomError(escrow, "NotLoser");
      await escrow.connect(agent).appeal(1);
      await expect(escrow.finalise(1, false)).to.be.reverted; // not a governor
      const a0 = await token.balanceOf(agent.address);
      await escrow.connect(gov).finalise(1, false);
      expect((await token.balanceOf(agent.address)) - a0).to.equal(E(10_000)); // back to agent, no slash
    });

    it("appeal after the window is rejected; participants cannot resolve their own dispute", async () => {
      const { escrow, resolver, agent, alice } = await disputed();
      await escrow.connect(resolver).proposeResolution(1, true);
      await network.provider.send("evm_increaseTime", [24 * HOUR + 1]);
      await expect(escrow.connect(agent).appeal(1)).to.be.revertedWithCustomError(escrow, "AppealWindowClosed");
      await expect(escrow.connect(alice).proposeResolution(1, true)).to.be.reverted;
    });

    it("resolver given a participant role cannot take part in its own order", async () => {
      const { escrow, agent, alice, resolver } = await setup();
      await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(100), HOUR);
      await escrow.connect(alice).openDispute(1, ethers.ZeroHash);
      await escrow.grantRole(await escrow.RESOLVER_ROLE(), alice.address);
      await expect(escrow.connect(alice).proposeResolution(1, true)).to.be.revertedWithCustomError(escrow, "NotParticipant");
      void resolver;
    });
  });

  it("pause blocks new orders but not release or refund", async () => {
    const { escrow, agent, alice, admin } = await setup();
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(500), HOUR);
    await escrow.connect(admin).pause();
    await expect(escrow.connect(agent).createOrder(CASH_IN, alice.address, E(500), HOUR)).to.be.reverted;
    await escrow.connect(agent).release(1);
  });

  it("random flows keep escrow and staking solvent", async () => {
    const { escrow, staking, agent, alice, bob, resolver, token } = await setup();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let created = 0, settled = 0;
    const open: number[] = [];
    for (let i = 0; i < 60; i++) {
      const r = rnd();
      if (r < 0.45) {
        const cust = rnd() < 0.5 ? alice : bob;
        const amt = E(10 + Math.floor(rnd() * 2000));
        if (rnd() < 0.5) await escrow.connect(agent).createOrder(CASH_IN, cust.address, amt, HOUR);
        else await escrow.connect(cust).createOrder(CASH_OUT, agent.address, amt, HOUR);
        open.push(++created);
      } else if (open.length) {
        const id = open.splice(Math.floor(rnd() * open.length), 1)[0];
        const o = await escrow.orders(id);
        const locker = o.locker === agent.address ? agent : o.locker === alice.address ? alice : bob;
        const benef = o.beneficiary === agent.address ? agent : o.beneficiary === alice.address ? alice : bob;
        if (rnd() < 0.5) { await escrow.connect(locker).release(id); }
        else { await escrow.connect(benef).openDispute(id, ethers.id(String(id))); await escrow.connect(resolver).proposeResolution(id, rnd() < 0.5); await network.provider.send("evm_increaseTime", [24 * HOUR + 1]); await escrow.finalise(id, false); }
        settled++;
      }
      expect(await escrow.isSolvent()).to.equal(true);
      expect(await staking.isSolvent()).to.equal(true);
    }
    expect(created).to.be.greaterThan(10);
    expect(settled).to.be.greaterThan(5);
    let sum = 0n;
    for (const id of open) sum += (await escrow.orders(id)).amount;
    expect(await escrow.totalEscrowed()).to.equal(sum);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(sum);
  });

  it("a slash that cuts stake below other open reservations never blocks those orders", async () => {
    const { escrow, staking, agent, alice, bob, resolver } = await setup();
    await staking.connect(agent).requestUnstake(E(10_000)); // stake 40k
    await escrow.connect(agent).createOrder(CASH_IN, alice.address, E(20_000), 2 * HOUR); // id 1
    await escrow.connect(agent).createOrder(CASH_IN, bob.address, E(20_000), 2 * HOUR);   // id 2
    await escrow.connect(alice).openDispute(1, ethers.ZeroHash);
    await escrow.connect(resolver).proposeResolution(1, true);
    await network.provider.send("evm_increaseTime", [24 * HOUR + 1]);
    await escrow.finalise(1, false); // slashes 2,000 -> stake 38k, reserved clamped to 20k or less
    await escrow.connect(agent).release(2); // must still settle
    expect(await escrow.isSolvent()).to.equal(true);
    expect(await staking.isSolvent()).to.equal(true);
  });
});
