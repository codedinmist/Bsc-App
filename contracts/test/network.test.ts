import { expect } from "chai";
import { ethers, network } from "hardhat";
import { fixture, E, DAY } from "./fixture";

const MAX = ethers.MaxUint256;

/** Funded world. `strict` turns on the deck's KYC rule and the agent-eligibility gate. */
async function world(strict = false) {
  const f = await fixture(true, strict ? { requireKyc: true, enforceAgentRules: true } : {});
  const signers = await ethers.getSigners();
  const [agent, agentB, head, other] = [signers[7], signers[8], signers[9], signers[10]];
  const { admin, token, registry, comm: _c } = { ...f, comm: f.commissions };
  const comm = f.commissions;
  for (const a of [agent, agentB]) {
    await registry.connect(a).register();
    await registry.assignAgent(a.address, 1, 1, 1);
    await token.transfer(a.address, E(200_000));
    for (const t of [f.staking, f.escrow, f.fd, f.daily, f.rd]) await token.connect(a).approve(await t.getAddress(), MAX);
  }
  for (const c of [comm, f.service, f.pool]) await token.approve(await c.getAddress(), MAX);
  await comm.fund(E(500_000)); await f.service.fund(E(100_000)); await f.pool.deposit(E(500_000));
  for (const u of [f.alice, f.bob, f.carol]) { await token.connect(u).approve(await f.escrow.getAddress(), MAX); await token.connect(u).approve(await f.micro.getAddress(), MAX); }
  return { ...f, comm, agent, agentB, head, other };
}

/** Gives an agent everything the deck asks for, then verifies. */
async function qualify(w: any, a: any, referred: any[]) {
  await w.registry.setKyc(a.address, true);
  await w.staking.connect(a).stake(E(25_000));
  await w.registry.setKyc(referred[0].address, true);
  await w.fd.connect(a).open(1, E(5_000), false);
  for (const r of referred) { await w.registry.setKyc(r.address, true); await w.comm.connect(r).setReferrer(a.address); }
  await w.registry.setAgentVerified(a.address, true);
}

describe("Agent eligibility (deck slide 7)", () => {
  it("needs KYC, 25,000 stake, 5,000 own savings and 2 KYC'd referrals before verification", async () => {
    const w = await world(true); const { registry, agent, alice, bob, staking, fd, comm, ranks } = w;
    const bad = () => expect(registry.setAgentVerified(agent.address, true)).to.be.revertedWithCustomError(registry, "AgentNotEligible");
    await bad();
    await registry.setKyc(agent.address, true); await bad();                    // KYC only
    await staking.connect(agent).stake(E(25_000)); await bad();                 // + stake
    await fd.connect(agent).open(1, E(5_000), false); await bad();              // + own investment (no referrals yet)
    await registry.setKyc(alice.address, true); await registry.setKyc(bob.address, true);
    await comm.connect(alice).setReferrer(agent.address); await bad();          // only 1 referral
    await comm.connect(bob).setReferrer(agent.address);
    expect(await ranks.kycReferrals(agent.address)).to.equal(2n);
    expect(await ranks.ownInvestment(agent.address)).to.equal(E(5_000));
    await registry.setAgentVerified(agent.address, true);
    expect(await registry.isActiveAgent(agent.address)).to.equal(true);
  });

  it("a referral that is not KYC'd does not count, and under-staked or under-invested agents fail", async () => {
    const w = await world(true); const { registry, agent, alice, bob, carol, staking, fd, comm, ranks } = w;
    await registry.setKyc(agent.address, true);
    await staking.connect(agent).stake(E(24_999));
    await fd.connect(agent).open(1, E(4_999), false);
    await registry.setKyc(alice.address, true); await registry.setKyc(bob.address, true);
    await comm.connect(alice).setReferrer(agent.address); await comm.connect(bob).setReferrer(agent.address);
    await comm.connect(carol).setReferrer(agent.address);                        // carol has no KYC
    expect(await ranks.kycReferrals(agent.address)).to.equal(2n);
    await expect(registry.setAgentVerified(agent.address, true)).to.be.revertedWithCustomError(registry, "AgentNotEligible");
    await staking.connect(agent).stake(E(1));
    await expect(registry.setAgentVerified(agent.address, true)).to.be.revertedWithCustomError(registry, "AgentNotEligible"); // 4,999 < 5,000
    await fd.connect(agent).open(1, E(1_000), false);
    await registry.setAgentVerified(agent.address, true);
  });

  it("customers can pick an agent who is not verified yet, but nobody is paid until verification", async () => {
    const w = await world(true); const { registry, agent, alice, comm, fd } = w;
    await registry.setKyc(alice.address, true);
    await comm.connect(alice).setReferrer(agent.address);                         // allowed: agent is only a candidate
    await fd.connect(alice).open(1, E(10_000), false);
    await expect(comm.sync(await fd.getAddress(), 1)).to.be.revertedWithCustomError(comm, "NotAgent");
    await expect(comm.connect(w.bob).setReferrer(w.carol.address)).to.be.revertedWithCustomError(comm, "NotAgent"); // a plain customer is not an agent
  });
});

