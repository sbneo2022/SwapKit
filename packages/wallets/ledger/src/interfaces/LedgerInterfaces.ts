import type BitcoinApp from '@ledgerhq/hw-app-btc';
import type { Network as BTCNetwork, Psbt, UTXOType } from '@swapkit/toolbox-utxo';
import { networks, toCashAddress } from '@swapkit/toolbox-utxo';

import { BinanceApp } from '../clients/binance/lib.ts';
import { THORChainApp } from '../clients/thorchain/lib.ts';
import { getLedgerTransport } from '../helpers/getLedgerTransport.ts';

import type { CreateTransactionArg } from './types.ts';
import { signUTXOTransaction } from './utxo.ts';

export abstract class CommonLedgerInterface {
  public ledgerTimeout: number = 50000;
  public derivationPath: (number | string)[] | string = [];
  public transport: any;
  public ledgerApp: any;
  public chain: 'thor' | 'bnb' | 'sol' | 'cosmos' | 'eth' = 'thor';

  public checkOrCreateTransportAndLedger = async (forceReconnect: boolean = false) => {
    if (!forceReconnect && this.transport && this.ledgerApp) return;

    try {
      this.transport =
        forceReconnect || !this.transport ? await getLedgerTransport() : this.transport;

      switch (this.chain) {
        case 'bnb': {
          this.ledgerApp =
            forceReconnect || !this.ledgerApp ? new BinanceApp(this.transport) : this.ledgerApp;

          break;
        }

        case 'thor': {
          this.ledgerApp =
            forceReconnect || !this.ledgerApp ? new THORChainApp(this.transport) : this.ledgerApp;

          break;
        }

        case 'cosmos': {
          const { default: CosmosApp } = await import('@ledgerhq/hw-app-cosmos');
          this.ledgerApp =
            // @ts-expect-error
            forceReconnect || !this.ledgerApp ? new CosmosApp(this.transport) : this.ledgerApp;
        }
      }

      return this.ledgerApp;
    } catch (error: any) {
      console.error(error);
      throw new Error('Cannot create transport or ledger client');
    }
  };
}

export abstract class UTXOLedgerInterface {
  public addressNetwork: BTCNetwork = networks.bitcoin;
  // @ts-expect-error `default` typing is wrong
  public btcApp: InstanceType<typeof BitcoinApp> | null = null;
  public chain: 'bitcoin-cash' | 'bitcoin' | 'litecoin' | 'dogecoin' = 'bitcoin';
  public derivationPath = '';
  public ledgerApp: any;
  public additionalSignParams?: Partial<CreateTransactionArg>;
  public transport = null as any;
  public walletFormat: 'legacy' | 'bech32' | 'p2sh' = 'bech32';

  public connect = async () => {
    await this.checkBtcAppAndCreateTransportWebUSB(false);

    const { default: BitcoinApp } = await import('@ledgerhq/hw-app-btc');

    // @ts-expect-error `default` typing is wrong
    this.btcApp = new BitcoinApp({ transport: this.transport, currency: this.chain });
  };

  public signTransaction = async (psbt: Psbt, inputUtxos: UTXOType[]) => {
    await this.createTransportWebUSB();

    return signUTXOTransaction(
      { psbt, derivationPath: this.derivationPath, btcApp: this.btcApp, inputUtxos },
      this.additionalSignParams,
    );
  };

  public getAddress = async () => {
    await this.checkBtcAppAndCreateTransportWebUSB(false);

    const { bitcoinAddress: address } = await this.btcApp!.getWalletPublicKey(this.derivationPath, {
      format: this.walletFormat,
    });

    if (!address) {
      throw new Error(
        `Cannot get ${this.chain} address from ledger derivation path: ${this.derivationPath}`,
      );
    }

    return this.chain === 'bitcoin-cash' && this.walletFormat === 'legacy'
      ? toCashAddress(address).replace(/(bchtest:|bitcoincash:)/, '')
      : address;
  };

  private checkBtcAppAndCreateTransportWebUSB = async (checkBtcApp: boolean = true) => {
    if (checkBtcApp && !this.btcApp) {
      const errorData = JSON.stringify({ checkBtcApp, btcApp: this.btcApp });
      throw new Error(`Ledger connection failed: \n${errorData}`);
    }

    this.transport ||= await getLedgerTransport();
  };

  private createTransportWebUSB = async () => {
    this.transport = await getLedgerTransport();
    const { default: BitcoinApp } = await import('@ledgerhq/hw-app-btc');

    // @ts-expect-error `default` typing is wrong
    this.btcApp = new BitcoinApp({ transport: this.transport, currency: this.chain });
  };

  public getExtendedPublicKey = async (
    path: string = "84'/0'/0'",
    xpubVersion: number = 76067358,
  ) => {
    await this.checkBtcAppAndCreateTransportWebUSB(false);

    return this.btcApp!.getWalletXpub({
      path,
      xpubVersion,
    });
  };
}
