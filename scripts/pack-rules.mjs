import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
await mkdir('data/vendored',{recursive:true});
const files={'classes.json':'data/catalog/classes.json','spells.json':'data/catalog/spells.json','catalog.json':'public/rules/catalog.json','srd-2014.json':'public/rules/srd-2014.json','srd-2024.json':'public/rules/srd-2024.json'};
for(const [name,file] of Object.entries(files))await writeFile('data/vendored/'+name+'.gz',gzipSync(await readFile(file),{level:9}));
console.log('Packed the open SRD snapshots');
