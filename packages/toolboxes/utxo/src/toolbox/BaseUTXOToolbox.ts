import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { AssetValue, SwapKitNumber } from '@swapkit/helpers';
import type { UTXOChain } from '@swapkit/types';
import { BaseDecimal, Chain, FeeOption } from '@swapkit/types';
import { address as btcLibAddress, payments, Psbt } from 'bitcoinjs-lib';
import type { ECPairInterface } from 'ecpair';
import { ECPairFactory } from 'ecpair';

import type { BlockchairApiType } from '../api/blockchairApi.ts';
import type {
  TargetOutput,
  UTXOBaseToolboxParams,
  UTXOBuildTxParams,
  UTXOType,
  UTXOWalletTransferParams,
} from '../types/common.ts';
import {
  accumulative,
  calculateTxSize,
  compileMemo,
  getDustThreshold,
  getInputSize,
  getNetwork,
  standardFeeRates,
  UTXOScriptType,
} from '../utils/index.ts';

const createKeysForPath = async ({
  phrase,
  wif,
  derivationPath,
  chain,
}: {
  phrase?: string;
  wif?: string;
  derivationPath: string;
  chain: Chain;
}) => {
  if (!wif && !phrase) throw new Error('Either phrase or wif must be provided');

  const tinySecp = await import('tiny-secp256k1');
  const factory = ECPairFactory(tinySecp);
  const network = getNetwork(chain);

  if (wif) return factory.fromWIF(wif, network);

  const seed = mnemonicToSeedSync(phrase as string);
  const master = HDKey.fromMasterSeed(seed, network).derive(derivationPath);
  if (!master.privateKey) throw new Error('Could not get private key from phrase');

  return factory.fromPrivateKey(Buffer.from(master.privateKey), { network });
};

const validateAddress = ({ address, chain }: { address: string } & UTXOBaseToolboxParams) => {
  try {
    btcLibAddress.toOutputScript(address, getNetwork(chain));
    return true;
  } catch (error) {
    return false;
  }
};

const getAddressFromKeys = ({ keys, chain }: { keys: ECPairInterface } & UTXOBaseToolboxParams) => {
  if (!keys) throw new Error('Keys must be provided');

  const method = Chain.Dogecoin === chain ? payments.p2pkh : payments.p2wpkh;
  const { address } = method({ pubkey: keys.publicKey, network: getNetwork(chain) });
  if (!address) throw new Error('Address not defined');

  return address;
};

const transfer = async ({
  signTransaction,
  from,
  memo,
  recipient,
  chain,
  apiClient,
  feeOptionKey,
  broadcastTx,
  feeRate,
  assetValue,
}: UTXOWalletTransferParams<Psbt, Psbt>) => {
  if (!from) throw new Error('From address must be provided');
  if (!recipient) throw new Error('Recipient address must be provided');
  const txFeeRate = feeRate || (await getFeeRates(apiClient))[feeOptionKey || FeeOption.Fast];
  const { psbt } = await buildTx({
    recipient,
    feeRate: txFeeRate,
    sender: from,
    fetchTxHex: chain === Chain.Dogecoin,
    chain,
    apiClient,
    assetValue,
    memo,
  });
  const signedPsbt = await signTransaction(psbt);
  signedPsbt.finalizeAllInputs(); // Finalise inputs
  // TX extracted and formatted to hex
  return broadcastTx(signedPsbt.extractTransaction().toHex());
};

const getBalance = async ({
  address,
  chain,
  apiClient,
}: { address: string } & UTXOBaseToolboxParams) => {
  const balance = (await apiClient.getBalance(address)) / 10 ** BaseDecimal[chain];
  const asset = await AssetValue.fromIdentifier(`${chain}.${chain}`, balance);

  return [asset];
};

const getFeeRates = async (apiClient: BlockchairApiType) =>
  standardFeeRates(await apiClient.getSuggestedTxFee());

const getInputsAndTargetOutputs = async ({
  assetValue,
  recipient,
  memo,
  sender,
  fetchTxHex = false,
  apiClient,
  chain,
}: {
  assetValue: AssetValue;
  recipient: string;
  memo?: string;
  sender: string;
  fetchTxHex?: boolean;
  apiClient: BlockchairApiType;
  chain: UTXOChain;
}) => {
  const inputs = await apiClient.scanUTXOs({
    address: sender,
    fetchTxHex,
  });

  if (!validateAddress({ address: recipient, chain, apiClient })) {
    throw new Error('Invalid address');
  }

  //1. add output amount and recipient to targets
  //2. add output memo to targets (optional)

  return {
    inputs,
    outputs: [
      { address: recipient, value: Number(assetValue.bigIntValue) },
      ...(memo ? [{ address: '', script: compileMemo(memo), value: 0 }] : []),
    ],
  };
};

