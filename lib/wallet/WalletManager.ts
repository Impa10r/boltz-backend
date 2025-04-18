import type { BIP32Interface } from 'bip32';
import BIP32Factory from 'bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from 'bip39';
import type { Network } from 'bitcoinjs-lib';
import type { Provider } from 'ethers';
import fs from 'fs';
import type { IElementsClient } from 'lib/chain/ElementsClient';
import type { Network as LiquidNetwork } from 'liquidjs-lib/src/networks';
import type { Slip77Interface } from 'slip77';
import { SLIP77Factory } from 'slip77';
import * as ecc from 'tiny-secp256k1';
import type { CurrencyConfig } from '../Config';
import type Logger from '../Logger';
import { splitDerivationPath } from '../Utils';
import type { IChainClient } from '../chain/ChainClient';
import { CurrencyType } from '../consts/Enums';
import type { KeyProviderType } from '../db/models/KeyProvider';
import KeyRepository from '../db/repositories/KeyRepository';
import type LndClient from '../lightning/LndClient';
import type ClnClient from '../lightning/cln/ClnClient';
import Errors from './Errors';
import Wallet from './Wallet';
import WalletLiquid from './WalletLiquid';
import type EthereumManager from './ethereum/EthereumManager';
import CoreWalletProvider from './providers/CoreWalletProvider';
import ElementsWalletProvider from './providers/ElementsWalletProvider';
import LndWalletProvider from './providers/LndWalletProvider';
import type WalletProviderInterface from './providers/WalletProviderInterface';

type CurrencyLimits = {
  minWalletBalance: number;

  minLocalBalance?: number;
  minRemoteBalance?: number;

  maxZeroConfAmount?: number;
};

type Currency = {
  symbol: string;
  type: CurrencyType;
  limits: CurrencyLimits;

  // Needed for UTXO based coins
  network?: Network;
  lndClient?: LndClient;
  clnClient?: ClnClient;
  chainClient?: IChainClient;

  // Needed for Ether and tokens on Ethereum
  provider?: Provider;
};

const bip32 = BIP32Factory(ecc);
const slip77 = SLIP77Factory(ecc);

/**
 * WalletManager creates wallets instances that generate keys derived from the seed and
 * interact with the wallet of LND to send and receive onchain coins
 */
class WalletManager {
  public wallets = new Map<string, Wallet>();

  private readonly mnemonic: string;
  private readonly mnemonicEvm: string;

  private readonly slip77: Slip77Interface;
  private readonly masterNode: BIP32Interface;

  private readonly derivationPath = 'm/0';

  constructor(
    private logger: Logger,
    mnemonicPath: string,
    mnemonicPathEvm: string,
    private currencies: Currency[],
    public ethereumManagers: EthereumManager[],
  ) {
    this.logger.debug(`Loading mnemonic from: ${mnemonicPath}`);
    this.mnemonic = this.loadMnemonic(mnemonicPath);

    this.logger.debug(`Loading EVM mnemonic from: ${mnemonicPathEvm}`);
    this.mnemonicEvm = this.loadMnemonic(mnemonicPathEvm);

    const derived = WalletManager.deriveFromMnemonic(this.mnemonic);
    this.slip77 = derived.slip77;
    this.masterNode = derived.masterNode;
  }

