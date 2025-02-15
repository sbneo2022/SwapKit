import thorswapViteConfig from '@internal/config';
import { resolve } from 'path';

import { name, peerDependencies } from './package.json';

const external = Object.keys(peerDependencies);

const viteConfig = thorswapViteConfig(name, {
  build: {
    lib: { entry: resolve(__dirname, 'src/index.ts') },
    rollupOptions: { external },
  },
});

export default viteConfig;