describe("KYC gate (deck slide 7)", () => {
  it("deposits and both loan types need a KYC-verified customer when the rule is on", async () => {
    const w = await world(true); const { registry, alice, bob, daily, fd, micro, coll } = w;
    await expect(daily.connect(alice).open(E(100))).to.be.revertedWithCustomError(daily, "KycRequired");
    await expect(fd.connect(alice).open(1, E(1_000), false)).to.be.revertedWithCustomError(fd, "KycRequired");
    await registry.setKyc(alice.address, true);
    await fd.connect(alice).open(1, E(10_000), false);
    await expect(micro.connect(bob).borrow(0, 1)).to.be.revertedWithCustomError(micro, "KycRequired");
    await registry.setKyc(alice.address, false);                                  // revoked later: loans stop too
    await expect(coll.connect(alice).borrow(await fd.getAddress(), 1, E(1_000), E(500), 30)).to.be.revertedWithCustomError(coll, "KycRequired");
  });

  it("is off by default so plain deployments keep working", async () => {
    const f = await fixture();
    expect(await f.micro.requireKyc()).to.equal(false);
    expect(await f.coll.kycRegistry()).to.equal(ethers.ZeroAddress);
    await f.fd.connect(f.alice).open(1, E(1_000), false);
  });
});

describe("RD +20% new-account commission (deck slide 8)", () => {
  async function ready() {
    const w = await world(false);
    await w.registry.setAgentVerified(w.agent.address, true);
    return w;
  }
  const rdAddr = (w: any) => w.rd.getAddress();

  it("3-5 year RD inside 90 days: agent share 13% becomes 15.6%", async () => {
    const w = await ready(); const { rd, comm, alice, agent } = w;
    await comm.connect(alice).setReferrer(agent.address);
    await rd.connect(alice).open(2);                                              // plan 2 = 2,000 x 36 months
    const before = await comm.pool();
    await comm.sync(await rdAddr(w), 1);
    expect(await comm.isBoosted(await rdAddr(w), 1)).to.equal(true);
    // slots: 15.6% + 3% + 2% + 1.25% + 0.75% = 22.6% of 2,000
    expect(before - (await comm.pool())).to.equal(E(452));
    await network.provider.send("evm_increaseTime", [37 * 30 * DAY]); await network.provider.send("evm_mine");
    expect(await comm.claimable(await rdAddr(w), 1, 0)).to.equal(E(312));          // 2,000 x 15.6%
    expect(await comm.claimable(await rdAddr(w), 1, 1)).to.equal(E(60));           // others are not boosted
    expect(await comm.isSolvent()).to.equal(true);
  });

  it("no boost for a 1-year RD, or when the plan is opened after day 90", async () => {
    const w = await ready(); const { rd, comm, alice, bob, agent } = w;
    await comm.connect(alice).setReferrer(agent.address); await comm.connect(bob).setReferrer(agent.address);
    await rd.connect(alice).open(1);                                              // 12 months
    await comm.sync(await rdAddr(w), 1);
    expect(await comm.isBoosted(await rdAddr(w), 1)).to.equal(false);
    await network.provider.send("evm_increaseTime", [91 * DAY]); await network.provider.send("evm_mine");
    await rd.connect(bob).open(2);                                                // 36 months, but bob joined > 90 days ago
    await comm.sync(await rdAddr(w), 2);
    expect(await comm.isBoosted(await rdAddr(w), 2)).to.equal(false);
    await network.provider.send("evm_increaseTime", [13 * 30 * DAY]); await network.provider.send("evm_mine");
    expect(await comm.claimable(await rdAddr(w), 2, 0)).to.be.lt(E(260) + 1n);      // 2,000 x 13% = 260
  });

  it("the boost can be tuned or switched off by the admin only, within bounds", async () => {
    const w = await ready(); const { comm, alice, bob, rd, agent } = w;
    await expect(comm.connect(alice).setBoost(0, 0, 0, 0)).to.be.reverted;
    await expect(comm.setBoost(6000, 90 * DAY, 36, 60)).to.be.revertedWith("bounds");
    await comm.setBoost(0, 90 * DAY, 36, 60);
    await comm.connect(alice).setReferrer(agent.address);
    await rd.connect(alice).open(2);
    await comm.sync(await rdAddr(w), 1);
    expect(await comm.isBoosted(await rdAddr(w), 1)).to.equal(false);
  });
});