const buildTx = async ({
  assetValue,
  recipient,
  memo,
  feeRate,
  sender,
  fetchTxHex = false,
  apiClient,
  chain,
}: UTXOBuildTxParams): Promise<{
  psbt: Psbt;
  utxos: UTXOType[];
  inputs: UTXOType[];
}> => {
  const compiledMemo = memo ? compileMemo(memo) : null;

  const inputsAndOutputs = await getInputsAndTargetOutputs({
    assetValue,
    recipient,
    memo,
    sender,
    fetchTxHex,
    apiClient,
    chain,
  });

  const { inputs, outputs } = accumulative({ ...inputsAndOutputs, feeRate, chain });

  // .inputs and .outputs will be undefined if no solution was found
  if (!inputs || !outputs) throw new Error('Insufficient Balance for transaction');
  const psbt = new Psbt({ network: getNetwork(chain) }); // Network-specific

  if (chain === Chain.Dogecoin) psbt.setMaximumFeeRate(650000000);

  inputs.forEach((utxo: UTXOType) =>
    psbt.addInput({
      // FIXME: (@Towan, @Chillios) - Check on this as types says it's not defined
      // @ts-ignore
      hash: utxo.hash,
      index: utxo.index,
      ...(!!utxo.witnessUtxo && chain !== Chain.Dogecoin && { witnessUtxo: utxo.witnessUtxo }),
      ...(chain === Chain.Dogecoin && {
        nonWitnessUtxo: utxo.txHex ? Buffer.from(utxo.txHex, 'hex') : undefined,
      }),
    }),
  );

  outputs.forEach((output: any) => {
    if (!output.address) {
      //an empty address means this is the change address
      output.address = sender;
    }
    if (!output.script) {
      psbt.addOutput(output);
    } else {
      //we need to add the compiled memo this way to
      //avoid dust error tx when accumulating memo output with 0 value
      if (compiledMemo) {
        psbt.addOutput({ script: compiledMemo, value: 0 });
      }
    }
  });

  return { psbt, utxos: inputsAndOutputs.inputs, inputs };
};

const getInputsOutputsFee = async ({
  assetValue,
  apiClient,
  chain,
  feeOptionKey = FeeOption.Fast,
  feeRate,
  fetchTxHex = false,
  memo,
  recipient,
  sender,
}: {
  assetValue: AssetValue;
  recipient: string;
  memo?: string;
  feeRate: number;
  sender: string;
  fetchTxHex?: boolean;
  apiClient: BlockchairApiType;
  chain: UTXOChain;
  feeOptionKey?: FeeOption;
  feeeRate?: number;
}) => {
  const inputsAndOutputs = await getInputsAndTargetOutputs({
    assetValue,
    recipient,
    memo,
    sender,
    fetchTxHex,
    apiClient,
    chain,
  });

  const feeRateWhole = feeRate ? Math.floor(feeRate) : (await getFeeRates(apiClient))[feeOptionKey];

  return accumulative({ ...inputsAndOutputs, feeRate: feeRateWhole, chain });
};

export const estimateMaxSendableAmount = async ({
  from,
  memo,
  feeRate,
  feeOptionKey = FeeOption.Fast,
  recipients = 1,
  chain,
  apiClient,
}: UTXOBaseToolboxParams & {
  recipients?: number | TargetOutput[];
  memo?: string;
  feeRate?: number;
  feeOptionKey?: FeeOption;
  from: string;
}) => {
  const addressData = await apiClient.getAddressData(from);
  const feeRateWhole = feeRate ? Math.ceil(feeRate) : (await getFeeRates(apiClient))[feeOptionKey];
  const inputs = addressData.utxo
    .map((utxo) => ({
      ...utxo,
      // type: utxo.witnessUtxo ? UTXOScriptType.P2WPKH : UTXOScriptType.P2PKH,
      type: UTXOScriptType.P2PKH,
      hash: '',
    }))
    .filter(
      (utxo) => utxo.value > Math.max(getDustThreshold(chain), getInputSize(utxo) * feeRateWhole),
    );

  const balance = AssetValue.fromChainOrSignature(
    chain,
    inputs.reduce((sum, utxo) => (sum += utxo.value), 0),
  );

  let outputs =
    typeof recipients === 'number'
      ? (Array.from({ length: recipients }, () => ({ address: from, value: 0 })) as TargetOutput[])
      : recipients;

  if (memo) {
    const compiledMemo = compileMemo(memo);
    outputs.push({ address: from, script: compiledMemo, value: 0 });
  }

  const txSize = calculateTxSize({
    inputs,
    outputs,
    feeRate: feeRateWhole,
  });

  const fee = txSize * feeRateWhole;

  return new AssetValue({
    identifier: balance.toString(),
    value: balance.sub(fee),
    decimal: balance.decimal!,
  });
};

export const BaseUTXOToolbox = (
  baseToolboxParams: UTXOBaseToolboxParams & { broadcastTx: (txHex: string) => Promise<string> },
) => ({
  accumulative,
  apiClient: baseToolboxParams.apiClient,
  broadcastTx: baseToolboxParams.broadcastTx,
  calculateTxSize,
  buildTx: (params: any) => buildTx({ ...params, ...baseToolboxParams }),
  getAddressFromKeys: (keys: ECPairInterface) => getAddressFromKeys({ keys, ...baseToolboxParams }),
  validateAddress: (address: string) => validateAddress({ address, ...baseToolboxParams }),

  createKeysForPath: (params: any) => createKeysForPath({ ...params, ...baseToolboxParams }),

  getPrivateKeyFromMnemonic: async ({
    phrase,
    derivationPath,
  }: {
    phrase: string;
    derivationPath: string;
  }) => (await createKeysForPath({ phrase, derivationPath, ...baseToolboxParams })).toWIF(),

  getBalance: async (address: string, _potentialScamFilter?: boolean) =>
    getBalance({ address, ...baseToolboxParams }),

  getFeeRates: () => getFeeRates(baseToolboxParams.apiClient),

  transfer: (params: any) => transfer({ ...params, ...baseToolboxParams }),

  getInputsOutputsFee: (params: any) => getInputsOutputsFee({ ...params, ...baseToolboxParams }),

  getFeeForTransaction: async (params: any) =>
    new SwapKitNumber({
      value: (await getInputsOutputsFee({ ...params, ...baseToolboxParams })).fee,
      decimal: 8,
    }),

  estimateMaxSendableAmount: async (params: any) =>
    estimateMaxSendableAmount({ ...params, ...baseToolboxParams }),
});
