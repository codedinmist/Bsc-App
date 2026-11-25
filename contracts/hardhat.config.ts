import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

// Offline fallback: set OFFLINE_SOLC=1 to compile with the npm `solc` package
// (used when binaries.soliditylang.org is unreachable). Normal machines do not need it.
if (process.env.OFFLINE_SOLC === "1") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
    if (args.solcVersion === "0.8.28") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const compilerPath = require.resolve("solc/soljson.js");
      return { compilerPath, isSolcJs: true, version: args.solcVersion, longVersion: "0.8.28+commit.7893614a" };
    }
    return runSuper();
  });
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: false },
  },
  networks: {
    hardhat: { chainId: Number(process.env.HARDHAT_CHAIN_ID ?? 31337) },
    localhost: { url: "http://127.0.0.1:8545", chainId: Number(process.env.HARDHAT_CHAIN_ID ?? 31337) },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: { apiKey: process.env.BSCSCAN_API_KEY || "" },
  gasReporter: { enabled: process.env.REPORT_GAS === "1", currency: "USD" },
};
export default config;