describe("ServiceCommission: P2P, recovery, cluster, state (deck slide 8)", () => {
  async function ready() {
    const w = await world(false);
    await w.registry.setAgentVerified(w.agent.address, true);
    await w.staking.connect(w.agent).stake(E(50_000));
    return w;
  }
  async function cashOut(w: any, amount = E(1_000)) {
    await w.escrow.connect(w.alice).createOrder(1, w.agent.address, amount, 3600);   // customer locks, agent hands cash
    const id = await w.escrow.nextOrderId() - 1n;
    await w.escrow.connect(w.alice).release(id);
    return id;
  }

  it("pays the agent 1.5% and the state 1% of a completed P2P order, once", async () => {
    const w = await ready(); const { service, agent, token, treasury } = w;
    const id = await cashOut(w);
    const dao = await treasury.getAddress();
    const a0 = await token.balanceOf(agent.address), d0 = await token.balanceOf(dao);
    await service.syncP2P(id);
    expect((await token.balanceOf(agent.address)) - a0).to.equal(E(15));
    expect((await token.balanceOf(dao)) - d0).to.equal(E(10));                      // no state head yet -> DAO
    await expect(service.syncP2P(id)).to.be.revertedWithCustomError(service, "NothingToPay");
    expect(await service.isSolvent()).to.equal(true);
  });

  it("an order that is still open, refunded or unfunded pays nothing and can be retried", async () => {
    const w = await ready(); const { service, escrow, alice, agent } = w;
    await escrow.connect(alice).createOrder(1, agent.address, E(1_000), 3600);
    await expect(service.syncP2P(1)).to.be.revertedWithCustomError(service, "NotCompleted");
    await escrow.connect(alice).release(1);
    // drain the pool, then fund again
    const dry = await (await ethers.getContractFactory("ServiceCommission")).deploy(w.admin.address, await w.token.getAddress(), await w.registry.getAddress(), await w.commissions.getAddress(), await escrow.getAddress(), await w.micro.getAddress(), await w.treasury.getAddress());
    await expect(dry.syncP2P(1)).to.be.revertedWithCustomError(dry, "PoolShort");
    await w.token.approve(await dry.getAddress(), MAX); await dry.fund(E(100));
    await dry.syncP2P(1);                                                          // retry works after funding
  });

  it("cash-in orders pay the agent too (the agent is the locker)", async () => {
    const w = await ready(); const { escrow, agent, alice, service, token } = w;
    await escrow.connect(agent).createOrder(0, alice.address, E(2_000), 3600);
    await escrow.connect(agent).release(1);
    const a0 = await token.balanceOf(agent.address);
    await service.syncP2P(1);
    expect((await token.balanceOf(agent.address)) - a0).to.equal(E(30));
  });

  async function loan(w: any) {
    const { daily, micro, agent, alice } = w;
    await daily.connect(alice).open(E(100));
    const pid = (await daily.idsOf(alice.address)).at(-1);
    for (let i = 0; i < 15; i++) { await daily.connect(alice).deposit(pid, i); await network.provider.send("evm_increaseTime", [DAY]); await network.provider.send("evm_mine"); }
    await micro.connect(agent).verifyApplicant(alice.address);
    await micro.connect(alice).borrow(0, pid);
  }

  it("loan opening pays the cluster head 0.75% and the state head 1%; repayments pay the agent 2.5%", async () => {
    const w = await ready(); const { service, commissions, head, other, agent, token, micro, alice } = w;
    await commissions.setHead(1, 1, head.address); await commissions.setHead(3, 1, other.address);
    await loan(w);
    const h0 = await token.balanceOf(head.address), o0 = await token.balanceOf(other.address), a0 = await token.balanceOf(agent.address);
    await service.syncLoan(1);
    expect((await token.balanceOf(head.address)) - h0).to.equal(E(75));              // 0.75% of 10,000
    expect((await token.balanceOf(other.address)) - o0).to.equal(E(100));            // 1% of 10,000
    expect((await token.balanceOf(agent.address)) - a0).to.equal(0n);               // nothing repaid yet
    await expect(service.syncLoan(1)).to.be.revertedWithCustomError(service, "NothingToPay");
    await micro.connect(alice).repay(1, 10);                                         // 1,000 repaid
    await service.syncLoan(1);
    expect((await token.balanceOf(agent.address)) - a0).to.equal(E(25));             // 2.5% of 1,000
    expect((await token.balanceOf(head.address)) - h0).to.equal(E(75));              // opening fee is not paid twice
    await micro.connect(alice).repay(1, 10);
    await service.syncLoan(1);
    expect((await token.balanceOf(agent.address)) - a0).to.equal(E(50));
    expect(await service.isSolvent()).to.equal(true);
  });

  it("only the owner of the numbers can change rates, and only within bounds", async () => {
    const w = await ready(); const { service, alice } = w;
    await expect(service.connect(alice).setRates(1, 1, 1, 1, 1)).to.be.reverted;
    await expect(service.setRates(600, 250, 75, 100, 4000)).to.be.revertedWith("bounds");
    await service.setRates(100, 200, 50, 50, 5000);
    expect(await service.p2pAgentBps()).to.equal(100n);
  });
});

