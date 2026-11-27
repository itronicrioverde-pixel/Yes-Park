/* Yes! Park: exportacao ZIP e restauracao aditiva. Sem credenciais privilegiadas. */
(function(global){
'use strict';
const TABLES=['listing_categories','listings','ads','banners','reviews','site_settings','legal_contact'];
const MAX=200*1024*1024, MAX_FILE=2*1024*1024, MAX_ROWS=20000, MAX_FILES=20000;
const enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
const TYPES=['image/png','image/jpeg','image/webp'];
const fail=m=>{throw Error(m)};
const safeName=n=>typeof n==='string'&&n.length<=512&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(n)&&n.split('/').every(p=>p!=='.'&&p!=='..');
const baseUrl=s=>new URL(s).origin;
const bytes=x=>x instanceof Uint8Array?x:new Uint8Array(x);
async function hash(x){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(x))),v=>v.toString(16).padStart(2,'0')).join('')}
function imageType(b){return b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b[0]===82&&b[1]===73&&b[2]===70&&b[3]===70&&b[8]===87&&b[9]===69&&b[10]===66&&b[11]===80?'image/webp':''}
function checkTables(t){
 if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).length!==TABLES.length)fail('Estrutura de dados invalida.');
 for(const k of TABLES){if(!Array.isArray(t[k])||t[k].length>MAX_ROWS||t[k].some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail('Tabela invalida: '+k)}
 if(enc.encode(JSON.stringify(t)).length>9*1024*1024)fail('Dados acima do limite de restauracao.');
}
function checkMedia(m){if(!Array.isArray(m)||m.length>MAX_FILES)fail('Inventario de imagens invalido.');const seen=new Set();let total=0;for(const x of m){if(!x||!safeName(x.name)||seen.has(x.name)||!Number.isSafeInteger(x.size)||x.size<1||x.size>MAX_FILE||!TYPES.includes(x.type))fail('Arquivo de midia invalido.');seen.add(x.name);total+=x.size}if(total>MAX-12*1024*1024)fail('Backup acima do limite desta versao (200 MB). Use exportacao por CLI.');return total}
function checkReferences(t,m,base){
 const prefix=baseUrl(base)+'/storage/v1/object/public/yespark-media/',names=new Set(m.map(x=>x.name));
 for(const k of ['listings','ads','banners'])for(const r of t[k])for(const field of k==='listings'?['image_url','profile_image_url']:['image_url']){
 const u=r[field];if(typeof u!=='string'||!u.startsWith(prefix))continue;
 let name;try{name=decodeURIComponent(u.slice(prefix.length))}catch{fail('Referencia de imagem invalida.')}
 if(!names.has(name))fail('Imagem referenciada ausente no Storage: '+name);
 }
}
let zipPromise;
async function loadZip(){
 if(global.JSZip?.version==='3.10.1')return global.JSZip;
 if(!zipPromise)zipPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./js/vendor/jszip-3.10.1.min.js';s.onload=()=>global.JSZip?.version==='3.10.1'?resolve(global.JSZip):reject(Error('Biblioteca ZIP invalida.'));s.onerror=()=>reject(Error('Nao foi possivel carregar biblioteca ZIP.'));document.head.appendChild(s)}).catch(e=>{zipPromise=null;throw e});
 return zipPromise;
}
async function buildArchive(snap,base,download,progress=()=>{}){
 checkTables(snap.tables);checkMedia(snap.media);checkReferences(snap.tables,snap.media,base);
 const Zip=await loadZip(),zip=new Zip(),tables=enc.encode(JSON.stringify(snap.tables)),media=[];
 zip.file('tables.json',tables,{createFolders:false});
 let done=0;
 // Four concurrent downloads, avoiding a request burst as the catalog grows.
 for(let i=0;i<snap.media.length;i+=4){
 const group=await Promise.all(snap.media.slice(i,i+4).map(async x=>{
 const b=bytes(await download(x.name));if(b.length!==x.size||imageType(b)!==x.type)fail('Imagem alterada ou invalida: '+x.name);
 return {entry:{name:x.name,size:b.length,type:x.type,sha256:await hash(b)},b};
 }));
 for(const {entry,b} of group){zip.file('media/'+entry.name,b,{createFolders:false});media.push(entry);progress(++done,snap.media.length)}
 }
 const manifest={format:'yespark-backup',version:1,source:baseUrl(base),createdAt:new Date().toISOString(),tablesHash:await hash(tables),media};
 zip.file('manifest.json',JSON.stringify(manifest),{createFolders:false});
 const archive=await zip.generateAsync({type:'uint8array',compression:'STORE',streamFiles:false});
 if(archive.length>MAX)fail('ZIP excede o limite de 200 MB.');
 return archive;
}
// Accept only the bounded STORE-format ZIPs generated here, not arbitrary compressed archives.
function preflight(b){
 if(b.length<22||b.length>MAX)fail('Tamanho do ZIP invalido.');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true),e=b.length-22;
 if(u32(e)!==0x06054b50||u16(e+4)||u16(e+6)||u16(e+20)||u16(e+8)!==u16(e+10))fail('Formato ZIP nao suportado.');
 const count=u16(e+10),start=u32(e+16);if(count<2||count>MAX_FILES+2||start+u32(e+12)!==e||start>e)fail('Diretorio ZIP invalido.');
 const seen=new Set(),ranges=[];let c=start,total=0;
 for(let i=0;i<count;i++){
 if(c+46>e||u32(c)!==0x02014b50)fail('Entrada ZIP invalida.');
 const flags=u16(c+8),method=u16(c+10),size=u32(c+24),len=u16(c+28),off=u32(c+42);
 if(flags&~0x800||method!==0||u32(c+20)!==size||u16(c+30)||u16(c+32)||u16(c+34)||!len||c+46+len>e||off+30>start)fail('ZIP comprimido ou estrutura nao suportada.');
 const name=dec.decode(b.subarray(c+46,c+46+len));
 if(seen.has(name)||!(name==='manifest.json'||name==='tables.json'||name.startsWith('media/')&&safeName(name.slice(6))))fail('Nome de arquivo ZIP invalido.');
 seen.add(name);
 if(size>(name.startsWith('media/')?MAX_FILE:10*1024*1024))fail('Entrada ZIP acima do limite.');
 if(u32(off)!==0x04034b50||u16(off+6)!==flags||u16(off+8)!==0||u32(off+14)!==u32(c+16)||u32(off+18)!==size||u32(off+22)!==size||u16(off+26)!==len||u16(off+28))fail('Cabecalho local ZIP invalido.');
 const data=off+30+len,end=data+size;
 if(end>start||dec.decode(b.subarray(off+30,data))!==name)fail('Limites ZIP invalidos.');
 ranges.push([off,end]);total+=size;c+=46+len;
 }
 ranges.sort((a,b)=>a[0]-b[0]);let pos=0;
 for(const [a,z] of ranges){if(a!==pos)fail('Entradas ZIP sobrepostas ou extras.');pos=z}
 if(pos!==start||c!==e||total>MAX||!seen.has('tables.json')||!seen.has('manifest.json'))fail('Estrutura ZIP incompleta.');
 return seen;
}
async function readArchive(file,base){
 if(!file||file.size>MAX)fail('Escolha um ZIP de ate 200 MB.');
 const b=bytes(await file.arrayBuffer()),names=preflight(b),Zip=await loadZip(),zip=await Zip.loadAsync(b,{checkCRC32:true});
 const get=async n=>{const f=zip.file(n);if(!f)fail('Arquivo ausente: '+n);return f.async('uint8array')};
 const m=JSON.parse(dec.decode(await get('manifest.json')));
 if(!m||m.format!=='yespark-backup'||m.version!==1||m.source!==baseUrl(base))fail('Backup incompativel ou de outro projeto.');
 const t=await get('tables.json');if(await hash(t)!==m.tablesHash)fail('Integridade dos dados invalida.');
 const tables=JSON.parse(dec.decode(t));checkTables(tables);checkMedia(m.media);checkReferences(tables,m.media,base);
 if(names.size!==m.media.length+2)fail('Inventario ZIP divergente.');
 const files=new Map();
 for(const x of m.media){const data=await get('media/'+x.name);if(data.length!==x.size||imageType(data)!==x.type||await hash(data)!==x.sha256)fail('Integridade da imagem invalida: '+x.name);files.set(x.name,data)}
 return {manifest:m,tables,files};
}
function mount(ctx){
 const panel=document.getElementById('yespark-backup-panel');if(!panel)return;
 const status=panel.querySelector('[data-backup-status]'),input=panel.querySelector('input[type=file]'),buttons=Array.from(panel.querySelectorAll('button'));
 let busy=false;
 const say=t=>{status.textContent=t};
 function requireAdmin(){if(!ctx.authorized()||!ctx.client())fail('Entre com uma conta administrativa conectada.');return ctx.client()}
 async function rpc(n,p){const {data,error}=await requireAdmin().rpc(n,p);if(error)throw Error(error.message);return data}
 const snapshot=()=>rpc('yespark_export_backup');
 async function download(name){const {data,error}=await requireAdmin().storage.from('yespark-media').download(name);if(error||!data)fail('Nao foi possivel baixar '+name);return bytes(await data.arrayBuffer())}
 const count=t=>TABLES.reduce((n,k)=>n+t[k].length,0);
 const summary=r=>Object.values(r).reduce((a,v)=>({inserted:a.inserted+v.inserted,skipped:a.skipped+v.skipped}),{inserted:0,skipped:0});
 async function restorePlan(archive,live){
 const existing=new Map(live.media.map(x=>[x.name,x])),missing=[];
 for(const x of archive.manifest.media){if(existing.has(x.name)){if(await hash(await download(x.name))!==x.sha256)fail('Imagem existente diferente: '+x.name+'. Nenhum arquivo sera substituido.')}else missing.push(x)}
 return missing;
 }
 async function run(action){
 if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);input.disabled=true;let uploaded=0;
 try{
 requireAdmin();const base=ctx.base();
 if(action==='export'){
 say('Consultando todos os registros e arquivos...');
 const before=await snapshot(),archive=await buildArchive(before,base,download,(n,total)=>say('Baixando imagens: '+n+' de '+total+'...'));
 const after=await snapshot();if(JSON.stringify(before)!==JSON.stringify(after))fail('Dados alterados durante o backup. Tente novamente quando nao houver edicoes.');
 requireAdmin();
 const blob=new Blob([archive],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='yespark-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 say('ZIP gerado: '+count(before.tables)+' registros e '+before.media.length+' imagens. Confira a pasta Downloads e guarde em local seguro.');
 }else{
 if(!input.files?.[0])fail('Selecione um arquivo ZIP gerado pelo Yes! Park.');
 say('Verificando estrutura e integridade SHA-256...');
 const archive=await readArchive(input.files[0],base),live=await snapshot();
 say('Comparando imagens e validando restauracao sem gravar...');
 const missing=await restorePlan(archive,live);
 const plan=summary(await rpc('yespark_restore_backup',{p_tables:archive.tables,p_apply:false}));
 say('Backup valido. '+plan.inserted+' registros novos, '+plan.skipped+' existentes preservados, '+missing.length+' imagens a recuperar.');
 if(action==='verify')return;
 if(!confirm('Restaurar '+plan.inserted+' registros ausentes e '+missing.length+' imagens? Registros e imagens existentes nao serao sobrescritos. Configuracoes existentes permanecem.'))return;
 if(prompt('Digite RESTAURAR para confirmar:')!=='RESTAURAR'){say('Restauracao cancelada.');return}
 for(const x of missing){
 requireAdmin();say('Restaurando imagens: '+uploaded+' de '+missing.length+'...');
 const {error}=await requireAdmin().storage.from('yespark-media').upload(x.name,new Blob([archive.files.get(x.name)],{type:x.type}),{contentType:x.type,upsert:false});
 if(error)fail('Falha ao recuperar imagem '+x.name+'. Tente novamente sem sobrescrever.');
 uploaded++;
 }
 const result=summary(await rpc('yespark_restore_backup',{p_tables:archive.tables,p_apply:true}));
 say('Restauracao concluida: '+result.inserted+' registros adicionados, '+result.skipped+' preservados e '+uploaded+' imagens recuperadas.');
 input.value='';await ctx.onRestore();
 }
 }catch(e){say((e?.message||'Operacao indisponivel.')+(uploaded?' '+uploaded+' imagens foram recuperadas antes da falha; repetir e seguro.':''));}
 finally{busy=false;buttons.forEach(b=>b.disabled=false);input.disabled=false}
 }
 panel.querySelector('[data-backup-export]').addEventListener('click',()=>run('export'));
 panel.querySelector('[data-backup-verify]').addEventListener('click',()=>run('verify'));
 panel.querySelector('[data-backup-restore]').addEventListener('click',()=>run('restore'));
}
global.YesparkBackup={mount,buildArchive,readArchive,preflight};
})(typeof window!=='undefined'?window:globalThis);
