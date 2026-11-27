// Disaster recovery ONLY to an empty, separate Supabase project.
// No service_role key or production credentials are required.
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
globalThis.JSZip=require('../js/vendor/jszip-3.10.1.min.js');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
await import('../js/backup.js');
const SOURCE='https://ajerazedcephwtpwxnvl.supabase.co';
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const fail=m=>{throw Error(m)};
const ok=(r,m)=>{if(r.error)fail(m+': '+(r.error.code||r.error.message));return r.data};
const validateTarget=url=>{
 const u=new URL(url);
 if(u.origin!==url||u.origin===SOURCE||!(u.protocol==='https:'&&/^[a-z0-9]+\.supabase\.co$/.test(u.hostname)||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))fail('Destino inválido ou igual à produção.');
 return u.origin;
};
export async function restoreFreshProject({file,targetUrl,key,email,password,apply=false,source=SOURCE}){
 const target=validateTarget(targetUrl);
 if(!key||!key.startsWith('sb_publishable_')&&JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role!=='anon')fail('Use apenas a chave pública do novo projeto.');
 if((await stat(file)).size>200*1024*1024)fail('ZIP acima de 200 MB.');
 const bytes=await readFile(file);
 const archive=await globalThis.YesparkBackup.readArchive(new Blob([bytes]),source);
 const admin=createClient(target,key,opts);
 try{
  const auth=ok(await admin.auth.signInWithPassword({email,password}),'Login no destino');
  if(!auth.user)fail('Conta inválida.');
  const live=ok(await admin.rpc('yespark_export_backup'),'Verificação do destino');
  if(['listing_categories','listings','ads','banners','reviews'].some(t=>live.tables[t].length)||live.media.length)fail('O destino não está vazio. Restauração integral recusada para preservar dados existentes.');
  if(live.tables.site_settings.length!==1||live.tables.legal_contact.length!==1)fail('Estrutura do destino não corresponde ao schema esperado.');
  const prefix=source+'/storage/v1/object/public/yespark-media/';
  for(const t of ['listings','ads','banners'])for(const row of archive.tables[t])for(const k of ['image_url','profile_image_url']){
   if(typeof row[k]==='string'&&row[k].startsWith(prefix))row[k]=target+'/storage/v1/object/public/yespark-media/'+row[k].slice(prefix.length);
  }
  const plan=ok(await admin.rpc('yespark_restore_backup',{p_tables:archive.tables,p_apply:false}),'Simulação');
  console.log('Verificação concluída: '+Object.values(plan).reduce((a,v)=>a+v.inserted,0)+' registros novos, '+archive.manifest.media.length+' imagens, configurações iniciais a recuperar.');
  if(!apply)return plan;
  for(const m of archive.manifest.media)ok(await admin.storage.from('yespark-media').upload(m.name,new Blob([archive.files.get(m.name)],{type:m.type}),{contentType:m.type,upsert:false}),'Recuperação de mídia');
  const result=ok(await admin.rpc('yespark_restore_backup',{p_tables:archive.tables,p_apply:true}),'Recuperação de registros');
  for(const s of archive.tables.site_settings)ok(await admin.from('site_settings').update({enabled:s.enabled}).eq('key',s.key),'Configurações');
  for(const l of archive.tables.legal_contact)ok(await admin.from('legal_contact').update({controller_name:l.controller_name,contact_email:l.contact_email,updated_at:l.updated_at}).eq('id',1),'Privacidade');
  const restored=ok(await admin.rpc('yespark_export_backup'),'Verificação final');
  for(const t of Object.keys(archive.tables))if(restored.tables[t].length!==archive.tables[t].length)fail('Quantidade divergente em '+t);
  if(restored.media.length!==archive.manifest.media.length)fail('Quantidade de mídias divergente.');
  console.log('Restauração concluída no novo projeto. Valide o site antes de trocar o endereço de produção.');
  return result;
 }finally{try{await admin.auth.signOut({scope:'local'})}catch{}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2],apply=process.argv.includes('--apply');
 const targetUrl=process.env.YESPARK_RESTORE_URL,key=process.env.YESPARK_RESTORE_KEY,email=process.env.YESPARK_RESTORE_EMAIL,password=process.env.YESPARK_RESTORE_PASSWORD;
 if(!file||!targetUrl||!key||!email||!password){console.error('Informe ZIP e variáveis YESPARK_RESTORE_URL, YESPARK_RESTORE_KEY, YESPARK_RESTORE_EMAIL, YESPARK_RESTORE_PASSWORD. Sem --apply, apenas simula.');process.exitCode=1;}
 else try{await restoreFreshProject({file,targetUrl,key,email,password,apply})}catch(e){console.error('Restauração interrompida. '+(e?.message||'Erro desconhecido.')+' Se houve gravações parciais, recrie um destino vazio.');process.exitCode=1;}
}
