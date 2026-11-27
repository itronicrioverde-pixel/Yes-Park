import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const respond=(status:number,obj:unknown)=>new Response(JSON.stringify(obj),{
 status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async (req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return respond(405,{error:'Método não permitido.'});
 const url=Deno.env.get('SUPABASE_URL');
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!serviceKey)return respond(503,{error:'Serviço temporariamente indisponível.'});
 let textBody:string;
 try {textBody=await req.text();if(textBody.length>4096)return respond(413,{error:'Avaliação muito extensa.'});}
 catch{return respond(400,{error:'Não foi possível ler a avaliação.'})}
 let body:Record<string,unknown>;
 try{body=JSON.parse(textBody)}catch{return respond(400,{error:'Dados inválidos.'})}
 if(!body||typeof body!=='object'||Array.isArray(body))return respond(400,{error:'Dados inválidos.'});
 const listing_id=body.listing_id;
 const display_name=typeof body.display_name==='string'?body.display_name.trim():'';
 const comment=typeof body.comment==='string'?body.comment.trim():'';
 const stars=body.stars;
 if(typeof listing_id!=='string'||!uuid.test(listing_id)||display_name.length<2||display_name.length>50||comment.length<10||comment.length>450||!Number.isInteger(stars)||Number(stars)<1||Number(stars)>5)
   return respond(400,{error:'Preencha seu nome (2 a 50 caracteres), comentário (10 a 450 caracteres) e uma nota de 1 a 5 estrelas.'});
 // O gateway fornece o endereço de origem. Não aceitamos endereço IP no corpo enviado pelo usuário.
 // Essa limitação básica não substitui o Turnstile, adiado para uma fase posterior.
 const clientIp=(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '').trim();
 if(!clientIp)return respond(503,{error:'Não foi possível validar a origem do envio. Tente novamente mais tarde.'});
 // Token privativo da função (nunca enviado ao navegador); evita armazenar IPs em texto claro.
 const salt=Deno.env.get('REVIEW_FINGERPRINT_SALT')||serviceKey;
 const data=new TextEncoder().encode('yespark-review-v1:'+salt+':'+clientIp);
 const digest=await crypto.subtle.digest('SHA-256',data);
 const fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 const supabase=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await supabase.rpc('submit_yespark_review',{
   p_listing_id:listing_id,p_display_name:display_name,p_comment:comment,p_stars:Number(stars),p_fingerprint:fingerprint
 });
 if(error){
  console.error('Erro ao registrar avaliação',error.code);
  if(error.code==='P0001')return respond(429,{error:'Não foi possível enviar. Confira se a empresa está ativa ou tente novamente mais tarde.'});
  return respond(503,{error:'Não foi possível registrar sua avaliação agora.'});
 }
 return respond(202,{ok:true,message:'Sua avaliação foi recebida e aguarda aprovação da administração.'});
});
