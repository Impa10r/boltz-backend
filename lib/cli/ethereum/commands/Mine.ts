import type { Arguments } from 'yargs';
import { connectEthereum } from '../EthereumUtils';

export const command = 'mine <blocks>';

export const describe =
  'mines the specified number of blocks on the Ganache chain';

export const builder = {
  blocks: {
    describe: 'number of blocks to mine',
    type: 'number',
  },
};

export const handler = async (argv: Arguments<any>): Promise<void> => {
  const signer = await connectEthereum(argv.provider);
  const signerAddress = await signer.getAddress();

  const nonce = await signer.getNonce();

  // Since Anvil mines a block whenever a transaction is sent, we are just going to send transactions
  // and wait for a confirmation until the specified number of blocks is mined
  for (let i = 0; i < argv.blocks; i += 1) {
    await signer.sendTransaction({
      to: signerAddress,
      nonce: nonce + i,
    });
  }

  console.log(`Mined ${argv.blocks} blocks`);
};