  public init = async (configCurrencies: CurrencyConfig[]): Promise<void> => {
    const keyProviderMap = await this.getKeyProviderMap();

    for (const currency of this.currencies) {
      if (
        currency.type !== CurrencyType.BitcoinLike &&
        currency.type !== CurrencyType.Liquid
      ) {
        continue;
      }

      let walletProvider: WalletProviderInterface | undefined = undefined;

      // The LND client is also used as onchain wallet for UTXO based chains if available
      if (
        configCurrencies.find((config) => config.symbol === currency.symbol)
          ?.preferredWallet !== 'core' &&
        currency.lndClient
      ) {
        walletProvider = new LndWalletProvider(
          this.logger,
          currency.lndClient,
          currency.chainClient!,
        );
      } else {
        // Else the Bitcoin Core wallet is used
        if (currency.type === CurrencyType.BitcoinLike) {
          walletProvider = new CoreWalletProvider(
            this.logger,
            currency.chainClient!,
          );
        } else {
          walletProvider = new ElementsWalletProvider(
            this.logger,
            currency.chainClient! as IElementsClient,
          );
        }

        // Sanity check that wallet support is compiled in
        try {
          await walletProvider.getBalance();
        } catch (error) {
          // No wallet support is compiled in
          if ((error as any).message === 'Method not found') {
            throw Errors.NO_WALLET_SUPPORT(currency.symbol);
          } else {
            throw error;
          }
        }
      }

      let keyProviderInfo = keyProviderMap.get(currency.symbol);

      // Generate a new KeyProvider if that currency does not have one yet
      if (!keyProviderInfo) {
        keyProviderInfo = {
          highestUsedIndex: 0,
          symbol: currency.symbol,
          derivationPath: `${this.derivationPath}/${
            this.getHighestDepthIndex(keyProviderMap, 2) + 1
          }`,
        };

        keyProviderMap.set(currency.symbol, keyProviderInfo);

        await KeyRepository.addKeyProvider({
          ...keyProviderInfo,
          symbol: currency.symbol,
        });
      }

      const wallet =
        currency.type !== CurrencyType.Liquid
          ? new Wallet(
              this.logger,
              currency.type,
              walletProvider,
              currency.network!,
            )
          : new WalletLiquid(
              this.logger,
              walletProvider,
              this.slip77,
              currency.network! as LiquidNetwork,
            );

      wallet.initKeyProvider(
        keyProviderInfo.derivationPath,
        keyProviderInfo.highestUsedIndex,
        this.masterNode,
      );

      this.wallets.set(currency.symbol, wallet);
    }

    for (const manager of this.ethereumManagers) {
      const ethereumWallets = await manager.init(this.mnemonicEvm);

      for (const [symbol, ethereumWallet] of ethereumWallets) {
        this.wallets.set(symbol, ethereumWallet);
      }
    }
  };

  private static deriveFromMnemonic = (mnemonic: string) => {
    const seed = mnemonicToSeedSync(mnemonic);
    return {
      slip77: slip77.fromSeed(seed),
      masterNode: bip32.fromSeed(seed),
    };
  };

  private loadMnemonic = (filename: string) => {
    if (!fs.existsSync(filename)) {
      this.logger.info(`Generated new mnemonic: ${filename}`);

      fs.writeFileSync(filename, generateMnemonic());
    }

    const mnemonic = fs.readFileSync(filename, 'utf-8').trim();
    if (!validateMnemonic(mnemonic)) {
      throw Errors.INVALID_MNEMONIC(mnemonic);
    }

    return mnemonic;
  };

  private getKeyProviderMap = async () => {
    const map = new Map<string, KeyProviderType>();
    const keyProviders = await KeyRepository.getKeyProviders();

    keyProviders.forEach((keyProvider) => {
      map.set(keyProvider.symbol, {
        symbol: keyProvider.symbol,
        derivationPath: keyProvider.derivationPath,
        highestUsedIndex: keyProvider.highestUsedIndex,
      });
    });

    return map;
  };

  private getHighestDepthIndex = (
    map: Map<string, KeyProviderType>,
    depth: number,
  ): number => {
    if (depth === 0) {
      throw Errors.INVALID_DEPTH_INDEX(depth);
    }

    let highestIndex = -1;

    map.forEach((info) => {
      const split = splitDerivationPath(info.derivationPath);
      const index = split.sub[depth - 1];

      if (index > highestIndex) {
        highestIndex = index;
      }
    });

    return highestIndex;
  };
}

export default WalletManager;
export { Currency };
