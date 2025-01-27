import { base64 } from '@swapkit/toolbox-cosmos';
import type { DerivationPathArray, GetAddressAndPubKeyResponse } from '@swapkit/types';
import { ErrorCode, NetworkDerivationPath } from '@swapkit/types';

import { CommonLedgerInterface } from '../../interfaces/LedgerInterfaces.ts';

import { getSignature } from './utils.ts';

export class THORChainLedger extends CommonLedgerInterface {
  private pubKey: string | null = null;

  public derivationPath: number[];

  constructor(derivationPath: DerivationPathArray = NetworkDerivationPath.THOR) {
    super();
    this.chain = 'thor';
    this.derivationPath = derivationPath;
  }

  get pubkey() {
    return this.pubKey;
  }

  connect = async () => {
    await this.checkOrCreateTransportAndLedger();

    const { compressed_pk, bech32_address }: GetAddressAndPubKeyResponse =
      await this.getAddressAndPubKey();

    this.pubKey = base64.encode(compressed_pk);

    return bech32_address;
  };

  getAddressAndPubKey = async () => {
    await this.checkOrCreateTransportAndLedger(true);

    const response: GetAddressAndPubKeyResponse = await this.ledgerApp.getAddressAndPubKey(
      this.derivationPath,
      this.chain,
    );

    this.validateResponse(response.return_code, response.error_message);

    return response;
  };

  showAddressAndPubKey = async () => {
    await this.checkOrCreateTransportAndLedger(true);

    const response: GetAddressAndPubKeyResponse = await this.ledgerApp.showAddressAndPubKey(
      this.derivationPath,
      this.chain,
    );

    this.validateResponse(response.return_code, response.error_message);

    return response;
  };

  signTransaction = async (rawTx: string, sequence = '0') => {
    await this.checkOrCreateTransportAndLedger(true);

    const { return_code, error_message, signature } = await this.ledgerApp.sign(
      this.derivationPath,
      rawTx,
    );

    if (!this.pubKey) throw new Error('Public Key not found');

    this.validateResponse(return_code, error_message);

    return [
      {
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: this.pubKey },
        sequence,
        signature: getSignature(signature),
      },
    ];
  };

  private validateResponse = (errorCode: ErrorCode, message?: string) => {
    if (errorCode !== ErrorCode.NoError) throw new Error(`${errorCode} ${message}`);
  };
}
