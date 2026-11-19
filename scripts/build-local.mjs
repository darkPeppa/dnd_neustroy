import {build} from 'esbuild';
await build({entryPoints:['server/index.ts'],outfile:'dist/local-api.mjs',bundle:true,format:'esm',platform:'node',target:'node22',minify:false});
