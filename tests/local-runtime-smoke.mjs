// Run directly with Node 20 to verify the real startup path, SQLite writes and restart persistence.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
const root=await mkdtemp(path.join(tmpdir(),'neustroy-runtime-'));
let child;
async function stop(){if(!child||child.exitCode!==null||child.signalCode)return;const current=child;child=undefined;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{current.kill('SIGKILL');reject(Error('Local server did not stop'));},5000);current.once('exit',()=>{clearTimeout(timer);resolve();});current.kill('SIGTERM');});}
async function start(){return new Promise((resolve,reject)=>{
  let output='';child=spawn(process.execPath,['scripts/node-runtime.mjs','scripts/local-server.mjs'],{cwd:project,env:{...process.env,NEUSTROY_PORT:'0',NEUSTROY_DATA_DIR:root},stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>reject(Error('Local server did not start: '+output)),15000);
  const receive=data=>{output+=data;const match=output.match(/neustroy · (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}};
  child.stdout.on('data',receive);child.stderr.on('data',receive);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Local server exited (${code}): ${output}`));});
});}
try{
  let url=await start();assert.equal((await fetch(url)).status,200);
  const me=await (await fetch(url+'/api/me')).json();assert.equal(me.local,true);assert.equal(me.isAdmin,true);
  const created=await fetch(url+'/api/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Node startup regression',classId:'wizard',level:1,scores:{str:10,dex:14,con:14,int:16,wis:12,cha:10},hp:8})});assert.equal(created.status,201);const sheet=await created.json();
  await stop();url=await start();const sheets=await (await fetch(url+'/api/characters')).json();assert.equal(sheets.length,1);assert.equal(sheets[0].id,sheet.id);assert.equal(sheets[0].data.name,'Node startup regression');
  console.log(`Local startup and SQLite persistence passed (launched from ${process.version}).`);
}finally{await stop();await rm(root,{recursive:true,force:true});}
