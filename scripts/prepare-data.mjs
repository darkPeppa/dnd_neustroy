import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const files={'classes.json':'data/catalog/classes.json','spells.json':'data/catalog/spells.json','catalog.json':'public/rules/catalog.json','srd-2014.json':'public/rules/srd-2014.json','srd-2024.json':'public/rules/srd-2024.json'};
await mkdir('data/catalog',{recursive:true});await mkdir('public/rules',{recursive:true});
for(const [name,file] of Object.entries(files))await writeFile(file,gunzipSync(await readFile('data/vendored/'+name+'.gz')));
