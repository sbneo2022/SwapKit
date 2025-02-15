import { SwapKitApi } from '@swapkit/api';
import { Chain } from '@swapkit/types';
import fs from 'fs-extra';

const getTokens = async () => {
  SwapKitApi.getTokenlistProviders().then((providers) => {
    providers.forEach(async ({ provider }) => {
      if (provider.includes('whitelist')) return;

      try {
        const tokenList = await SwapKitApi.getTokenList(provider);

        const tokens = tokenList.tokens.map(
          ({ address, chain, identifier, decimals, logoURL }) => ({
            address,
            chain: chain === 'ARBITRUM' ? Chain.Arbitrum : chain,
            identifier: identifier.startsWith('ARBITRUM.')
              ? identifier.replace('ARBITRUM', Chain.Arbitrum)
              : identifier,
            decimals,
            logoURL,
          }),
        );

        tokenList.tokens = tokens;

        fs.outputFile(
          `./src/tokenLists/${provider}.ts`,
          `export const list = ${JSON.stringify(tokenList)} as const;`,
          { flag: 'w' },
        );
      } catch (e) {
        console.error(provider);
      }
    });
  });
};

getTokens();
