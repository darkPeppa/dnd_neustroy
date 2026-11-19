import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {networkInterfaces} from 'node:os';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import worker from '../dist/local-api.mjs';
const lan=process.argv.includes('--lan'),port=Number(process.env.NEUSTROY_PORT||8787),root=path.resolve('.local');
await mkdir(path.join(root,'files'),{recursive:true});
let secret;try{secret=await readFile(path.join(root,'session.key'));}catch{secret=randomBytes(32);await writeFile(path.join(root,'session.key'),secret,{mode:0o600});}
const sqlite=new DatabaseSync(path.join(root,'neustroy.sqlite'));sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){if(!sqlite.prepare('SELECT 1 FROM local_migrations WHERE name=?').get(file)){sqlite.exec('BEGIN');try{sqlite.exec(await readFile('migrations/'+file,'utf8'));sqlite.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(file);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}}
sqlite.prepare("INSERT OR IGNORE INTO site_config(id,value) VALUES('owner','local-host')").run();
class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new Statement(this.sql,p);}async first(column){const row=sqlite.prepare(this.sql).get(...this.params);return column?row?.[column]:row||null;}async all(){return {success:true,results:sqlite.prepare(this.sql).all(...this.params)};}async run(){const info=sqlite.prepare(this.sql).run(...this.params);return {success:true,meta:{changes:Number(info.changes)}};}}
const DB={prepare:sql=>new Statement(sql),batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const filePath=key=>{if(!/^[a-z0-9/-]+$/i.test(key)||key.includes('..'))throw Error('Invalid file key');return path.join(root,'files',key);};
const BUCKET={async put(key,data){const file=filePath(key);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.from(data));},async get(key){try{return {body:await readFile(filePath(key))};}catch(e){if(e.code==='ENOENT')return null;throw e;}},async delete(key){try{await unlink(filePath(key));}catch(e){if(e.code!=='ENOENT')throw e;}}};
const env={DB,BUCKET,LOCAL_SERVER:'true'};
const addresses=Object.values(networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>x.address);
const hosts=new Set(['localhost','127.0.0.1','[::1]',...addresses]);
const localAddress=ip=>{ip=ip.replace(/^::ffff:/,'');return ip==='::1'||ip.startsWith('127.')||ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^f[cd]/i.test(ip)||/^fe80:/i.test(ip);};
const sign=value=>createHmac('sha256',secret).update(value).digest('hex');
function guest(cookie){const [id,signature]=(cookie||'').split('.');if(!/^[a-f0-9]{32}$/.test(id||'')||!signature||signature.length!==64)return null;return timingSafeEqual(Buffer.from(signature),Buffer.from(sign(id)))?id:null;}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.wasm':'application/wasm'};
// Serialize the local SQLite API so an await inside a batch cannot interleave transactions.
let queue=Promise.resolve();
const server=http.createServer((req,res)=>{const serve=async()=>{try{
 const host=req.headers.host||'';let url;try{url=new URL('http://'+host+(req.url||'/'));}catch{res.writeHead(400).end();return;}if(!hosts.has(url.hostname)||!localAddress(req.socket.remoteAddress||'')){res.writeHead(403).end('Use a local network address');return;}
 if(req.headers.origin&&req.headers.origin!==url.origin){res.writeHead(403).end('Origin not allowed');return;}
 const address=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');const loopback=address==='::1'||address.startsWith('127.');let id=loopback?'local-host':guest(req.headers.cookie?.match(/(?:^|;\s*)neustroy_device=([^;]+)/)?.[1]);if(!id){id=randomBytes(16).toString('hex');res.setHeader('Set-Cookie',`neustroy_device=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);}
 const userId=loopback?'local-host':'lan:'+id;const stored=sqlite.prepare('SELECT value FROM site_config WHERE id=?').get('profile:'+userId);const name=stored?.value||(loopback?'Мастер локальной партии':'Игрок '+id.slice(0,4));
 if(url.pathname.startsWith('/api/')||url.pathname==='/mcp'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}const data=Buffer.concat(chunks);
  if(url.pathname==='/api/local/profile'&&req.method==='POST'){let body;try{body=JSON.parse(data);}catch{res.writeHead(400).end();return;}const next=String(body.name||'').trim().slice(0,80);if(!next){res.writeHead(400).end();return;}sqlite.prepare('INSERT INTO site_config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('profile:'+userId,next);res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');return;}
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers)){if(value&&!key.startsWith('oai-')&&!key.startsWith('x-dev-')&&!['host','cookie','authorization','cf-connecting-ip'].includes(key))headers.set(key,Array.isArray(value)?value.join(', '):value);}
  headers.set('oai-authenticated-user-id',userId);headers.set('oai-authenticated-user-full-name',encodeURIComponent(name));headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
  const response=await worker.fetch(new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:data}),env,{waitUntil:p=>p.catch(console.error)});const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['set-cookie'];res.writeHead(response.status,responseHeaders);res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 let file=path.resolve('dist/client','.'+decodeURIComponent(url.pathname));if(!file.startsWith(path.resolve('dist/client')+path.sep)){file=path.resolve('dist/client/index.html');}let data;try{data=await readFile(file);}catch{if(path.extname(url.pathname)){res.writeHead(404).end();return;}file=path.resolve('dist/client/index.html');data=await readFile(file);}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(data);
 }catch(error){console.error(error.message);res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Ошибка локального сервера'}));}};queue=queue.then(serve,serve);});
server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{console.log(`neustroy · http://127.0.0.1:${port}`);if(lan)for(const a of addresses)console.log(`Для вашей сети: http://${a}:${port}`);console.log('Без аккаунтов. База и файлы: .local/. Не пробрасывайте этот порт в интернет.');});
