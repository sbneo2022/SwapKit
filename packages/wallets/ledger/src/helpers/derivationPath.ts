import { Chain, NetworkDerivationPath } from '@swapkit/types';

type Params = {
  index: number;
  chain: Chain;
  type?: 'legacy' | 'ledgerLive' | 'nativeSegwitMiddleAccount' | 'segwit';
};

const updatedLastIndex = (path: number[], index: number) => [
  ...path.slice(0, path.length - 1),
  index,
];

export const getDerivationPathFor = ({ chain, index, type }: Params) => {
  switch (chain) {
    case Chain.Avalanche:
    case Chain.Ethereum:
      if (type === 'legacy') return [44, 60, 0, index];
      if (type === 'ledgerLive') return [44, 60, index, 0, 0];
      return updatedLastIndex(NetworkDerivationPath[chain], index);

    case Chain.Bitcoin:
    case Chain.Litecoin: {
      const chainId = chain === Chain.Bitcoin ? 0 : 2;

      if (type === 'nativeSegwitMiddleAccount') return [84, chainId, index, 0, 0];
      if (type === 'segwit') return [49, chainId, 0, 0, index];
      if (type === 'legacy') return [44, chainId, 0, 0, index];
      return updatedLastIndex(NetworkDerivationPath[chain], index);
    }
    default:
      return updatedLastIndex(NetworkDerivationPath[chain], index);
  }
};

export const getWalletFormatFor = (path: string) => {
  const [purpose, chainId] = path.split('/').map((p) => parseInt(p, 10));

  // Comment can be removed after testing
  // if (chainId === 145) return purpose === 84 ? 'cashaddr' : 'legacy';
  if (chainId === 145) 'cashaddr';

  switch (purpose) {
    case 44:
      return 'legacy';
    case 49:
      return 'p2sh';
    default:
      return 'bech32';
  }
};
