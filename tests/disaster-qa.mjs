import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {restoreFreshProject} from '../recovery/restore-new-project.mjs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
globalThis.JSZip=require('../js/vendor/jszip-3.10.1.min.js');if(!globalThis.crypto)globalThis.crypto=webcrypto;
await import('../js/backup.js');
const {buildArchive,readArchive}=globalThis.YesparkBackup;
const url=process.env.API_URL,key=process.env.ANON_KEY,secret=process.env.SERVICE_ROLE_KEY;
assert(url==='http://127.0.0.1:54321'||url==='http://localhost:54321','LOCAL ONLY');
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,secret,opts),admin=createClient(url,key,opts),anon=createClient(url,key,opts);
function ok(r,label){assert(!r.error,label+': '+(r.error?.message||''));return r.data}
const pass='Qa-'+randomBytes(24).toString('hex'),email='restore-qa@example.test';
const u=ok(await service.auth.admin.createUser({email,password:pass,email_confirm:true}),'recreate auth').user;
ok(await service.from('admins').insert({user_id:u.id,active:true}),'grant admin');
ok(await admin.auth.signInWithPassword({email,password:pass}),'admin login');
const fresh=ok(await admin.rpc('yespark_export_backup'),'empty target snapshot');
assert(fresh.tables.listings.length===0&&fresh.media.length===0);
console.log('PASS migration replay and admin recreation');
const source='https://source.example.test',path='logos/qa.png';
const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64');
const id=randomUUID(),banner=randomUUID(),review=randomUUID(),ad=randomUUID(),created=new Date().toISOString();
const tables={listing_categories:[{kind:'empresa',name:'QA',created_at:created}],listings:[{id,kind:'empresa',name:'QA empresa',category:'QA',description:'Registro ficticio para homologacao',phone:'',image_url:source+'/storage/v1/object/public/yespark-media/'+path,active:true,created_at:created,sample:true,instagram:'',profile_image_url:'',profile_image_type:'logo'}],ads:[{id:ad,listing_id:id,title:'QA anuncio',description:'Anuncio ficticio',period:'Especial',image_url:'',starts_at:null,ends_at:null,active:true,created_at:created,sample:true}],banners:[{id:banner,title:'QA banner',subtitle:'',image_url:source+'/storage/v1/object/public/yespark-media/'+path,target_type:'empresa',target_id:id,sort_order:1,active:true,created_at:created}],reviews:[{id:review,listing_id:id,display_name:'QA visitante',comment:'Comentario ficticio de teste',stars:5,status:'approved',created_at:created}],site_settings:[{key:'show_home_promos',enabled:false}],legal_contact:[{id:1,controller_name:'QA Teste',contact_email:'qa@example.test',updated_at:created}]};
const media=[{name:path,size:img.length,type:'image/png'}],archive=await buildArchive({tables,media},source,async()=>img);
const loaded=await readArchive(new Blob([archive]),source);assert.equal(loaded.files.size,1);
for(const table of ['listings','ads','banners'])for(const row of loaded.tables[table])for(const field of ['image_url','profile_image_url'])if(typeof row[field]==='string'&&row[field].startsWith(source+'/storage/v1/object/public/yespark-media/'))row[field]=row[field].replace(source,url);
const dir=await mkdtemp(join(tmpdir(),'yespark-restore-qa-')),file=join(dir,'qa.zip');
await writeFile(file,archive);
try{
 const plan=await restoreFreshProject({file,targetUrl:url,key,email,password:pass,apply:false,source});assert.equal(plan.listings.inserted,1);
 assert.equal(ok(await admin.rpc('yespark_export_backup'),'after dryrun').tables.listings.length,0);
 await restoreFreshProject({file,targetUrl:url,key,email,password:pass,apply:true,source});
 await assert.rejects(restoreFreshProject({file,targetUrl:url,key,email,password:pass,apply:true,source}),/não está vazio/);
}finally{await rm(dir,{recursive:true,force:true})}
const restored=ok(await admin.rpc('yespark_export_backup'),'restored snapshot');
for(const t of Object.keys(tables)){assert.equal(restored.tables[t].length,1,t);if(t==='listings')assert(restored.tables[t][0].image_url.startsWith(url));}
const image=ok(await admin.storage.from('yespark-media').download(path),'download restored image');
assert.deepEqual(Buffer.from(await image.arrayBuffer()),img);
assert.equal(restored.tables.site_settings[0].enabled,false);assert.equal(restored.tables.legal_contact[0].contact_email,'qa@example.test');
const again=ok(await admin.rpc('yespark_restore_backup',{p_tables:loaded.tables,p_apply:true}),'idempotence');assert(Object.values(again).every(v=>v.inserted===0));
const cat=ok(await anon.rpc('yespark_search_catalog',{p_kind:'empresa',p_query:'QA',p_sort:'recent',p_limit:16,p_offset:0}),'public catalog');assert(cat.some(x=>x.id===id&&Number(x.rating_avg)===5));
assert((await anon.rpc('yespark_export_backup')).error);
console.log('PASS cross-origin ZIP, seven operational tables, image bytes, links, ratings, settings, idempotence, anonymous denial');
const fake=Array.from({length:1000},(_,i)=>({id:randomUUID(),kind:i%2?'empresa':'servico',name:'QA catalogo '+i,category:i%2?'QA':'Limpeza',description:'Registro sintetico de capacidade',active:true,sample:true}));
for(let i=0;i<fake.length;i+=100)ok(await service.from('listings').insert(fake.slice(i,i+100)),'seed listings');
const rev=fake.flatMap(x=>Array.from({length:4},(_,j)=>({listing_id:x.id,display_name:'QA visitante',comment:'Comentario sintetico de carga',stars:3+j%3,status:'approved'})));
for(let i=0;i<rev.length;i+=100)ok(await service.from('reviews').insert(rev.slice(i,i+100)),'seed reviews');
console.log('PASS seeded 1001 listings and 4001 reviews');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
for(const n of [10,50,100,200]){
 const results=[],start=performance.now();
 const workers=Array.from({length:n},(_,i)=>(async()=>{for(let j=0;j<3;j++){
  const begin=performance.now();let status=0,correct=false;
  try{const r=await fetch(url+'/rest/v1/rpc/yespark_search_catalog',{method:'POST',headers,body:JSON.stringify({p_kind:i%2?'empresa':'servico',p_query:j%2?'QA':'',p_sort:j===1?'rating':'recent',p_limit:16,p_offset:0}),signal:AbortSignal.timeout(12000)});status=r.status;const data=await r.json();correct=r.ok&&Array.isArray(data)&&data.length===16;}catch{}
  results.push({ms:performance.now()-begin,status,correct});
  await new Promise(r=>setTimeout(r,250));
 }})());
 await Promise.all(workers);const sorted=results.map(x=>x.ms).sort((a,b)=>a-b),errors=results.filter(x=>!x.correct).length;
 const p=pct=>Math.round(sorted[Math.ceil(sorted.length*pct)-1]);
 console.log('LOCAL_LOAD '+JSON.stringify({concurrency:n,requests:results.length,errors,p50:p(.5),p95:p(.95),p99:p(.99),seconds:+((performance.now()-start)/1000).toFixed(2)}));
 if(errors||p(.95)>3000){console.log('LOCAL_LOAD_STOP');break}
}
// Soak test, 200 active synthetic visitors for 180s, one read every 8–12s.
// All traffic is directed to the isolated local Supabase, not production.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const N=200,DURATION=180000,started=performance.now(),deadline=started+DURATION;
const samples=[];let errors=0,stop=false,maxInFlight=0,inFlight=0;
const workers=Array.from({length:N},(_,i)=>(async()=>{
 await sleep(i*40);
 let j=0;
 while(performance.now()<deadline&&!stop){
  const begin=performance.now();inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  let correct=false,status=0;
  try{const r=await fetch(url+'/rest/v1/rpc/yespark_search_catalog',{method:'POST',headers,body:JSON.stringify({p_kind:i%2?'empresa':'servico',p_query:j%3?'':'QA',p_sort:j%3===1?'rating':'recent',p_limit:16,p_offset:0}),signal:AbortSignal.timeout(12000)});status=r.status;const d=await r.json();correct=r.ok&&Array.isArray(d)&&d.length===16}catch{}
  inFlight--;samples.push(performance.now()-begin);if(!correct){errors++;stop=true;}
  if(samples.length>=100&&samples.length%100===0){const last=samples.slice(-100).sort((a,b)=>a-b);if(last[94]>3000)stop=true;}
  j++;const delay=8000+((i*137+j*613)%4001);const remain=deadline-performance.now();
  if(remain>0&&!stop)await sleep(Math.min(remain,delay));
 }
})());
await Promise.all(workers);
const ordered=samples.slice().sort((a,b)=>a-b),percent=p=>Math.round(ordered[Math.ceil(ordered.length*p)-1]||0);
console.log('LOCAL_SOAK '+JSON.stringify({active_visitors:N,seconds:+((performance.now()-started)/1000).toFixed(2),requests:samples.length,errors,p50:percent(.5),p95:percent(.95),p99:percent(.99),max_in_flight:maxInFlight,stopped:stop}));
assert(!stop&&errors===0&&samples.length>=2000,'Sustained test failed or stopped');

await admin.auth.signOut();console.log('PASS test environment isolated');