describe("Prediction-market fees reach the district (deck slide 8)", () => {
  it("with no volume everything goes to the DAO; with volume, districts get their share by volume", async () => {
    const w = await world(false);
    const { service, ranks, comm, registry, token, predictionMarket, treasury, agent, alice, fd, head } = w;
    await registry.setAgentVerified(agent.address, true);
    await token.approve(await predictionMarket.getAddress(), MAX);
    const dao = await treasury.getAddress();

    await predictionMarket.simulateTrade(E(100_000));                                // fee 2,000, all goes to the sink (no LPs)
    const d0 = await token.balanceOf(dao);
    await service.sweepPrediction();
    expect((await token.balanceOf(dao)) - d0).to.equal(E(2_000));                    // no district volume yet
    await expect(service.sweepPrediction()).to.be.revertedWithCustomError(service, "NothingToPay");

    await comm.connect(alice).setReferrer(agent.address);
    await fd.connect(alice).open(1, E(20_000), false);
    await comm.sync(await fd.getAddress(), 1);
    await ranks.syncAgent(agent.address);
    expect(await ranks.districtVolume(1)).to.equal(E(20_000));

    await comm.setHead(2, 1, head.address);
    await predictionMarket.simulateTrade(E(100_000));
    const d1 = await token.balanceOf(dao);
    await service.sweepPrediction();
    expect((await token.balanceOf(dao)) - d1).to.equal(E(1_200));                    // 60% treasury
    expect(await service.districtPending(1)).to.be.closeTo(E(800), E("0.000001"));   // 40% districts
    const h0 = await token.balanceOf(head.address);
    await service.payDistrict(1);
    expect((await token.balanceOf(head.address)) - h0).to.be.closeTo(E(800), E("0.000001"));
    expect(await service.isSolvent()).to.equal(true);
    await expect(service.payDistrict(1)).to.be.revertedWithCustomError(service, "NothingToPay");
  });
});

