import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import vm from 'node:vm';
import {createClient} from '@supabase/supabase-js';
const url=process.env.API_URL, key=process.env.ANON_KEY, secret=process.env.SERVICE_ROLE_KEY;
assert(url==='http://127.0.0.1:54321'||url==='http://localhost:54321','Local API only');
assert(key&&secret,'Local keys required');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const svc=createClient(url,secret,options),client=()=>createClient(url,key,options);
const email='qa-admin@example.test',old='Old-'+randomBytes(16).toString('hex'),fresh='New-'+randomBytes(16).toString('hex');
const real=await svc.auth.admin.createUser({email,password:old,email_confirm:true});
assert(!real.error&&real.data.user,'Create test admin');const id=real.data.user.id;
try {
 const ins=await svc.from('admins').insert({user_id:id,active:true});assert(!ins.error,'Admin fixture');
 const login=client();let r=await login.auth.signInWithPassword({email,password:old});assert(!r.error&&r.data.user.id===id,'Real login');
 const check=await login.auth.getUser();assert(!check.error&&check.data.user.id===id,'Verified user');
 const role=await login.from('admins').select('user_id').eq('user_id',id).eq('active',true).maybeSingle();assert(!role.error&&role.data.user_id===id,'Admin role');console.log('PASS real login and admin role');
 const wrong=await client().auth.signInWithPassword({email,password:'wrong-password'});assert(wrong.error,'Wrong password must fail');console.log('PASS invalid password rejected');
 const anon=await client().from('admins').select('user_id');assert(anon.error||!anon.data?.length);console.log('PASS anonymous admin data blocked');
 const code=readFileSync('js/recovery.js','utf8');
 const ids=['heading','intro','message','request','forgot-email','account','password','done','current-wrap','current','new-password','confirm','show','request-form','password-form','email','account-email'];
 async function mount({hash='',search=''}={}){
  const els=Object.fromEntries(ids.map(id=>[id,{hidden:true,value:'',textContent:'',checked:false,type:'password',handlers:{},addEventListener(n,f){this.handlers[n]=f},querySelector(){return this.button||(this.button={textContent:'Enviar'})},reset(){}}]));
  const win={location:{hash,search,origin:'http://127.0.0.1:3000',pathname:'/recuperar.html'},history:{replaceState(){}},YES_PARK_CONFIG:{supabaseUrl:url,supabaseAnonKey:key},supabase:{createClient(u,k){return createClient(u,k,options)}}};
  await vm.runInNewContext(code,{document:{getElementById:id=>els[id]},window:win,Date,Map,Error,decodeURIComponent});
  return {els,submit:async id=>els[id].handlers.submit({preventDefault(){},currentTarget:els[id]})};
 }
 const req=await mount();assert(!req.els.request.hidden);req.els.email.value=email;await req.submit('request-form');assert(req.els.message.textContent.includes('receberá'),'Recovery request');
 let msg;
 for(let i=0;i<20;i++){
   const response=await fetch('http://127.0.0.1:54324/api/v1/messages');const list=await response.json();
   msg=list.messages?.find(m=>m.To?.some(x=>x.Address===email));
   if(msg)break;await new Promise(r=>setTimeout(r,1000));
 }
 assert(msg?.ID,'Recovery email received in Mailpit');console.log('PASS actual recovery email delivered to local inbox');
 const mail=await (await fetch('http://127.0.0.1:54324/api/v1/message/'+encodeURIComponent(msg.ID))).json();
 const raw=mail.HTML||mail.Text||'';const match=raw.match(/https?:\/\/[^"' <>\n]+\/auth\/v1\/verify\?[^"' <>\n]+/);
 assert(match,'Recovery link in message');const link=new URL(match[0].replace(/&amp;/g,'&'));
 assert(['127.0.0.1','localhost'].includes(link.hostname)&&link.port==='54321','Local link only');
 const verify=await fetch(link,{redirect:'manual'}),loc=verify.headers.get('location');assert(loc,'Recovery link redirect');
 const target=new URL(loc);assert(target.origin==='http://127.0.0.1:3000'&&target.pathname==='/recuperar.html'&&target.hash.includes('type=recovery'),'Recovery redirect correct');
 const reset=await mount({hash:target.hash,search:target.search});assert(!reset.els.password.hidden,'App accepts real recovery session');
 reset.els['new-password'].value=fresh;reset.els.confirm.value=fresh;await reset.submit('password-form');assert(!reset.els.done.hidden&&reset.els.heading.textContent==='Senha atualizada','App saves actual new password');console.log('PASS real recovery link accepted and password updated through app');
 const stale=await client().auth.signInWithPassword({email,password:old});assert(stale.error,'Old password rejected');
 const next=client();r=await next.auth.signInWithPassword({email,password:fresh});assert(!r.error&&r.data.user.id===id,'New password works');console.log('PASS new password accepted and old password rejected');
 const reuse=await fetch(link,{redirect:'manual'});const reused=reuse.headers.get('location')||'';assert(!reused.includes('access_token='),'Used recovery link rejected');console.log('PASS used recovery link cannot be reused');
 await next.auth.signOut({scope:'global'});
}finally{await svc.from('admins').delete().eq('user_id',id);await svc.auth.admin.deleteUser(id)}
console.log('PASS isolated test account removed');