import { expect } from "chai";
import { ethers } from "hardhat";

const DAY = 24 * 3600;

async function setup() {
  const s = await ethers.getSigners();
  const [a, b, c, d, e, outsider, newOwner] = s;
  const ms = await (await ethers.getContractFactory("JanSetuMultiSig")).deploy([a, b, c, d, e].map((x) => x.address), 3);
  const timelock = await (await ethers.getContractFactory("JanSetuTimelock")).deploy(2 * DAY, [await ms.getAddress()], [await ms.getAddress()]);
  const token = await (await ethers.getContractFactory("INRToken")).deploy(a.address, a.address, ethers.parseEther("1000000"), ethers.parseEther("2000000"), ethers.ZeroAddress);
  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(await timelock.getAddress(), await token.getAddress(), ethers.parseEther("100000"));
  return { a, b, c, d, e, outsider, newOwner, ms, timelock, token, treasury };
}

describe("JanSetuMultiSig 3-of-5", () => {
  it("needs 3 of 5 owners before anything runs", async () => {
    const { a, b, c, ms, token } = await setup();
    const data = token.interface.encodeFunctionData("transfer", [a.address, 1n]);
    await ms.connect(a).submit(await token.getAddress(), 0, data);
    await expect(ms.connect(a).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations");
    await ms.connect(b).confirm(0);
    await expect(ms.connect(b).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations");
    await ms.connect(c).confirm(0);
    expect(await ms.validConfirmations(0)).to.equal(3n);
  });

  it("outsiders cannot propose, approve or execute", async () => {
    const { a, outsider, ms } = await setup();
    await expect(ms.connect(outsider).submit(outsider.address, 0, "0x")).to.be.revertedWithCustomError(ms, "NotOwner");
    await ms.connect(a).submit(outsider.address, 0, "0x");
    await expect(ms.connect(outsider).confirm(0)).to.be.revertedWithCustomError(ms, "NotOwner");
    await expect(ms.connect(outsider).execute(0)).to.be.revertedWithCustomError(ms, "NotOwner");
  });

  it("one owner cannot approve twice, and can take an approval back", async () => {
    const { a, b, ms } = await setup();
    await ms.connect(a).submit(a.address, 0, "0x");
    await expect(ms.connect(a).confirm(0)).to.be.revertedWithCustomError(ms, "AlreadyConfirmed");
    await ms.connect(b).confirm(0);
    await ms.connect(b).revoke(0);
    expect(await ms.validConfirmations(0)).to.equal(1n);
    await expect(ms.connect(b).revoke(0)).to.be.revertedWithCustomError(ms, "NotConfirmed");
  });

  it("cannot run twice", async () => {
    const { a, b, c, ms } = await setup();
    await a.sendTransaction({ to: await ms.getAddress(), value: 10n });
    await ms.connect(a).submit(a.address, 5n, "0x");
    await ms.connect(b).confirm(0); await ms.connect(c).confirm(0);
    await ms.connect(a).execute(0);
    await expect(ms.connect(a).execute(0)).to.be.revertedWithCustomError(ms, "AlreadyExecuted");
    await expect(ms.connect(b).revoke(0)).to.be.revertedWithCustomError(ms, "AlreadyExecuted");
  });

  it("treasury spend needs 3 signatures AND the 48 hour timelock", async () => {
    const { a, b, c, d, ms, timelock, token, treasury, outsider } = await setup();
    await token.transfer(await treasury.getAddress(), ethers.parseEther("50000"));
    const spend = treasury.interface.encodeFunctionData("spend", [outsider.address, ethers.parseEther("1000"), ethers.id("grant")]);
    const salt = ethers.id("s1");
    const sched = timelock.interface.encodeFunctionData("schedule", [await treasury.getAddress(), 0, spend, ethers.ZeroHash, salt, 2 * DAY]);
    await ms.connect(a).submit(await timelock.getAddress(), 0, sched);
    await ms.connect(b).confirm(0);
    await expect(ms.connect(a).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations"); // only 2 so far
    await ms.connect(c).confirm(0);
    await ms.connect(a).execute(0); // scheduled, not yet spent

    const exec = timelock.interface.encodeFunctionData("execute", [await treasury.getAddress(), 0, spend, ethers.ZeroHash, salt]);
    await ms.connect(d).submit(await timelock.getAddress(), 0, exec);
    await ms.connect(a).confirm(1); await ms.connect(b).confirm(1);
    await expect(ms.connect(a).execute(1)).to.be.reverted; // timelock: still waiting
    expect(await token.balanceOf(outsider.address)).to.equal(0n);

    await ethers.provider.send("evm_increaseTime", [2 * DAY + 5]); await ethers.provider.send("evm_mine", []);
    await ms.connect(a).execute(1);
    expect(await token.balanceOf(outsider.address)).to.equal(ethers.parseEther("1000"));
  });

  it("owner set can only change through an approved proposal, and stays valid", async () => {
    const { a, b, c, d, e, newOwner, ms } = await setup();
    await expect(ms.connect(a).addOwner(newOwner.address)).to.be.revertedWithCustomError(ms, "NotSelf");
    const data = ms.interface.encodeFunctionData("replaceOwner", [e.address, newOwner.address]);
    await ms.connect(a).submit(await ms.getAddress(), 0, data);
    await ms.connect(b).confirm(0); await ms.connect(c).confirm(0);
    await ms.connect(a).execute(0);
    expect(await ms.isOwner(e.address)).to.equal(false);
    expect(await ms.isOwner(newOwner.address)).to.equal(true);
    expect((await ms.owners()).length).to.equal(5);
    await expect(ms.connect(e).submit(a.address, 0, "0x")).to.be.revertedWithCustomError(ms, "NotOwner");
  });

  it("a removed owner's earlier approval stops counting", async () => {
    const { a, b, c, d, e, ms, token } = await setup();
    const call = token.interface.encodeFunctionData("transfer", [a.address, 1n]);
    await ms.connect(e).submit(await token.getAddress(), 0, call); // id 0, approved by e
    await ms.connect(d).confirm(0);                                  // 2 approvals: e and d
    const rep = ms.interface.encodeFunctionData("removeOwner", [e.address]);
    await ms.connect(a).submit(await ms.getAddress(), 0, rep);       // id 1
    await ms.connect(b).confirm(1); await ms.connect(c).confirm(1);
    await ms.connect(a).execute(1);
    await ms.connect(c).confirm(0);                                  // would be 3 raw approvals (e, d, c)
    expect(await ms.validConfirmations(0)).to.equal(2n);             // e no longer counts
    await expect(ms.connect(a).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations");
  });

  it("threshold and owner count stay within safe bounds", async () => {
    const { a, b, c, ms } = await setup();
    const run = async (data: string) => { const id = await ms.txCount(); await ms.connect(a).submit(await ms.getAddress(), 0, data); await ms.connect(b).confirm(id); await ms.connect(c).confirm(id); return ms.connect(a).execute(id); };
    await expect(run(ms.interface.encodeFunctionData("changeThreshold", [1]))).to.be.revertedWithCustomError(ms, "CallFailed");
    await expect(run(ms.interface.encodeFunctionData("changeThreshold", [6]))).to.be.revertedWithCustomError(ms, "CallFailed");
    await run(ms.interface.encodeFunctionData("changeThreshold", [4]));
    expect(await ms.threshold()).to.equal(4n);
    await expect(ms.connect(a).submit(a.address, 0, "0x").then(async () => { /* fine */ })).to.not.be.reverted;
  });

  it("rejects a bad constructor (too few owners, duplicate, threshold 1)", async () => {
    const [a, b, c] = await ethers.getSigners();
    const F = await ethers.getContractFactory("JanSetuMultiSig");
    await expect(F.deploy([a.address, b.address], 2)).to.be.revertedWithCustomError(F, "BadOwners");
    await expect(F.deploy([a.address, a.address, b.address], 2)).to.be.revertedWithCustomError(F, "BadOwners");
    await expect(F.deploy([a.address, b.address, c.address], 1)).to.be.revertedWithCustomError(F, "BadThreshold");
  });
});