describe("Automatic promotion by volume (deck slide 7)", () => {
  async function ready() {
    const w = await world(false);
    for (const a of [w.agent, w.agentB]) await w.registry.setAgentVerified(a.address, true);
    // small numbers so the test is short; the rule is the same
    await w.ranks.setThresholds(E(5_000), 2, 2, E(2_000), 1, E(3_000), 1, E(4_000));
    await w.comm.connect(w.alice).setReferrer(w.agent.address); await w.comm.connect(w.bob).setReferrer(w.agentB.address);
    await w.fd.connect(w.alice).open(1, E(3_000), false); await w.fd.connect(w.bob).open(1, E(2_000), false);
    await w.comm.sync(await w.fd.getAddress(), 1); await w.comm.sync(await w.fd.getAddress(), 2);
    return w;
  }

  it("is refused until the numbers are met, then the top agent becomes head at every level", async () => {
    const w = await ready(); const { ranks, comm, agent, agentB } = w;
    await expect(ranks.promoteCluster(1)).to.be.revertedWithCustomError(ranks, "NotReady");   // nobody tracked yet
    await ranks.syncAgent(agent.address);
    await expect(ranks.promoteCluster(1)).to.be.revertedWithCustomError(ranks, "NotReady");   // 1 agent < 2
    await ranks.syncAgent(agentB.address);
    expect(await ranks.clusterAgents(1)).to.equal(2n);
    expect(await ranks.clusterVolume(1)).to.equal(E(5_000));
    await expect(ranks.promoteDistrict(1)).to.be.revertedWithCustomError(ranks, "NotReady");  // no headed cluster yet
    await ranks.promoteCluster(1);
    expect(await comm.clusterHead(1)).to.equal(agent.address);                                // 3,000 > 2,000
    expect(await ranks.rankOf(agent.address)).to.equal(2n);
    await expect(ranks.promoteCluster(1)).to.be.revertedWithCustomError(ranks, "AlreadyHeaded");
    await ranks.promoteDistrict(1);
    await ranks.promoteState(1);
    expect(await comm.districtHead(1)).to.equal(agent.address);
    expect(await comm.stateHead(1)).to.equal(agent.address);
    expect(await ranks.rankOf(agent.address)).to.equal(4n);                                   // State
    expect(await ranks.rankOf(agentB.address)).to.equal(1n);
    await expect(ranks.promoteCluster(2)).to.be.revertedWithCustomError(ranks, "NotReady");
  });

  it("new commission schedules pay the promoted head; governance can take the seat back", async () => {
    const w = await ready(); const { ranks, comm, agent, agentB, carol, fd } = w;
    await ranks.syncAgent(agent.address); await ranks.syncAgent(agentB.address); await ranks.promoteCluster(1);
    await comm.connect(carol).setReferrer(agentB.address);
    await fd.connect(carol).open(1, E(10_000), false);
    await comm.sync(await fd.getAddress(), 3);
    const [payee] = await comm.scheduleOf(await fd.getAddress(), 3);
    expect(payee[1]).to.equal(agent.address);                                                // cluster slot = the new head
    await expect(ranks.connect(carol).revokeHead(1, 1)).to.be.reverted;
    await ranks.revokeHead(1, 1);
    expect(await comm.clusterHead(1)).to.equal(ethers.ZeroAddress);
    expect(await ranks.rankOf(agent.address)).to.equal(1n);
    await ranks.promoteCluster(1);                                                           // can be promoted again
  });

  it("only agents can be tracked, and only the ranks contract (or governor) can set heads", async () => {
    const w = await ready(); const { ranks, comm, alice, other } = w;
    await expect(ranks.syncAgent(alice.address)).to.be.revertedWithCustomError(ranks, "NotActiveAgent");
    await expect(comm.connect(other).setHead(1, 1, other.address)).to.be.reverted;
    await expect(comm.setHead(9, 1, other.address)).to.be.revertedWith("level");
  });
});
