
(()=>{'use strict';
// Encaminha callbacks de recuperação eventualmente redirecionados à página inicial.
const recoveryHash=new URLSearchParams(location.hash.slice(1)),recoveryQuery=new URLSearchParams(location.search);
if(recoveryHash.get('type')==='recovery'||(recoveryQuery.get('type')==='recovery'&&recoveryQuery.has('token_hash'))){const target=new URL('./recuperar.html',location.href);if(recoveryHash.get('type')==='recovery')target.hash=location.hash;else{target.searchParams.set('type','recovery');target.searchParams.set('token_hash',recoveryQuery.get('token_hash'))}location.replace(target.href);return}
const root=document.querySelector('#conecta');if(!root||root.dataset.version==='v2')return;root.dataset.version='v2';
const $=(s)=>root.querySelector(s), $$=(s)=>Array.from(root.querySelectorAll(s));
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmtDate=x=>{if(!x)return '';let d=new Date(x);return isNaN(d)?'':d.toLocaleDateString('pt-BR')};
const today=()=>new Date().toISOString().slice(0,10);const nowIso=()=>new Date().toISOString();const inputLocalDate=x=>{if(!x)return '';const d=new Date(x),z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,16)};
const code=window.YES_PARK_CONFIG||{};const LIVE=!!(code.supabaseUrl&&code.supabaseAnonKey);
const BIZ_CATS=['Tecnologia','Beleza','Alimentação','Moda','Casa & decoração','Educação','Outros'];
const SVC_CATS=['Elétrica','Limpeza','Ar-condicionado','Hidráulica','Reformas','Jardinagem','Outros'];
const ICONS={'Elétrica':'ϟ','Limpeza':'✦','Ar-condicionado':'❄','Hidráulica':'◉','Reformas':'▤','Jardinagem':'♧','Tecnologia':'▣','Beleza':'✿','Alimentação':'◈','Moda':'◇','Casa & decoração':'⌂','Educação':'▤','Outros':'✧'};
const STORE='yespark_admin_preview_v2';const DEFAULT_SETTINGS={show_home_promos:true};const EMPTY_LEGAL_CONTACT={controller_name:'',contact_email:'',updated_at:null};let client=null,session=null,admin=false,preview=false,tab='home',slide=0,filterPromo='Todas',filterBiz='Todos',filterSvc='Todos',rating=0,toastTimer,db={listings:[],ads:[],banners:[],reviews:[],categories:[],settings:{...DEFAULT_SETTINGS},legalContact:{...EMPTY_LEGAL_CONTACT}};

// Carga progressiva: somente o necessário na página inicial; catálogos paginados (16 por página).
const PAGE_SIZE=16,HOME_SIZE=8,ADMIN_PAGE_SIZE=80,REVIEW_PAGE_SIZE=25;
const homeRows={empresa:[],servico:[]};
const HOME_WINDOW=48;
const homePaging={empresa:{start:0,hasMore:false,loading:false},servico:{start:0,hasMore:false,loading:false}};
const catalogState={empresa:{items:[],page:0,hasMore:false,loaded:false,loading:false,token:0},servico:{items:[],page:0,hasMore:false,loaded:false,loading:false,token:0}};
let adminListings=[],adminLoaded=false,adminLoading=false;
const adminListPages={empresa:{hasMore:false,offset:0},servico:{hasMore:false,offset:0},reviews:{hasMore:false,offset:0}};
const publicReviews=new Map();
let categoriesLoaded=false,legalLoaded=false,promoHasMore=false,promoOffset=0;
function mergeListings(items){
 if(!items?.length)return;
 const byId=new Map(db.listings.map(v=>[String(v.id),v]));
 for(const item of items)byId.set(String(item.id),item);
 db.listings=Array.from(byId.values());if(LIVE&&db.listings.length>320)db.listings=db.listings.slice(-260);
}
function clearYesparkCache(){try{for(let i=sessionStorage.length-1;i>=0;i--){let k=sessionStorage.key(i);if(k&&k.startsWith('yp_public_v5:'))sessionStorage.removeItem(k)}}catch(_){} }
async function cachedPublic(key,fetcher,ttl=90000){
 if(!admin){try{const v=JSON.parse(sessionStorage.getItem('yp_public_v5:'+key));if(v&&Date.now()-v.t<ttl)return v.data;}catch(_){}}
 const result=await fetcher();if(result.error)throw Error(result.error.message||'Consulta indisponível');
 if(!admin){try{sessionStorage.setItem('yp_public_v5:'+key,JSON.stringify({t:Date.now(),data:result.data||[]}));}catch(_){}}
 return result.data||[];
}
async function ensureCategories(){
 if(!LIVE||categoriesLoaded||!client)return;
 try{db.categories=await cachedPublic('categories',()=>client.from('listing_categories').select('kind,name').order('name'),300000);categoriesLoaded=true;
 chip('#service-chips',['Todos',...categoriesFor('servico')],filterSvc,'service');chip('#business-chips',['Todos',...categoriesFor('empresa')],filterBiz,'biz');}
 catch(e){console.warn('Categorias não disponíveis',e)}
}
async function ensureLegal(){
 if(!LIVE||legalLoaded||!client)return;
 try{const result=await cachedPublic('legal',()=>client.from('legal_contact').select('controller_name,contact_email,updated_at').eq('id',1).maybeSingle(),180000);
 db.legalContact={...EMPTY_LEGAL_CONTACT,...(result||{})};legalLoaded=true;if(admin)renderLegalAdmin();}
 catch(e){console.warn('Contato de privacidade não disponível',e)}
}
function catalogSort(kind){return kind==='servico'?($('#sort-service')?.value||'rating'):'recent';}
function catalogFilter(kind){return kind==='servico'?filterSvc:filterBiz;}
function catalogSearch(kind){return String($(kind==='servico'?'#service-search':'#business-search')?.value||'').trim().slice(0,80);}
async function loadCatalog(kind,page=0){
 if(!LIVE||!client)return;
 const st=catalogState[kind],token=++st.token;
 st.loading=true;st.loaded=true;st.page=page;st.error=null;
 renderListingGrid(kind);
 const params={p_kind:kind,p_query:catalogSearch(kind),p_category:catalogFilter(kind)==='Todos'?null:catalogFilter(kind),p_sort:catalogSort(kind),p_limit:PAGE_SIZE+1,p_offset:page*PAGE_SIZE};
 try{
  const rows=await cachedPublic('catalog:'+JSON.stringify(params),()=>client.rpc('yespark_search_catalog',params),60000);
  if(token!==st.token)return;
  st.hasMore=rows.length>PAGE_SIZE;st.items=rows.slice(0,PAGE_SIZE);st.loading=false;st.error=null;
  mergeListings(st.items);renderListingGrid(kind);
 }catch(e){if(token!==st.token)return;st.loading=false;st.items=[];st.hasMore=false;st.error=e.message;renderListingGrid(kind);console.error(e)}
}
async function fetchAdminListPage(kind,reset=false){
 const page=adminListPages[kind];if(reset){page.offset=0;page.hasMore=false;adminListings=adminListings.filter(x=>x.kind!==kind)}
 const {data,error}=await client.from('listings').select('*').eq('kind',kind).order('created_at',{ascending:false}).range(page.offset,page.offset+ADMIN_PAGE_SIZE);
 if(error)throw Error(error.message);
 const rows=(data||[]);page.hasMore=rows.length>ADMIN_PAGE_SIZE;page.offset+=Math.min(ADMIN_PAGE_SIZE,rows.length);
 const map=new Map(adminListings.map(x=>[String(x.id),x]));for(const item of rows.slice(0,ADMIN_PAGE_SIZE))map.set(String(item.id),item);
 adminListings=Array.from(map.values());mergeListings(rows.slice(0,ADMIN_PAGE_SIZE));
}
async function fetchAdminReviewPage(reset=false){
 const page=adminListPages.reviews;if(reset){page.offset=0;page.hasMore=false;db.reviews=[]}
 const {data,error}=await client.from('reviews').select('*').order('created_at',{ascending:false}).range(page.offset,page.offset+ADMIN_PAGE_SIZE);
 if(error)throw Error(error.message);
 const rows=data||[];page.hasMore=rows.length>ADMIN_PAGE_SIZE;page.offset+=Math.min(ADMIN_PAGE_SIZE,rows.length);
 const m=new Map(db.reviews.map(x=>[String(x.id),x]));for(const r of rows.slice(0,ADMIN_PAGE_SIZE))m.set(String(r.id),r);
 db.reviews=Array.from(m.values());
}
async function loadAdminData(force=false){
 if(!LIVE||!client||!admin||adminLoading||adminLoaded&&!force)return;
 adminLoading=true;try{
  if(force){adminListings=[];adminLoaded=false}
  await Promise.all([fetchAdminListPage('empresa',true),fetchAdminListPage('servico',true),fetchAdminReviewPage(true),ensureCategories(),ensureLegal()]);
  adminLoaded=true;renderAdmin();
 }catch(e){console.error(e);toast('Não foi possível carregar os cadastros administrativos.');}
 finally{adminLoading=false}
}
async function loadMoreAdmin(kind){if(!admin||!LIVE||!client)return;
 try{if(kind==='reviews')await fetchAdminReviewPage();else await fetchAdminListPage(kind);renderAdmin()}catch(e){toast('Não foi possível carregar mais registros.');console.error(e)}
}
async function loadMorePromos(){
 if(!LIVE||!client||!promoHasMore)return;
 const {data,error}=await client.from('ads').select('*').order('created_at',{ascending:false}).range(promoOffset,promoOffset+50);
 if(error){toast('Não foi possível carregar propagandas.');return;}
 const rows=data||[];promoHasMore=rows.length>50;promoOffset+=Math.min(50,rows.length);
 const byId=new Map(db.ads.map(x=>[x.id,x]));for(const row of rows.slice(0,50))byId.set(row.id,row);
 db.ads=Array.from(byId.values());render();
}
async function getListing(pk){
 let l=ls(pk);if(l)return l;
 if(!LIVE||!client)return null;
 const {data,error}=await client.from('yespark_catalog_public').select('*').eq('id',pk).maybeSingle();
 if(error||!data)return null;mergeListings([data]);return data;
}
const IMG_BANNERS=window.YES_PARK_ORIGINAL_BANNERS||[];
const seed=()=>({listings:[{id:'sample-biz-1',kind:'empresa',name:'iTronic Rio Verde',category:'Tecnologia',description:'Produtos Apple, smartphones, acessórios e assistência técnica.',phone:'',image_url:'',active:true,sample:true},{id:'sample-biz-2',kind:'empresa',name:'Ateliê da Comunidade',category:'Casa & decoração',description:'Personalizados, presentes e decoração artesanal.',phone:'',image_url:'',active:true,sample:true},{id:'sample-biz-3',kind:'empresa',name:'Doce Cantinho',category:'Alimentação',description:'Doces, bolos e encomendas para suas comemorações.',phone:'',image_url:'',active:true,sample:true},{id:'sample-svc-1',kind:'servico',name:'Marcos Oliveira',category:'Elétrica',description:'Instalações elétricas, luminárias e pequenos reparos.',phone:'',image_url:'',active:true,sample:true},{id:'sample-svc-2',kind:'servico',name:'Ana Limpeza',category:'Limpeza',description:'Faxinas e organização residencial.',phone:'',image_url:'',active:true,sample:true},{id:'sample-svc-3',kind:'servico',name:'Paulo Encanador',category:'Hidráulica',description:'Vazamentos, torneiras e manutenção hidráulica.',phone:'',image_url:'',active:true,sample:true}],ads:[{id:'sample-ad-1',listing_id:'sample-biz-1',title:'Campanha da semana',description:'Precisa trocar a bateria ou a tela do iPhone? Consulte a iTronic para um orçamento.',period:'Semana',starts_at:null,ends_at:null,active:true,sample:true},{id:'sample-ad-2',listing_id:'sample-biz-2',title:'Promoção do dia',description:'Espaço ilustrativo para anunciar uma novidade ou condição especial.',period:'Hoje',starts_at:null,ends_at:null,active:true,sample:true},{id:'sample-ad-3',listing_id:'sample-biz-3',title:'Destaque do mês',description:'Espaço ilustrativo para mostrar produtos e ofertas durante o mês.',period:'Mês',starts_at:null,ends_at:null,active:true,sample:true}],banners:[{id:'sample-banner-1',title:'O aplicativo que vai facilitar seu dia a dia',image_url:'@original0',target_type:'servicos',target_id:null,sort_order:1,active:true,sample:true},{id:'sample-banner-2',title:'Conheça empresas da comunidade',image_url:'@original1',target_type:'empresas',target_id:null,sort_order:2,active:true,sample:true},{id:'sample-banner-3',title:'Tecnologia perto de você.',subtitle:'Conheça a iTronic Rio Verde: produtos Apple, acessórios e assistência técnica.',image_url:'',target_type:'empresa',target_id:'sample-biz-1',sort_order:3,active:true,sample:true}],settings:{...DEFAULT_SETTINGS},reviews:[{id:'sample-review-1',listing_id:'sample-svc-1',display_name:'Morador (exemplo)',stars:5,comment:'Serviço pontual e cuidadoso.',status:'approved',created_at:nowIso(),sample:true},{id:'sample-review-2',listing_id:'sample-svc-1',display_name:'Morador (exemplo)',stars:4,comment:'Boa experiência.',status:'approved',created_at:nowIso(),sample:true},{id:'sample-review-3',listing_id:'sample-svc-2',display_name:'Morador (exemplo)',stars:5,comment:'Muito caprichosa.',status:'approved',created_at:nowIso(),sample:true}]});
function getPreview(){try{const v=JSON.parse(localStorage.getItem(STORE));if(v&&Array.isArray(v.listings)&&Array.isArray(v.banners)&&Array.isArray(v.ads)&&Array.isArray(v.reviews))return {...v,categories:Array.isArray(v.categories)?v.categories:[],settings:{...DEFAULT_SETTINGS,...(v.settings||{})},legalContact:{...EMPTY_LEGAL_CONTACT,...(v.legalContact||{})}};}catch(_){}return {...seed(),categories:[],legalContact:{...EMPTY_LEGAL_CONTACT}}}
function savePreview(){try{localStorage.setItem(STORE,JSON.stringify({...db,settings:{...DEFAULT_SETTINGS,...(db.settings||{})},legalContact:db.legalContact||EMPTY_LEGAL_CONTACT}));}catch(_){toast('O navegador atingiu o limite de armazenamento desta prévia. Use imagens menores.') }}
function settings(){if(LIVE)return db.settings||DEFAULT_SETTINGS;let saved={};try{saved=JSON.parse(localStorage.getItem(STORE))?.settings||{}}catch(_){}db.settings={...DEFAULT_SETTINGS,...saved,...(db.settings||{})};return db.settings}
function id(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'p-'+Date.now()+'-'+Math.floor(Math.random()*10000)}
function ls(id){return db.listings.find(x=>String(x.id)===String(id))||adminListings.find(x=>String(x.id)===String(id))}
function categoriesFor(kind){
 const base=kind==='servico'?SVC_CATS:BIZ_CATS;
 const imported=(db.categories||[]).filter(x=>x.kind===kind).map(x=>x.name);
 const used=db.listings.filter(x=>x.kind===kind).map(x=>x.category);
 const items=[],seen=new Set();
 for(const value of [...base,...imported,...used]){
   const name=String(value||'').trim(),key=name.toLocaleLowerCase('pt-BR');
   if(name&&!seen.has(key)){items.push(name);seen.add(key)}
 }
 return items;
}
function normalizeInstagram(input){
 let value=String(input||'').trim();
 if(!value)return '';
 if(/^https?:\/\//i.test(value)||/^(www\.)?instagram\.com\//i.test(value)){
   if(!/^https?:\/\//i.test(value))value='https://'+value;
   let u;try{u=new URL(value)}catch{throw Error('Informe um Instagram válido.');}
   if(!/^(www\.)?instagram\.com$/i.test(u.hostname)||u.port||u.username||u.password)throw Error('Use somente um link de perfil do Instagram.');
   const segments=u.pathname.split('/').filter(Boolean);
   if(segments.length!==1)value='';else value=segments[0];
 }else value=value.replace(/^@/,'');
 if(!/^[A-Za-z0-9._]{1,30}$/.test(value))throw Error('Informe apenas @usuario ou um link de perfil válido do Instagram.');
 return value;
}
function instagramLink(item){
 let handle='';
 try{handle=normalizeInstagram(item.instagram||'')}catch{return ''}
 return handle?'<a class="btn primary social-link" href="https://www.instagram.com/'+encodeURIComponent(handle)+'/" target="_blank" rel="noopener noreferrer" aria-label="Instagram de '+esc(item.name)+'">Instagram ↗</a>':'';
}
function instagramCardAction(item){
 const link=instagramLink(item);
 // O terceiro botão aparece em todas as empresas, mas nunca inventa um perfil.
 return link||'<button class="btn social-unavailable" type="button" data-no-instagram title="Instagram não cadastrado para esta empresa" aria-label="Instagram ainda não cadastrado para '+esc(item.name)+'">Instagram</button>';
}
async function addCategory(form){
 if(!confirmAdmin())return;
 const kind=form.dataset.kind,field=form.elements.namedItem('category_new'),select=form.elements.namedItem('category');
 const name=String(field?.value||'').trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>45)throw Error('A categoria deve ter entre 2 e 45 caracteres.');
 if(!/^[\p{L}\p{N}][\p{L}\p{N} .&/()\-+]*$/u.test(name))throw Error('A categoria contém caracteres não permitidos.');
 const existing=categoriesFor(kind).find(x=>x.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));
 let saved=existing||name;
 if(!existing){
   if(LIVE){
     const {data,error}=await client.from('listing_categories').insert({kind,name}).select('kind,name').single();
     if(error)throw Error(error.code==='23505'?'Esta categoria já existe. Atualize a página para selecioná-la.':error.message);
     db.categories.push(data);saved=data.name;
   }else{db.categories.push({kind,name});savePreview()}
 }
 if(!Array.from(select.options).some(x=>x.value===saved))select.add(new Option(saved,saved));
 select.value=saved;
 const panel=form.querySelector('.category-add-panel');if(panel)panel.hidden=true;
 const plus=form.querySelector('[data-category-plus]');if(plus)plus.setAttribute('aria-expanded','false');
 if(field)field.value='';
 render();toast(existing?'Categoria já existente selecionada.':'Nova categoria adicionada e selecionada.');
}

function pub(x){return !!x.active}
function visibleAds(){let t=Date.now();return db.ads.filter(a=>a.active&&(!a.starts_at||new Date(a.starts_at).getTime()<=t)&&(!a.ends_at||new Date(a.ends_at).getTime()>=t)&&(LIVE||ls(a.listing_id)?.active))}
function visibleBanners(){return db.banners.filter(pub).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));}
function reviewsOf(id,approvedOnly=true){return db.reviews.filter(r=>String(r.listing_id)===String(id)&&(!approvedOnly||r.status==='approved'));}
function avg(item){if(LIVE&&item.rating_avg!==undefined)return Number(item.rating_avg)||0;let rs=reviewsOf(item.id);return rs.length?rs.reduce((s,r)=>s+Number(r.stars||0),0)/rs.length:0}
function stars(n){let r=Math.max(0,Math.min(5,Math.round(n||0)));return '<span class="rating">'+ '★'.repeat(r)+'☆'.repeat(5-r)+'</span>'}
function normTel(p){let s=String(p||'').replace(/\D/g,'');if(s.length===10||s.length===11)s='55'+s;return /^55\d{10,11}$/.test(s)?s:''}
function wa(item){let num=normTel(item.phone);if(!num)return '<button class="btn ghost" type="button" data-no-contact>Contato indisponível</button>';let txt=encodeURIComponent('Olá! Encontrei seu contato no Conecta Serviços do Yes! Park e gostaria de mais informações.');return '<a class="btn primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+num+'?text='+txt+'">WhatsApp ↗</a>'}
function actualImage(url){return (url==='@original0'||url==='assets/banner-1.webp')?IMG_BANNERS[0]:(url==='@original1'||url==='assets/banner-2.webp')?IMG_BANNERS[1]:url;}
function imageHtml(url,alt,cls='detail-image'){url=actualImage(url);return url?'<img class="'+cls+'" loading="lazy" decoding="async" src="'+esc(url)+'" alt="'+esc(alt||'Imagem')+'">':''}
const YESPARK_INCLUDED_PROFILE_LOGOS=Object.freeze({'fa0a5cfb-ff39-4830-adf5-95f1e1b88207':'./assets/logo-limpoou.webp'});
function listingAvatar(item){
 const type=['logo','proprietario','padrao'].includes(item.profile_image_type)?item.profile_image_type:'logo';
 const includedLogo=type==='logo'&&!item.profile_image_url?YESPARK_INCLUDED_PROFILE_LOGOS[String(item.id)]||'':'';
 const url=type==='padrao'?'':(item.profile_image_url||includedLogo||item.image_url||'');
 if(url){const role=type==='proprietario'?'avatar-owner':'avatar-logo';const alt=type==='proprietario'?'Foto do proprietário de ':'Logo ou foto de ';
  const customClass=includedLogo&&url===includedLogo?' is-brand-circle':'';
  return '<span class="avatar'+customClass+'">'+imageHtml(url,alt+item.name,'avatar-image '+role)+'</span>';
 }
 return '<span class="avatar" aria-hidden="true">'+esc(ICONS[item.category]||'✧')+'</span>';
}
function toast(msg){const el=$('#toast');el.textContent=msg;el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',4100)}
function chip(container,items,current,kind){let el=$(container);if(!el)return;el.innerHTML=items.map(n=>'<button class="chip '+(n===current?'active':'')+'" data-filter="'+kind+'" data-value="'+esc(n)+'">'+esc(n)+'</button>').join('')}
// Banner Limpoou aprovado pelo usuário, embutido no HTML para publicação GitHub Pages.
// A imagem só substitui o cadastro nas condições abaixo (card da seção inicial).
// Ao atualizar a imagem no painel administrativo futuramente, a substituição deixa de ser usada.
const YESPARK_LIMPOOU_BANNER_2048x682='./assets/banner-limpoou.webp';
function homeServiceBannerUrl(item){
 if(String(item.id)!=='fa0a5cfb-ff39-4830-adf5-95f1e1b88207'||item.kind!=='servico')return item.image_url;
 const link=String(item.image_url||'');
 if(link.includes('/logos/0cb6cc60-735e-4ddd-965d-8d84698d9c55.webp')||
    link.includes('/logos/aa0d6f4a-54a7-49b9-8f29-562a0ddf7abe.webp')){
   return YESPARK_LIMPOOU_BANNER_2048x682;
 }
 return item.image_url;
}
function listingCard(item,homeService=false){let rs=reviewsOf(item.id),count=LIVE&&item.rating_count!==undefined?Number(item.rating_count):rs.length,metric=count?stars(avg(item))+' '+avg(item).toFixed(1).replace('.',',')+' <span>('+count+' avaliações)</span>':'<span>☆ Sem avaliações</span>';const bannerUrl=homeService?homeServiceBannerUrl(item):item.image_url;return '<article class="card">'+(bannerUrl?imageHtml(bannerUrl,item.name,'detail-image'):'')+'<div class="card-head">'+listingAvatar(item)+'<div style="min-width:0"><div class="name">'+esc(item.name)+'</div><div class="hint">'+esc(item.category)+(item.sample?' · Exemplo':'')+'</div></div></div><p class="desc">'+esc(item.description)+'</p><div class="rating">'+metric+'</div><div class="card-actions"><button class="btn outline" data-listing="'+esc(item.id)+'">'+(item.kind==='servico'?'Avaliações':'Ver empresa')+'</button>'+wa(item)+instagramCardAction(item)+'</div></article>'}
function adCard(a){let owner=ls(a.listing_id);return '<article class="promo">'+(a.image_url?imageHtml(a.image_url,a.title,'ad-cover'):'')+'<div class="promo-kicker">'+esc(a.period||'Oferta')+' · PROPAGANDA'+(a.sample?' · EXEMPLO':'')+'</div><div class="promo-title">'+esc(a.title)+'</div><div class="promo-desc">'+esc(a.description)+'</div><div class="promo-bottom"><span class="meta">'+esc(owner?.name||'Empresa')+'</span><button class="btn ghost" data-ad="'+esc(a.id)+'">Ver anúncio →</button></div></article>'}
function renderHero(){let list=visibleBanners();const el=$('#home-hero');if(!list.length){el.className='hero';el.innerHTML='<div class="hero-content"><div class="eyebrow">YES! PARK</div><h1>Serviços perto de você.</h1><p>Encontre empresas e profissionais da comunidade.</p><button class="btn on-dark" data-tab="services">Ver profissionais →</button></div>';return;}slide=(slide+list.length)%list.length;let item=list[slide],navigation='<div class="hero-overlay-nav"><div class="banner-dots">'+list.map((_,i)=>'<button type="button" aria-label="Banner '+(i+1)+'" data-slide="'+i+'" class="'+(slide===i?'active':'')+'"></button>').join('')+'</div></div><button type="button" class="hero-next-arrow" data-banner-step="1" aria-label="Próximo banner" title="Próximo banner">›</button>';
if(item.image_url){
 const original1=['@original0','assets/banner-1.webp'].includes(item.image_url);
 const original2=['@original1','assets/banner-2.webp'].includes(item.image_url);
 if(original1||original2){
  // Usa a mesma área horizontal do destaque iTronic.
  // Recompõe a arte institucional com a logo original e os textos completos,
  // porque uma imagem original 16:9 não cabe inteira em uma faixa 4.3:1
  // sem ser reduzida demais, cortada ou distorcida.
  const logoSrc=document.querySelector('.condo-logo')?.getAttribute('src')||'';
  const title=original1?'O aplicativo que vai facilitar o seu dia a dia!':'Anuncie aqui <strong>sua empresa</strong>';
  const detail=original1?'Serviços, empresas, promoções e contato rápido em um só lugar.':'Divulgue seu negócio para os moradores do condomínio.';
  const eyebrow=original1?'RESIDENCIAL YES! PARK · CONECTA SERVIÇOS':'RESIDENCIAL YES! PARK · SUA EMPRESA EM DESTAQUE';
  const action=original1?'':'<button type="button" class="btn yp-wide-cta" data-banner-target="1">Saiba mais →</button>';
  el.className='hero hero-yespark-wide'+(original2?' yp-wide-ad':'');
  el.innerHTML='<img class="yp-wide-logo" src="'+esc(logoSrc)+'" alt="Logo Residencial Yes! Park">'+
  '<div class="yp-wide-copy"><span class="yp-wide-eyebrow">'+eyebrow+'</span>'+
  '<h1>'+title+'</h1><p>'+detail+'</p>'+
  action+'</div>'+navigation;
 }else{
  // Desktop: preserva a arte original. Celular: a mesma imagem sem distorção,
  // com legenda e CTA legíveis abaixo da arte (imagem 1600x370 é panorâmica).
  const bannerTitle=esc(item.title||'Conheça nossos destaques');
  const bannerDetail=esc(item.subtitle||'Confira este destaque da comunidade Yes! Park.');
  const actionLabel=item.target_type==='empresa'?'Ver empresa':item.target_type==='propagandas'?'Ver propagandas':item.target_type==='servicos'?'Ver serviços':item.target_type==='empresas'?'Ver empresas':'Conheça mais';
  const hasAction=item.target_type&&item.target_type!=='nenhuma';
  el.className='hero hero-banner hero-banner-responsive';
  el.innerHTML='<div class="yp-banner-visual"><img class="hero-banner-img" src="'+esc(actualImage(item.image_url))+'" alt="'+bannerTitle+'" data-banner-target="1"></div>'+
    '<div class="yp-banner-caption"><span class="yp-banner-caption-label">DESTAQUE · RESIDENCIAL YES! PARK</span><h2>'+bannerTitle+'</h2><p>'+bannerDetail+'</p>'+
    (hasAction?'<button type="button" class="btn primary" data-banner-target="1">'+actionLabel+' →</button>':'')+'</div>'+navigation;
 }
}
else{el.className='hero';let company=item.target_type==='empresa';el.innerHTML='<div class="hero-content"><div class="eyebrow">'+(company?'EMPRESA EM DESTAQUE':'DESTAQUE DO CONDOMÍNIO')+'</div><h1>'+esc(item.title)+'</h1><p>'+esc(item.subtitle||'Conheça os serviços e negócios dos moradores.')+'</p><button class="btn on-dark" data-banner-target="1">'+(company?'Conhecer a empresa':'Saiba mais')+' →</button></div><div class="hero-art">'+(company?'▣':'✧')+'</div>'+navigation;}}
function bannerClick(){let v=visibleBanners()[slide];if(!v)return;if(v.target_type==='servicos')switchTab('services');else if(v.target_type==='empresas')switchTab('businesses');else if(v.target_type==='empresa'&&ls(v.target_id)?.active)showListing(v.target_id);else if(v.target_type==='propagandas')switchTab('promos')}
function render(){renderHero();chip('#promo-chips',['Todas','Hoje','Semana','Mês'],filterPromo,'promo');chip('#service-chips',['Todos',...categoriesFor('servico')],filterSvc,'service');chip('#business-chips',['Todos',...categoriesFor('empresa')],filterBiz,'biz');const ads=visibleAds();$('#home-services').innerHTML=(LIVE?homeRows.servico:db.listings.filter(x=>x.kind==='servico'&&x.active).sort((a,b)=>avg(b)-avg(a))).slice(0,LIVE?HOME_WINDOW:HOME_SIZE).map(x=>listingCard(x,true)).join('')||'<p class="empty">Em breve, profissionais nesta área.</p>';$('#home-businesses').innerHTML=(LIVE?homeRows.empresa:db.listings.filter(x=>x.kind==='empresa'&&x.active)).slice(0,LIVE?HOME_WINDOW:HOME_SIZE).map(listingCard).join('')||'<p class="empty">Em breve, empresas nesta área.</p>';$('#promos-list').innerHTML=ads.filter(x=>filterPromo==='Todas'||x.period===filterPromo).map(adCard).join('')||'<p class="empty">Nenhuma propaganda nesta seleção.</p>';renderListingGrid('servico');renderListingGrid('empresa');$('#promo-pages').innerHTML=LIVE&&promoHasMore?'<button class="btn ghost" type="button" data-promo-more>Carregar mais anúncios ↓</button>':'';if(admin&&adminLoaded)renderAdmin();requestAnimationFrame(updateHomeCarouselArrows);}
function renderListingGrid(kind){
 let svc=kind==='servico',key=svc?'#service-search':'#business-search',target=svc?'#services-list':'#businesses-list',pages=$(svc?'#service-pages':'#business-pages');
 if(LIVE){
  const st=catalogState[kind];
  $(target).innerHTML=st.loading?'<p class="empty">Carregando cadastros...</p>':st.error?'<div class="empty"><p>Falha ao consultar o catálogo.</p><button type="button" class="btn ghost" data-catalog-page="'+kind+'" data-page="'+st.page+'">Tentar novamente</button></div>':!st.loaded?'<p class="empty">Abra esta seção para consultar os cadastros.</p>':st.items.length?st.items.map(x=>listingCard(x)).join(''):'<p class="empty">Nenhum resultado encontrado.</p>';
  if(svc)$('#services-count').textContent=st.loaded&&!st.loading?'Página '+(st.page+1)+' · '+st.items.length+' profissionais nesta página':'';
  pages.innerHTML=st.loaded&&!st.loading&&!st.error&&(st.page>0||st.hasMore)?'<button type="button" class="btn ghost" data-catalog-page="'+kind+'" data-page="'+(st.page-1)+'" '+(st.page===0?'disabled':'')+'>← Anterior</button><span class="hint">Página '+(st.page+1)+'</span><button type="button" class="btn ghost" data-catalog-page="'+kind+'" data-page="'+(st.page+1)+'" '+(!st.hasMore?'disabled':'')+'>Próxima →</button>':'';
  return;
 }
 const sel=svc?filterSvc:filterBiz,q=($(key)?.value||'').trim().toLocaleLowerCase('pt-BR');
 let arr=db.listings.filter(x=>x.kind===kind&&x.active&&(sel==='Todos'||x.category===sel)&&[x.name,x.category,x.description].join(' ').toLocaleLowerCase('pt-BR').includes(q));
 if(svc){let sort=$('#sort-service')?.value;arr.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'pt-BR'):sort==='count'?reviewsOf(b.id).length-reviewsOf(a.id).length:avg(b)-avg(a));$('#services-count').textContent=arr.length+' profissionais';}
 const st=catalogState[kind],totalPages=Math.max(1,Math.ceil(arr.length/PAGE_SIZE));st.page=Math.min(st.page,totalPages-1);
 $(target).innerHTML=arr.slice(st.page*PAGE_SIZE,(st.page+1)*PAGE_SIZE).map(x=>listingCard(x)).join('')||'<p class="empty">Nenhum resultado encontrado.</p>';
 pages.innerHTML=arr.length>PAGE_SIZE?'<button type="button" class="btn ghost" data-catalog-page="'+kind+'" data-page="'+(st.page-1)+'" '+(st.page===0?'disabled':'')+'>← Anterior</button><span class="hint">Página '+(st.page+1)+' de '+totalPages+'</span><button type="button" class="btn ghost" data-catalog-page="'+kind+'" data-page="'+(st.page+1)+'" '+(st.page>=totalPages-1?'disabled':'')+'>Próxima →</button>':'';
}
function switchTab(n){if(n==='admin'&&!admin)return;tab=n;$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===n));$$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+n));render();if(LIVE&&client){if(n==='services'||n==='businesses'){ensureCategories();let kind=n==='services'?'servico':'empresa';if(!catalogState[kind].loaded)loadCatalog(kind,0);}if(n==='admin')loadAdminData();}window.scrollTo({top:0,behavior:'instant'});}
const overlay=$('#overlay');const xBtn='<button type="button" class="x" aria-label="Fechar" data-close>×</button>';
function modal(html){overlay.innerHTML='<div class="modal" role="dialog" aria-modal="true">'+html+'</div>';overlay.classList.add('open');}
function close(){overlay.classList.remove('open');overlay.innerHTML='';rating=0;}
async function showListing(pk){let l=await getListing(pk);if(!l||!l.active)return;let ads=visibleAds().filter(x=>String(x.listing_id)===String(pk));modal('<div class="modal-head"><div class="listing-title-avatar">'+listingAvatar(l)+'<div><h3>'+esc(l.name)+'</h3><p class="hint">'+esc(l.category)+(l.sample?' · Exemplo':'')+'</p></div></div>'+xBtn+'</div>'+imageHtml(l.image_url,l.name)+'<p class="desc" style="font-size:13px">'+esc(l.description)+'</p><div class="rating-card">'+wa(l)+instagramLink(l)+'<button class="btn outline" data-reviews="'+esc(l.id)+'">★ Ver avaliações ('+reviewsOf(l.id).length+')</button></div><h4>Propagandas desta empresa</h4>'+(ads.map(x=>'<div class="inset" style="margin:9px 0"><strong>'+esc(x.title)+'</strong><p class="hint">'+esc(x.description)+'</p><button class="btn ghost" data-ad="'+esc(x.id)+'">Ver oferta</button></div>').join('')||'<p class="helper">Sem promoções no momento.</p>'))}
async function showAd(pk){let a=db.ads.find(x=>String(x.id)===String(pk));if(!a||!visibleAds().some(x=>x.id===a.id))return;let l=await getListing(a.listing_id);modal('<div class="modal-head"><div><span class="promo-kicker">'+esc(a.period)+' · PROPAGANDA'+(a.sample?' · EXEMPLO':'')+'</span><h3>'+esc(a.title)+'</h3><p class="hint">'+esc(l?.name||'Empresa')+'</p></div>'+xBtn+'</div>'+imageHtml(a.image_url,a.title,'ad-detail-image')+'<p class="desc" style="font-size:14px">'+esc(a.description)+'</p><div class="form-buttons">'+(l?wa(l)+instagramLink(l):'')+(l?'<button class="btn outline" data-listing="'+esc(l.id)+'">Ver empresa</button>':'')+'</div>')}
async function fetchPublicReviews(pk,more=false){
 if(!LIVE)return {rows:reviewsOf(pk),hasMore:false};
 const current=more?(publicReviews.get(String(pk))?.rows||[]):[];
 const start=current.length;
 const {data,error}=await client.from('reviews').select('id,listing_id,display_name,comment,stars,status,created_at').eq('listing_id',pk).eq('status','approved').order('created_at',{ascending:false}).range(start,start+REVIEW_PAGE_SIZE);
 if(error)throw Error(error.message);
 const fetched=data||[],rows=current.concat(fetched.slice(0,REVIEW_PAGE_SIZE));
 const value={rows,hasMore:fetched.length>REVIEW_PAGE_SIZE};publicReviews.set(String(pk),value);return value;
}
function reviewRowsHtml(rows){return rows.map(r=>'<div class="review"><strong>'+esc(r.display_name)+'</strong> <span class="rating">'+stars(r.stars)+'</span><p>'+esc(r.comment)+'</p></div>').join('')}
async function reviewsModal(pk){
 const l=await getListing(pk);if(!l||!l.active)return;
 rating=0;let value={rows:reviewsOf(pk),hasMore:false};
 if(LIVE){modal('<div class="modal-head"><h3>Avaliações · '+esc(l.name)+'</h3>'+xBtn+'</div><p class="helper">Carregando avaliações...</p>');
 try{value=await fetchPublicReviews(pk);}catch(e){console.error(e);value={rows:[],hasMore:false};toast('Falha ao carregar os comentários.');}}
 const rs=value.rows,count=LIVE&&l.rating_count!==undefined?Number(l.rating_count):rs.length;
 modal('<div class="modal-head"><div><h3>Avaliações · '+esc(l.name)+'</h3><p class="hint">Opiniões dos visitantes sobre esta empresa ou serviço</p></div>'+xBtn+'</div>'+ 
 '<div class="inset" style="margin:14px 0"><strong style="font-size:30px">'+(count?avg(l).toFixed(1).replace('.',','):'—')+'</strong> '+stars(avg(l))+' <span class="hint">('+count+' avaliações)</span></div>'+ 
 '<div id="yp-review-items">'+(rs.length?reviewRowsHtml(rs):'<p class="helper">Ainda não há avaliações publicadas.</p>')+'</div>'+ 
 '<div id="yp-review-more">'+(value.hasMore?'<button class="btn ghost" type="button" data-review-more="'+esc(l.id)+'">Carregar mais avaliações ↓</button>':'')+'</div>'+ 
 '<h4 style="margin-top:18px">Avaliar atendimento</h4>'+ 
 '<form id="review-form" data-id="'+esc(l.id)+'"><div class="stars-picker">'+[1,2,3,4,5].map(n=>'<button type="button" class="star" data-star="'+n+'" aria-label="'+n+' estrelas">★</button>').join('')+'</div>'+ 
 '<label class="field">Nome de exibição<input name="display_name" minlength="2" maxlength="50" required placeholder="Como deseja aparecer"></label>'+ 
 '<label class="field">Comentário<textarea name="comment" minlength="10" maxlength="450" rows="3" required placeholder="Conte como foi o atendimento"></textarea></label>'+ 
 '<label class="form-check"><input type="checkbox" required> Li e aceito as regras de avaliações e o aviso de privacidade.</label>'+ 
 '<p class="helper">'+(LIVE?'Sua avaliação será enviada para aprovação da administração antes de aparecer no site. Limite básico de 3 envios por hora por origem.':'Prévia local: as avaliações enviadas ficam pendentes até o administrador aprovar.')+'</p>'+ 
 '<button class="btn primary" style="width:100%" type="submit">Enviar avaliação para moderação</button></form>');
}
async function loadMoreReviews(pk){
 if(!LIVE||!client)return;const div=$('#yp-review-more');if(div)div.innerHTML='<p class="hint">Carregando...</p>';
 try{const old=publicReviews.get(String(pk))?.rows.length||0,val=await fetchPublicReviews(pk,true);
 const list=$('#yp-review-items');if(list&&val.rows.length>old){list.insertAdjacentHTML('beforeend',reviewRowsHtml(val.rows.slice(old)))}
 if(div)div.innerHTML=val.hasMore?'<button class="btn ghost" type="button" data-review-more="'+esc(pk)+'">Carregar mais avaliações ↓</button>':'';
 }catch(e){console.error(e);if(div)div.innerHTML='<button class="btn ghost" type="button" data-review-more="'+esc(pk)+'">Tentar novamente</button>'}
}
function confirmAdmin(){if(!admin){toast('Apenas a administração pode realizar alterações.');return false;}return true;}
function adminView(){$('#admin-mode-note').innerHTML=LIVE?'<strong>Conectado ao Supabase.</strong> Apenas administradores autorizados podem alterar os registros.':'<strong>Prévia local:</strong> conteúdo salvo apenas neste navegador, sem segurança de login. Não publique cadastros reais aqui.';let nav=$('#admin-tab');nav.hidden=!admin;$('#admin-entry').textContent=admin?'Administração':'Área administrativa';if(admin){switchTab('admin');}else switchTab('home')}
async function openAdmin(){if(admin){switchTab('admin');return;}if(!LIVE){modal('<div class="modal-head"><div><h3>Área administrativa</h3><p class="hint">Prévia local para conhecer e editar o painel.</p></div>'+xBtn+'</div><div class="admin-message warning" style="margin:14px 0"><strong>Atenção:</strong> sem Supabase este modo é uma demonstração, não tem autenticação segura e salva somente neste navegador. Não publique dados reais usando esta prévia.</div><button class="btn primary" style="width:100%" data-preview-admin>Abrir prévia do painel</button>');return;}
modal('<div class="modal-head"><div><h3>Acesso administrativo</h3><p class="hint">Exclusivo para administradores autorizados.</p></div>'+xBtn+'</div><form id="admin-login"><label class="field">E-mail administrativo<input type="email" name="email" required autocomplete="username"></label><label class="field">Senha<input type="password" name="password" required autocomplete="current-password" minlength="8"></label><button class="btn primary" style="width:100%">Entrar no painel</button><div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px 20px;margin:16px 0"><a href="./recuperar.html" style="color:#176044;font-size:13px;font-weight:700">Esqueci minha senha</a><a href="./recuperar.html?modo=email" style="color:#176044;font-size:13px;font-weight:700">Esqueci meu e-mail</a></div><p class="helper">Contas administrativas são cadastradas previamente no Supabase. Não existe cadastro público de administradores.</p></form>')}
async function initCloud(){
 if(!LIVE){db=getPreview();render();return;}
 try{
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.js');
  if(!window.supabase?.createClient)throw Error('Biblioteca indisponível.');
  client=window.supabase.createClient(code.supabaseUrl.replace(/\/$/,''),code.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data}=await client.auth.getSession();if(data.session)await verifyAdmin(data.session);
  await refreshCloud();
 }catch(e){console.error(e);$('#notice-mode').textContent='Não foi possível conectar ao banco. Confira a configuração do Supabase.';
 db={listings:[],ads:[],banners:[],reviews:[],categories:[],settings:{...DEFAULT_SETTINGS},legalContact:{...EMPTY_LEGAL_CONTACT}};render();}
}
function loadScript(src){return new Promise((resolve,reject)=>{let s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(Error('Falha ao carregar '+src));document.head.appendChild(s);})}
async function verifyAdmin(s){if(!client||!s)return false;let {data,error}=await client.from('admins').select('user_id').eq('user_id',s.user.id).eq('active',true).maybeSingle();admin=!error&&!!data;session=admin?s:null;$('#admin-tab').hidden=!admin;$('#admin-entry').textContent=admin?'Administração':'Área administrativa';return admin;}
async function refreshCloud(){
 if(!client)return;
 try{
  const [companies,services,ads,banners]=await Promise.all([
   cachedPublic('home:empresa',()=>client.rpc('yespark_search_catalog',{p_kind:'empresa',p_query:'',p_category:null,p_sort:'recent',p_limit:HOME_SIZE+1,p_offset:0}),60000),
   cachedPublic('home:servico',()=>client.from('yespark_catalog_public').select('*').eq('kind','servico').order('rating_avg',{ascending:false}).order('created_at',{ascending:false}).limit(HOME_SIZE+1),60000),
   cachedPublic('ads:first',()=>client.from('ads').select('*').order('created_at',{ascending:false}).range(0,50),60000),
   cachedPublic('banners',()=>client.from('banners').select('*').order('sort_order',{ascending:true}).limit(80),120000)
  ]);
  homePaging.empresa.start=0;homePaging.empresa.hasMore=companies.length>HOME_SIZE;
  homePaging.servico.start=0;homePaging.servico.hasMore=services.length>HOME_SIZE;
  homeRows.empresa=companies.slice(0,HOME_SIZE);homeRows.servico=services.slice(0,HOME_SIZE);
  mergeListings(homeRows.empresa.concat(homeRows.servico));
  promoHasMore=ads.length>50;promoOffset=Math.min(50,ads.length);
  db.ads=ads.slice(0,50);db.banners=banners;
  render();
  if(admin)await loadAdminData(true);
 }catch(e){console.error(e);toast('Erro ao carregar dados do Supabase. Confira a conexão.');render()}
}
async function persist(table,record,editing){if(!confirmAdmin())return false;if(!LIVE){let arr=db[table];if(editing){let i=arr.findIndex(x=>String(x.id)===String(editing));if(i<0)throw Error('Item não encontrado');arr[i]={...arr[i],...record};}else{arr.unshift({...record,id:id()})}savePreview();render();return true;}let query=editing?client.from(table).update(record).eq('id',editing).select():client.from(table).insert(record).select();const {error}=await query;if(error)throw Error(error.message);clearYesparkCache();await refreshCloud();if(catalogState.empresa.loaded)await loadCatalog('empresa',catalogState.empresa.page);if(catalogState.servico.loaded)await loadCatalog('servico',catalogState.servico.page);return true;}
async function remove(table,pk){if(!confirmAdmin())return;if(!LIVE){db[table]=db[table].filter(x=>String(x.id)!==String(pk));if(table==='listings'){db.ads=db.ads.filter(x=>String(x.listing_id)!==String(pk));db.reviews=db.reviews.filter(x=>String(x.listing_id)!==String(pk));}savePreview();render();return;}let {error}=await client.from(table).delete().eq('id',pk);if(error)throw Error(error.message);clearYesparkCache();await refreshCloud()}
async function toggle(table,pk){let item=db[table].find(x=>String(x.id)===String(pk));if(!item)return;await persist(table,{active:!item.active},pk)}
async function updateReview(pk,status){if(!confirmAdmin())return;if(!LIVE){let r=db.reviews.find(x=>String(x.id)===String(pk));if(r)r.status=status;savePreview();render();return;}let {error}=await client.from('reviews').update({status}).eq('id',pk);if(error)throw Error(error.message);clearYesparkCache();await refreshCloud()}
async function deleteReview(pk){if(!confirmAdmin())return;if(!LIVE){db.reviews=db.reviews.filter(r=>String(r.id)!==String(pk));savePreview();render();return;}let {error}=await client.from('reviews').delete().eq('id',pk);if(error)throw Error(error.message);clearYesparkCache();await refreshCloud()}
async function processImage(file,purpose){
 if(!file)return '';
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Envie uma imagem PNG, JPEG ou WebP.');
 if(file.size>8*1024*1024)throw Error('O arquivo original deve ter no máximo 8 MB.');
 const bmp=await createImageBitmap(file);
  try {
    if(bmp.width>9000||bmp.height>9000||bmp.width*bmp.height>36000000)
      throw Error('Imagem muito grande em pixels. Reduza a resolução antes de enviar.');
   const canvas=document.createElement('canvas');
   const avatarPurpose=purpose==='profile-logo'||purpose==='profile-owner';
    const max=(purpose==='logo'||avatarPurpose)?512:1600;
    const cap=avatarPurpose?512*1024:(purpose==='logo'?1024*1024:2*1024*1024);
   if(purpose==='banner'){
     // Mesmo enquadramento real do Yes! Park: toda a faixa, de ponta a ponta.
     // O redimensionamento preserva as informações da arte inteira, sem corte,
     // faixas, moldura ou fundo desfocado. Proporções diferentes se alongam.
     const w=1600,h=370,ctx=canvas.getContext('2d');
     canvas.width=w; canvas.height=h;
     ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
     ctx.drawImage(bmp,0,0,w,h);
    }else if(avatarPurpose){
      // Logo: mostra a imagem inteira, sem deformar nem alterar suas cores.
      // Foto do proprietário: retrato quadrado, com foco central.
      canvas.width=440;canvas.height=440;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(purpose==='profile-owner'){
        const side=Math.min(bmp.width,bmp.height);
        const x=(bmp.width-side)/2,y=(bmp.height-side)/2;
        ctx.drawImage(bmp,x,y,side,side,0,0,440,440);
      }else{
        const ratio=Math.min(440/bmp.width,440/bmp.height);
        const w=Math.max(1,Math.round(bmp.width*ratio)),h=Math.max(1,Math.round(bmp.height*ratio));
        ctx.drawImage(bmp,Math.round((440-w)/2),Math.round((440-h)/2),w,h);
      }
    }else{
     const scale=Math.min(1,max/Math.max(bmp.width,bmp.height));
     canvas.width=Math.max(1,Math.round(bmp.width*scale));
     canvas.height=Math.max(1,Math.round(bmp.height*scale));
     canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);
   }
   let quality=.84,blob;
   do{blob=await new Promise(r=>canvas.toBlob(r,'image/webp',quality));quality-=.12;}
   while(blob&&blob.size>cap&&quality>=.25);
   if(!blob||blob.size>cap)throw Error('Não foi possível reduzir a imagem para o tamanho permitido.');
   return blob;
 }finally{bmp.close?.();}
}
async function mediaUrl(file,purpose){if(!file||!file.size)return null;let blob=await processImage(file,purpose);if(!LIVE){let data=await new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});return data;}let folder=purpose==='banner'?'banners':purpose==='logo'?'logos':purpose.startsWith('profile-')?'avatars':'promos';let path=folder+'/'+id()+'.webp';let {error}=await client.storage.from('yespark-media').upload(path,blob,{contentType:'image/webp',upsert:false});if(error)throw Error(error.message);return client.storage.from('yespark-media').getPublicUrl(path).data.publicUrl;}
function listingForm(kind='empresa',pk=''){
 if(!confirmAdmin())return;
 let x=pk?ls(pk):null;kind=x?.kind||kind;
 const cats=categoriesFor(kind);
 modal('<div class="modal-head"><div><h3>'+(x?'Editar':'Cadastrar')+' '+(kind==='servico'?'prestador':'empresa')+'</h3><p class="hint">Visível no catálogo quando estiver ativo.</p></div>'+xBtn+'</div>'+
 '<form id="listing-form" data-id="'+esc(pk)+'" data-kind="'+kind+'">'+
 '<label class="field">Nome<input name="name" value="'+esc(x?.name||'')+'" required maxlength="75"></label>'+
 '<div class="field"><label for="listing-category">Categoria</label><div class="category-control"><select id="listing-category" name="category" required>'+cats.map(c=>'<option value="'+esc(c)+'" '+(x?.category===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select><button type="button" class="btn primary category-plus" aria-label="Adicionar categoria" title="Adicionar categoria" aria-expanded="false" data-category-plus>+</button></div>'+
 '<div class="category-add-panel" hidden><input type="text" name="category_new" maxlength="45" placeholder="Nome da nova categoria" aria-label="Nova categoria"><button type="button" class="btn primary" data-category-add>Adicionar</button></div><small class="helper">Use + para criar outra categoria neste tipo de cadastro.</small></div>'+
 '<label class="field">Descrição<textarea name="description" maxlength="400" rows="3" required>'+esc(x?.description||'')+'</textarea></label>'+
 '<label class="field">WhatsApp com DDD<input name="phone" inputmode="tel" placeholder="(64) 99999-9999" value="'+esc(x?.phone||'')+'"></label>'+
 '<label class="field">Instagram (opcional)<input name="instagram" type="text" maxlength="100" placeholder="@usuario ou instagram.com/usuario" value="'+esc(x?.instagram||'')+'" autocomplete="off"><small class="helper">Aparecerá como botão ao lado do WhatsApp.</small></label>'+
 '<label class="field">Imagem principal do cadastro (opcional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"><small class="helper">Imagem maior que aparece acima da descrição da empresa.</small></label>'+ 
 (x?.image_url?imageHtml(x.image_url,x.name,'cover-small'):'')+
 '<div class="field"><label for="profile-image-type">Imagem do ícone do cadastro</label><select id="profile-image-type" name="profile_image_type">'+[
  ['logo','Logo da empresa'],['proprietario','Foto do proprietário'],['padrao','Manter ícone padrão']
 ].map(([v,label])=>'<option value="'+v+'" '+((x?.profile_image_type||'logo')===v?'selected':'')+'>'+label+'</option>').join('')+'</select></div>'+ 
 '<label class="field">Enviar logo ou foto para o ícone<input name="profile_image" type="file" accept="image/png,image/jpeg,image/webp"><small class="helper">A imagem escolhida aparece no quadrinho ao lado do nome. Logo sem corte; foto do proprietário quadrada. Se não enviar, será usada a imagem principal, quando disponível.</small></label>'+ 
 (x?'<div class="profile-image-preview">'+listingAvatar(x)+'<span>Prévia do ícone atual</span></div>':'')+
 '<label class="form-check"><input name="active" type="checkbox" '+(!x||x.active?'checked':'')+'> Publicar no catálogo</label>'+
 '<label class="form-check"><input name="authorized" type="checkbox" required> Confirmo que existe autorização para divulgar este contato e estas imagens.</label>'+
 '<div class="form-buttons"><button class="btn primary">Salvar '+(kind==='servico'?'prestador':'empresa')+'</button><button type="button" class="btn outline" data-close>Cancelar</button></div></form>');
}
function adForm(pk=''){if(!confirmAdmin())return;let x=pk?db.ads.find(y=>String(y.id)===String(pk)):null;let list=db.listings.filter(l=>l.active);if(!list.length){toast('Cadastre uma empresa ou prestador primeiro.');return;}modal('<div class="modal-head"><div><h3>'+(x?'Editar':'Nova')+' propaganda</h3><p class="hint">Data de publicação, validade e imagem promocional.</p></div>'+xBtn+'</div><form id="ad-form" data-id="'+esc(pk)+'"><label class="field">Empresa / prestador<select name="listing_id" required>'+list.map(l=>'<option value="'+esc(l.id)+'" '+(x?.listing_id===l.id?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select></label><label class="field">Tipo<select name="period">'+['Hoje','Semana','Mês','Especial'].map(v=>'<option '+(x?.period===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label class="field">Título<input name="title" required maxlength="85" value="'+esc(x?.title||'')+'"></label><label class="field">Descrição<textarea name="description" required maxlength="450" rows="3">'+esc(x?.description||'')+'</textarea></label><div class="form-split"><label class="field">Início<input name="starts_at" type="datetime-local" value="'+(x?.starts_at?inputLocalDate(x.starts_at):'')+'"></label><label class="field">Fim<input name="ends_at" type="datetime-local" value="'+(x?.ends_at?inputLocalDate(x.ends_at):'')+'"></label></div><label class="field">Imagem (opcional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"><span class="helper">Padrão da propaganda: 3:1 (1200 × 400 px). Artes nesse formato encaixam perfeitamente, sem cortes.</span></label>'+(x?.image_url?imageHtml(x.image_url,x.title,'cover-small'):'')+'<label class="form-check"><input name="active" type="checkbox" '+(!x||x.active?'checked':'')+'> Propaganda habilitada</label><div class="form-buttons"><button class="btn primary">Salvar propaganda</button><button class="btn outline" type="button" data-close>Cancelar</button></div></form>')}
function bannerForm(pk=''){if(!confirmAdmin())return;let x=pk?db.banners.find(y=>String(y.id)===String(pk)):null;modal('<div class="modal-head"><div><h3>'+(x?'Editar':'Novo')+' banner</h3><p class="hint">Configure o destaque principal do site.</p></div>'+xBtn+'</div><form id="banner-form" data-id="'+esc(pk)+'"><label class="field">Título<input name="title" required maxlength="100" value="'+esc(x?.title||'')+'"></label><label class="field">Texto secundário (banner sem imagem)<textarea name="subtitle" maxlength="190" rows="2">'+esc(x?.subtitle||'')+'</textarea></label><label class="field">Imagem do banner (opcional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"><span class="helper banner-fit-help">Tamanho automático igual ao banner do Yes! Park: 1600 × 370 px. Preenche toda a largura, sem bordas, faixas ou cortes. Imagens com outra proporção podem ficar um pouco alongadas.</span></label><div class="banner-fit-preview" id="banner-fit-preview"><img alt="Prévia do banner padronizado"><div class="hint">Prévia do enquadramento automático antes de salvar.</div></div>'+(x?.image_url?imageHtml(x.image_url,x.title,'detail-image'):'')+'<div class="form-split"><label class="field">Ação no clique<select name="target_type">'+[['nenhuma','Nenhuma'],['servicos','Abrir serviços'],['empresas','Abrir empresas'],['propagandas','Abrir propagandas'],['empresa','Abrir empresa específica']].map(([v,n])=>'<option value="'+v+'" '+(x?.target_type===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label><label class="field">Ordem<input type="number" min="1" max="99" name="sort_order" value="'+Number(x?.sort_order||db.banners.length+1)+'"></label></div><label class="field">Empresa de destino (se necessário)<select name="target_id"><option value="">Nenhuma</option>'+db.listings.filter(l=>l.kind==='empresa').map(l=>'<option value="'+esc(l.id)+'" '+(x?.target_id===l.id?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select></label><label class="form-check"><input type="checkbox" name="active" '+(!x||x.active?'checked':'')+'> Exibir este banner</label><div class="form-buttons"><button class="btn primary">Salvar banner</button><button class="btn outline" type="button" data-close>Cancelar</button></div></form>')}
function adminRows(table,items){let arr=items||(table==='listings'?db.listings:table==='ads'?db.ads:db.banners);return arr.map(x=>{let name=x.name||x.title,extra=table==='listings'?(x.kind==='servico'?'Prestador':'Empresa')+' · '+x.category:table==='ads'?(ls(x.listing_id)?.name||'Sem vínculo')+' · '+x.period:'Posição '+x.sort_order;return '<div class="admin-row">'+(table==='listings'?listingAvatar(x):(x.image_url?imageHtml(x.image_url,name,'cover-small'):'<span class="avatar">✧</span>'))+'<div class="admin-row-body"><strong>'+esc(name)+'</strong><div class="hint">'+esc(extra)+' · '+(x.active?'Publicado':'Oculto')+'</div></div><div class="admin-buttons"><button class="btn outline" data-admin-edit="'+table+':'+esc(x.id)+'">Editar</button><button class="btn ghost" data-admin-toggle="'+table+':'+esc(x.id)+'">'+(x.active?'Ocultar':'Ativar')+'</button><button class="btn outline" data-admin-delete="'+table+':'+esc(x.id)+'">Excluir</button></div></div>'}).join('')||'<p class="helper">Ainda não existem registros.</p>'}

const LEGAL_POLICY_HTML = `
<p class="legal-muted"><strong>Versão:</strong> 28 de outubro de 2026 · Serviço em fase beta.</p>
<h4>1. Sobre este guia</h4>
<p>O Conecta Serviços — Yes! Park é um catálogo informativo de empresas, prestadores e contatos profissionais divulgados para publicidade comercial. A consulta é aberta e não exige cadastro de visitantes. Empresas, propagandas e imagens são cadastradas apenas por administradores autorizados, mediante confirmação de autorização para divulgação.</p>
<h4>2. Informações comerciais e avaliações</h4>
<ul><li><strong>Empresas e prestadores:</strong> nome comercial ou profissional, categoria, descrição, telefone/WhatsApp, perfil de Instagram quando informado, logo, imagens, promoções e data dos cadastros.</li><li><strong>Avaliações:</strong> nome de exibição fornecido pelo visitante, nota de 1 a 5, texto do comentário, referência à empresa e data do envio. Uma avaliação só se torna pública após a moderação.</li><li><strong>Administradores:</strong> e-mail, dados de autenticação e operações administrativas processados pelos serviços de autenticação e banco de dados. O aplicativo não exibe senhas.</li><li><strong>Informações técnicas:</strong> dados necessários para segurança, funcionamento e prevenção de abuso podem ser tratados pelos provedores de infraestrutura, incluindo registros técnicos de acesso e dados de rede.</li></ul>
<h4>3. Para quais finalidades</h4>
<p>Exibimos negócios e serviços, permitimos contato direto entre visitantes e prestadores, divulgamos anúncios autorizados, recebemos avaliações, moderamos conteúdo, mantemos o sistema funcionando e atendemos solicitações relativas aos dados pessoais. A base legal de cada tratamento deve observar a hipótese aplicável da LGPD, conforme a finalidade e as circunstâncias.</p>
<h4>4. Divulgação pública e compartilhamento</h4>
<p>Publicamos apenas os contatos e imagens destinados à divulgação profissional, para os quais haja autorização de publicação. Não exigimos CPF, RG, número de apartamento ou endereço residencial de empresários e prestadores. O nome do proprietário não precisa aparecer no cadastro. Porém, telefone profissional individual, Instagram e fotografia de pessoa identificável podem ser dados pessoais e continuam sujeitos à legislação. Os contatos comerciais publicados e as avaliações aprovadas podem ser vistos por qualquer pessoa que acessar o endereço do site, inclusive fora do condomínio.</p>
<p>Para funcionamento do sistema utilizamos infraestrutura do Supabase, cujo projeto atual está na região dos Estados Unidos (us-east-1), o que pode envolver tratamento internacional de dados. Serviços de hospedagem também podem processar registros técnicos. Clicar no WhatsApp ou no Instagram encaminha o visitante a plataformas externas, sujeitas às políticas dos respectivos fornecedores.</p>
<h4>5. Avaliações e moderação</h4>
<p>As avaliações devem descrever experiências de atendimento de boa-fé. Não publique números de documentos, dados de moradores, endereço residencial, informações sensíveis, ameaças, ofensas ou acusações sem fundamento. A equipe responsável pode rejeitar, ocultar ou remover conteúdo incompatível com estas regras. A moderação não comprova a identidade nem garante a veracidade do comentário.</p>
<h4>6. Conservação e segurança</h4>
<p>Os dados são mantidos pelo período necessário às finalidades descritas, ao atendimento dos direitos dos titulares e às obrigações legais aplicáveis. Os prazos de retenção e descarte devem ser estabelecidos por quem administra o tratamento de dados do guia. Utilizamos controle de acesso administrativo e regras de permissão no banco, sem prometer segurança absoluta.</p>
<h4>7. Seus direitos</h4>
<p>Você pode solicitar informações sobre o tratamento, confirmação, acesso, correção, anonimização ou eliminação quando cabível, informações sobre compartilhamentos e os demais direitos previstos no art. 18 da LGPD. Solicitações serão avaliadas conforme a legislação e eventuais obrigações de conservação. Para exercer seus direitos, utilize o canal de privacidade informado abaixo.</p>
<h4>8. Cookies e tecnologias</h4>
<p>A versão atual não implementa publicidade comportamental ou cadastro de visitantes. Serviços externos de hospedagem e autenticação podem utilizar recursos técnicos de navegação necessários ao funcionamento e à segurança. A administração pode utilizar armazenamento local para funcionalidades de prévia e preferências de sessão.</p>
<h4>9. Alterações neste documento</h4>
<p>Esta política poderá ser atualizada conforme as funcionalidades do aplicativo e os procedimentos efetivamente adotados. A versão atual estará sempre disponível no rodapé do site.</p>`;
const LEGAL_TERMS_HTML = `
<p class="legal-muted"><strong>Versão:</strong> 28 de outubro de 2026 · Serviço em fase beta.</p>
<h4>1. Finalidade do aplicativo</h4>
<p>O Conecta Serviços — Yes! Park funciona como um guia de empresas, profissionais e ofertas com contatos e avaliações. O acesso à consulta é gratuito e não exige cadastro dos moradores. O uso do nome do residencial não implica, por si só, que o aplicativo seja um canal oficial de sua administração ou que todas as empresas sejam recomendadas pelo condomínio.</p>
<h4>2. Contatos, produtos e serviços</h4>
<p>Empresas e prestadores são responsáveis pelos produtos, serviços, informações e condições que oferecem. O aplicativo facilita a divulgação e o contato; não participa automaticamente da contratação, do pagamento ou da execução dos serviços. Direitos previstos no Código de Defesa do Consumidor e demais normas aplicáveis permanecem preservados.</p>
<h4>3. Propagandas e disponibilidade</h4>
<p>Ofertas podem ter prazo, condições e estoque definidos pelo anunciante. É responsabilidade do interessado confirmar diretamente com o estabelecimento preço, disponibilidade, garantia e atendimento antes de contratar.</p>
<h4>4. Avaliações</h4>
<p>Ao enviar uma avaliação, o visitante declara que o conteúdo reflete sua experiência e que possui direito de publicá-lo. Comentários serão submetidos à moderação; podem ser recusados ou removidos se contiverem spam, conteúdo ofensivo, informações privadas de terceiros, discriminação, publicidade indevida ou violação de direitos. O visitante autoriza a publicação do nome de exibição, nota e comentário quando aprovados, respeitadas as regras de privacidade.</p>
<h4>5. Condutas não permitidas</h4>
<p>Não tente usar robôs para enviar avaliações em massa, falsificar relatos, invadir áreas administrativas, acessar dados sem autorização ou utilizar o guia para práticas ilícitas. Nenhum usuário deve divulgar dados de apartamentos, endereços residenciais, documentos pessoais ou informações sensíveis de terceiros.</p>
<h4>6. Atualização e correção de cadastros</h4>
<p>Empresas e profissionais devem fornecer somente informações comerciais e imagens cuja divulgação esteja autorizada. Não é obrigatório informar o nome civil de proprietários nem fornecer documentos pessoais para aparecer no catálogo. Pedidos de correção ou retirada de contatos, fotos e outros dados pessoais podem ser enviados ao canal indicado na Política de Privacidade. A administração poderá suspender anúncios incompatíveis com o guia, preservados os direitos legais.</p>
<h4>7. Disponibilidade e fase beta</h4>
<p>Este serviço está em testes e pode apresentar indisponibilidade, correções e mudanças. Serão empregados esforços razoáveis para manter as informações íntegras; isso não representa garantia de disponibilidade ininterrupta ou de exatidão de ofertas divulgadas por terceiros.</p>
<h4>8. Privacidade</h4>
<p>O tratamento de dados pessoais é descrito na Política de Privacidade acessível no rodapé do aplicativo. O link de WhatsApp abre um serviço externo, com regras próprias.</p>
<h4>9. Atualizações e contato</h4>
<p>Estes termos poderão ser revistos para refletir o funcionamento efetivo do projeto e alterações legais. Questões relacionadas a dados pessoais devem ser enviadas ao contato indicado abaixo.</p>`;
function getLegalContact(){return {...EMPTY_LEGAL_CONTACT,...(db.legalContact||{})}}
function legalContactCard(){const v=getLegalContact();const ready=!!(v.controller_name?.trim()&&v.contact_email?.trim());
  return '<div class="legal-contact-card'+(ready?'':' legal-contact-warning')+'"><strong>Administração dos dados do guia e canal de contato</strong>'+
    (ready?'<p><b>Controlador do guia:</b> '+esc(v.controller_name)+'</p><p><b>Contato:</b> <a href="mailto:'+esc(v.contact_email)+'">'+esc(v.contact_email)+'</a></p>':
      '<p>Identificação de quem administra os dados deste guia e contato para solicitações ainda não preenchidos. Não é necessário informar os proprietários de todas as empresas.</p>')+
  '</div>';}
function openLegalDoc(kind){let policy=kind==='privacy',title=policy?'Política de Privacidade':'Termos de Uso';
 modal('<div class="modal-head"><div><h3 id="legal-document-title">'+title+'</h3><p class="hint">Conecta Serviços · Residencial Yes! Park</p></div>'+xBtn+'</div>'+
 '<div class="legal-content">'+(policy?LEGAL_POLICY_HTML:LEGAL_TERMS_HTML)+legalContactCard()+'</div><div class="form-buttons"><button type="button" class="btn outline" data-close>Fechar</button></div>');
 const m=overlay.querySelector('.modal');if(m){m.classList.add('legal-dialog');m.setAttribute('aria-labelledby','legal-document-title');}}
function openLegalContact(){modal('<div class="modal-head"><div><h3 id="legal-document-title">Contato e proteção de dados</h3><p class="hint">Solicitações de acesso, correção e exclusão de dados pessoais</p></div>'+xBtn+'</div><div class="legal-content">'+legalContactCard()+'<p>Informe qual cadastro ou avaliação deseja consultar ou corrigir, evitando incluir documentos ou dados sensíveis desnecessários no primeiro contato.</p></div>');const m=overlay.querySelector('.modal');if(m){m.classList.add('legal-dialog');m.setAttribute('aria-labelledby','legal-document-title');}}
async function saveLegalContact(form){if(!confirmAdmin())return;const name=formValue(form,'controller_name'),email=formValue(form,'contact_email');
 if(name.length<3||name.length>160||email.length<6||email.length>254||!form.querySelector('[name="contact_email"]').checkValidity())throw Error('Preencha a identificação de quem controla os dados do guia e o e-mail de contato.');
 const record={controller_name:name,contact_email:email,updated_at:new Date().toISOString()};
 if(LIVE){if(!client)throw Error('Supabase indisponível.');const {data,error}=await client.from('legal_contact').update(record).eq('id',1).select('controller_name,contact_email,updated_at').single();if(error||!data)throw Error(error?.message||'Não foi possível salvar o contato.');db.legalContact={...EMPTY_LEGAL_CONTACT,...data};}
 else{db.legalContact=record;savePreview();}
 render();toast('Contato de privacidade atualizado para todos os visitantes.');}
function renderLegalAdmin(){const form=$('#legal-contact-form');if(!form)return;const info=getLegalContact();const name=form.elements.namedItem('controller_name'),email=form.elements.namedItem('contact_email');
 if(name)name.value=info.controller_name||'';if(email)email.value=info.contact_email||'';
 const ready=!!(info.controller_name&&info.contact_email);const state=$('#admin-legal-state');if(state){state.className='legal-state admin-message'+(ready?'':' warning');state.textContent=ready?'Identificação e canal de contato cadastrados. Confira se indicam quem efetivamente controla os dados do guia.':'Antes do lançamento: identifique quem controla os dados do guia e informe um e-mail para pedidos de correção ou remoção. Não é preciso cadastrar o nome do dono de cada empresa.';}}

function renderAdmin(){if(!admin)return;$('#admin-mode-note').innerHTML=LIVE?'<strong>Supabase conectado:</strong> cadastros e anúncios são compartilhados. A segurança depende das permissões configuradas no banco.':'<strong>Prévia local:</strong> dados guardados apenas neste navegador. O acesso ao painel não é seguro sem Supabase.';let source=LIVE?adminListings:db.listings,active=source.filter(pub),companies=source.filter(l=>l.kind==='empresa'),services=source.filter(l=>l.kind==='servico');$('#admin-stats').innerHTML=[['Empresas',active.filter(l=>l.kind==='empresa').length],['Prestadores',active.filter(l=>l.kind==='servico').length],['Promoções',visibleAds().length]].map(([k,v])=>'<div class="admin-stat"><strong>'+v+'</strong><small>'+k+'</small></div>').join('');$('#admin-company-list').innerHTML=adminRows('listings',companies)+(LIVE&&adminListPages.empresa.hasMore?'<button type="button" class="btn ghost" data-admin-more="empresa">Carregar mais empresas ↓</button>':'');$('#admin-service-list').innerHTML=adminRows('listings',services)+(LIVE&&adminListPages.servico.hasMore?'<button type="button" class="btn ghost" data-admin-more="servico">Carregar mais prestadores ↓</button>':'');$('#admin-ad-list').innerHTML=adminRows('ads');$('#admin-banner-list').innerHTML=adminRows('banners');let pending=db.reviews.filter(r=>r.status==='pending');$('#admin-review-list').innerHTML='<p class="hint">'+pending.length+' avaliações pendentes de moderação.</p>'+db.reviews.map(r=>'<div class="admin-row"><div class="admin-row-body"><strong>'+esc(ls(r.listing_id)?.name||'Cadastro removido')+' · '+r.stars+' ★</strong><div class="hint">'+esc(r.display_name)+' · '+esc(r.status)+' · '+fmtDate(r.created_at)+'</div><p class="desc">'+esc(r.comment)+'</p></div><div class="admin-buttons">'+(r.status!=='approved'?'<button class="btn primary" data-review-approve="'+esc(r.id)+'">Publicar</button>':'<button class="btn ghost" data-review-hide="'+esc(r.id)+'">Ocultar</button>')+'<button class="btn outline" data-review-delete="'+esc(r.id)+'">Excluir</button></div></div>').join('')+(LIVE&&adminListPages.reviews.hasMore?'<button type="button" class="btn ghost" data-admin-more="reviews">Carregar mais avaliações ↓</button>':'')||'<p class="helper">Nenhuma avaliação recebida.</p>';renderLegalAdmin();}
function formValue(form,key){return String(new FormData(form).get(key)||'').trim()}
function checkbox(form,key){return !!form.elements.namedItem(key)?.checked}
async function handleForm(form){const f=new FormData(form);if(form.id==='admin-login'){let email=formValue(form,'email'),password=formValue(form,'password');let {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw Error('Não foi possível entrar. Confira suas credenciais.');if(!await verifyAdmin(data.session)){await client.auth.signOut();throw Error('Conta sem autorização administrativa.');}close();adminView();toast('Acesso administrativo autorizado.');return;}
if(form.id==='legal-contact-form'){await saveLegalContact(form);return;}
if(form.id==='review-form'){
 if(!rating)throw Error('Selecione uma nota de 1 a 5 estrelas.');
 const content={listing_id:form.dataset.id,display_name:formValue(form,'display_name'),comment:formValue(form,'comment'),stars:rating};
 if(content.display_name.length<2||content.display_name.length>50||content.comment.length<10||content.comment.length>450)
  throw Error('Informe seu nome (2–50 caracteres) e comentário (10–450 caracteres).');
 if(!LIVE){
   db.reviews.unshift({...content,id:id(),status:'pending',created_at:nowIso()});
   savePreview();close();render();toast('Avaliação recebida na prévia. Aguardando aprovação da administração.');
 }else{
   const response=await fetch(code.supabaseUrl.replace(/\/$/,'')+'/functions/v1/submit-review',{
     method:'POST',
     headers:{'Content-Type':'application/json','apikey':code.supabaseAnonKey},
     body:JSON.stringify(content)
   });
   let data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Não foi possível enviar sua avaliação. Tente novamente.');
   close();await refreshCloud();toast('Avaliação recebida! Ela ficará visível após a aprovação da administração.');
 }
 return;
}
if(!confirmAdmin())return;
if(form.id==='listing-form'){
 let existing=form.dataset.id,kind=form.dataset.kind;
 let tel=normTel(formValue(form,'phone'));
 if(formValue(form,'phone')&&!tel)throw Error('Informe um WhatsApp válido com DDD.');
 let instagram=normalizeInstagram(formValue(form,'instagram'));
 const photoType=formValue(form,'profile_image_type');
 if(!['logo','proprietario','padrao'].includes(photoType))throw Error('Tipo de imagem inválido.');
 const iconFile=f.get('profile_image'),hasIcon=iconFile instanceof File&&iconFile.size>0;
 const before=existing?ls(existing):null;
 if(photoType==='proprietario'&&!hasIcon&&(!before?.profile_image_url||before.profile_image_type!=='proprietario'))
  throw Error('Para usar a foto do proprietário, envie uma foto no campo do ícone.');
 if(photoType!=='padrao'&&before?.profile_image_url&&photoType!==before.profile_image_type&&!hasIcon)
  throw Error('Ao mudar entre logo e foto do proprietário, envie a nova imagem do ícone.');
 let payload={kind,name:formValue(form,'name'),category:formValue(form,'category'),description:formValue(form,'description'),phone:tel,instagram,active:checkbox(form,'active'),profile_image_type:photoType};
 let image=await mediaUrl(f.get('image'),'logo');if(image)payload.image_url=image;
 if(photoType==='padrao')payload.profile_image_url='';
 else if(hasIcon){
  const icon=await mediaUrl(iconFile,photoType==='proprietario'?'profile-owner':'profile-logo');
  if(icon)payload.profile_image_url=icon;
 }
 await persist('listings',payload,existing);close();toast('Cadastro salvo com sucesso.');return;
}
if(form.id==='ad-form'){let start=formValue(form,'starts_at'),end=formValue(form,'ends_at');if(start&&end&&new Date(end)<=new Date(start))throw Error('A data final deve ser posterior ao início.');let payload={listing_id:formValue(form,'listing_id'),period:formValue(form,'period'),title:formValue(form,'title'),description:formValue(form,'description'),starts_at:start?new Date(start).toISOString():null,ends_at:end?new Date(end).toISOString():null,active:checkbox(form,'active')};let img=await mediaUrl(f.get('image'),'promo');if(img)payload.image_url=img;await persist('ads',payload,form.dataset.id);close();toast('Propaganda salva.');return;}
if(form.id==='banner-form'){let payload={title:formValue(form,'title'),subtitle:formValue(form,'subtitle'),target_type:formValue(form,'target_type'),target_id:formValue(form,'target_id')||null,sort_order:Number(formValue(form,'sort_order'))||1,active:checkbox(form,'active')};let img=await mediaUrl(f.get('image'),'banner');if(img)payload.image_url=img;await persist('banners',payload,form.dataset.id);slide=0;close();toast('Banner salvo.');return;}}

async function extendHomeCarousel(kind,direction){
 if(!LIVE||!client)return false;
 const paging=homePaging[kind];if(paging.loading||direction>0&&!paging.hasMore||direction<0&&paging.start===0)return false;
 paging.loading=true;
 const id=kind==='servico'?'home-services':'home-businesses',rail=$('#'+id);
 const first=rail?.querySelector('.card'),step=(first?.getBoundingClientRect().width||310)+(parseFloat(getComputedStyle(rail).gap)||16);
 const before=rail?.scrollLeft||0;
 try{
  const a=direction>0?paging.start+homeRows[kind].length:Math.max(0,paging.start-HOME_SIZE);
  const b=direction>0?a+HOME_SIZE:a+Math.min(HOME_SIZE,paging.start)-1;
  let q=client.from('yespark_catalog_public').select('*').eq('kind',kind);
  q=kind==='servico'?q.order('rating_avg',{ascending:false}).order('created_at',{ascending:false}):q.order('created_at',{ascending:false});
  const rows=await cachedPublic('homepage:'+kind+':'+a+':'+b,()=>q.range(a,b),60000);
  if(!rows.length){if(direction>0)paging.hasMore=false;return false;}
  let offset=0;
  if(direction>0){homeRows[kind].push(...rows.slice(0,HOME_SIZE));if(rows.length<=HOME_SIZE)paging.hasMore=false;
    if(homeRows[kind].length>HOME_WINDOW){const dropped=homeRows[kind].length-HOME_WINDOW;homeRows[kind].splice(0,dropped);paging.start+=dropped;offset-=step*dropped;}
  }else{
    homeRows[kind].unshift(...rows);paging.start=a;offset+=step*rows.length;
    if(homeRows[kind].length>HOME_WINDOW)homeRows[kind].splice(HOME_WINDOW);
    paging.hasMore=true;
  }
  mergeListings(rows);
  if(rail){rail.innerHTML=homeRows[kind].map(x=>listingCard(x,kind==='servico')).join('');rail.scrollLeft=Math.max(0,before+offset);}
  requestAnimationFrame(updateHomeCarouselArrows);return true;
 }catch(e){console.warn('Carrossel: não foi possível carregar mais cadastros',e);return false;}
 finally{paging.loading=false;}
}
function updateHomeCarouselArrows(){
 ['home-services','home-businesses'].forEach(id=>{
   const rail=$('#'+id);if(!rail)return;
   const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
   const prev=root.querySelector('[data-home-scroll="'+id+'"][data-dir="-1"]');
   const next=root.querySelector('[data-home-scroll="'+id+'"][data-dir="1"]');
   const kind=id==='home-services'?'servico':'empresa';
   if(prev)prev.disabled=rail.scrollLeft<2&&(!LIVE||homePaging[kind].start===0);
   if(next)next.disabled=(max<2||rail.scrollLeft>=max-2)&&(!LIVE||!homePaging[kind].hasMore);
 });
}
root.addEventListener('scroll',e=>{if(e.target?.matches?.('#home-services,#home-businesses')){updateHomeCarouselArrows();const rail=e.target,kind=rail.id==='home-services'?'servico':'empresa',card=rail.querySelector('.card');if(LIVE&&card){const step=card.getBoundingClientRect().width+(parseFloat(getComputedStyle(rail).gap)||0);if(rail.scrollWidth-rail.clientWidth-rail.scrollLeft<step*1.1)extendHomeCarousel(kind,1);}}},true);
window.addEventListener('resize',updateHomeCarouselArrows,{passive:true});
root.addEventListener('keydown',e=>{
  const rail=e.target.closest?.('.yp-home-rail');
  if(!rail||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();scrollHomeCarousel(rail.id,e.key==='ArrowRight'?1:-1);
});
async function scrollHomeCarousel(id,dir){
 const rail=$('#'+id);if(!rail)return;
 const card=rail.querySelector('.card');if(!card)return;
 const gap=parseFloat(getComputedStyle(rail).gap)||0,step=card.getBoundingClientRect().width+gap;
 const kind=id==='home-services'?'servico':'empresa';
 if(LIVE&&((dir>0&&rail.scrollWidth-rail.clientWidth-rail.scrollLeft<step*1.2)||(dir<0&&rail.scrollLeft<step*1.2)))await extendHomeCarousel(kind,dir);
 rail.scrollBy({left:dir*step,behavior:'smooth'});
}
root.addEventListener('click',async e=>{let el=e.target.closest('[data-close]');if(el||e.target===overlay){close();return}el=e.target.closest('[data-tab]');if(el){switchTab(el.dataset.tab);return}el=e.target.closest('[data-catalog-page]');if(el){const kind=el.dataset.catalogPage,page=Number(el.dataset.page);if(page<0)return;if(LIVE)loadCatalog(kind,page);else{catalogState[kind].page=page;renderListingGrid(kind)}return}el=e.target.closest('[data-admin-more]');if(el){loadMoreAdmin(el.dataset.adminMore);return}el=e.target.closest('[data-promo-more]');if(el){loadMorePromos();return}el=e.target.closest('[data-review-more]');if(el){loadMoreReviews(el.dataset.reviewMore);return}el=e.target.closest('[data-open-admin]');if(el){openAdmin();return}el=e.target.closest('[data-preview-admin]');if(el){admin=true;preview=true;close();adminView();toast('Prévia administrativa local ativada.');return}el=e.target.closest('[data-admin-logout]');if(el){if(LIVE&&client)await client.auth.signOut();admin=false;session=null;preview=false;adminView();toast('Área administrativa encerrada.');return}el=e.target.closest('[data-slide]');if(el){slide=Number(el.dataset.slide);renderHero();return}el=e.target.closest('[data-banner-step]');if(el){slide+=Number(el.dataset.bannerStep);renderHero();return}el=e.target.closest('[data-banner-target]');if(el){bannerClick();return}el=e.target.closest('[data-home-scroll]');if(el){scrollHomeCarousel(el.dataset.homeScroll,Number(el.dataset.dir));return}el=e.target.closest('[data-scroll]');if(el){let rail=$('#'+el.dataset.scroll),item=rail?.querySelector('.promo');if(rail)rail.scrollBy({left:Number(el.dataset.dir)*((item?.getBoundingClientRect().width||310)+12),behavior:'smooth'});return}el=e.target.closest('[data-filter]');if(el){let k=el.dataset.filter;if(k==='promo'){filterPromo=el.dataset.value;render();}else{if(k==='service')filterSvc=el.dataset.value;else filterBiz=el.dataset.value;const kind=k==='service'?'servico':'empresa';catalogState[kind].page=0;if(LIVE)loadCatalog(kind,0);else render();}return}el=e.target.closest('[data-listing]');if(el){showListing(el.dataset.listing);return}el=e.target.closest('[data-reviews]');if(el){reviewsModal(el.dataset.reviews);return}el=e.target.closest('[data-ad]');if(el){showAd(el.dataset.ad);return}el=e.target.closest('[data-star]');if(el){rating=Number(el.dataset.star);$$('.star').forEach(x=>x.classList.toggle('selected',Number(x.dataset.star)<=rating));return}el=e.target.closest('[data-no-contact]');if(el){toast('Este cadastro ainda não possui um número de contato.');return}el=e.target.closest('[data-no-instagram]');if(el){toast('Instagram ainda não cadastrado para esta empresa.');return}el=e.target.closest('[data-category-plus]');if(el&&confirmAdmin()){
 const form=el.closest('#listing-form'),panel=form?.querySelector('.category-add-panel');
 if(panel){panel.hidden=!panel.hidden;el.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('input')?.focus();}
 return;
}
el=e.target.closest('[data-category-add]');if(el){try{await addCategory(el.closest('#listing-form'))}catch(err){toast(err.message||'Erro ao criar categoria.')}return;}
el=e.target.closest('[data-admin-create]');if(el&&confirmAdmin()){let type=el.dataset.adminCreate;if(type==='empresa'||type==='servico')listingForm(type);else if(type==='ads')adForm();else if(type==='banners')bannerForm();return}
el=e.target.closest('[data-admin-edit]');if(el&&confirmAdmin()){let [type,key]=el.dataset.adminEdit.split(':');if(type==='listings')listingForm('empresa',key);else if(type==='ads')adForm(key);else bannerForm(key);return}
el=e.target.closest('[data-admin-toggle]');if(el&&confirmAdmin()){let [type,key]=el.dataset.adminToggle.split(':');try{await toggle(type,key);toast('Situação alterada.')}catch(er){toast(er.message)}return}

el=e.target.closest('[data-admin-delete]');if(el&&confirmAdmin()){let [type,key]=el.dataset.adminDelete.split(':');if(!confirm('Tem certeza que deseja excluir este registro? Esta ação pode afetar anúncios e avaliações vinculadas.'))return;try{await remove(type,key);toast('Registro excluído.')}catch(er){toast(er.message)}return}
el=e.target.closest('[data-review-approve],[data-review-hide],[data-review-delete]');if(el&&confirmAdmin()){let action=el.hasAttribute('data-review-approve')?'approve':el.hasAttribute('data-review-hide')?'hide':'delete',pk=el.dataset.reviewApprove||el.dataset.reviewHide||el.dataset.reviewDelete;try{if(action==='delete'){if(!confirm('Excluir permanentemente esta avaliação?'))return;await deleteReview(pk)}else await updateReview(pk,action==='approve'?'approved':'hidden');toast('Moderação concluída.')}catch(er){toast(er.message)}return}
el=e.target.closest('[data-privacy]');if(el){if(LIVE)await ensureLegal();openLegalDoc('privacy');return}el=e.target.closest('[data-terms]');if(el){if(LIVE)await ensureLegal();openLegalDoc('terms');return}el=e.target.closest('[data-legal-contact]');if(el){if(LIVE)await ensureLegal();openLegalContact();return}});
root.addEventListener('submit',async e=>{if(!['listing-form','ad-form','banner-form','review-form','admin-login','legal-contact-form'].includes(e.target.id))return;e.preventDefault();let form=e.target,btn=form.querySelector('button[type="submit"],button:not([type])');if(btn){btn.disabled=true;btn.dataset.label=btn.textContent;btn.textContent='Salvando...'}try{await handleForm(form)}catch(err){console.error(err);toast(err.message||'Não foi possível concluir a operação.');if(btn){btn.disabled=false;btn.textContent=btn.dataset.label||'Salvar'}}});
root.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&e.target.matches('#listing-form [name="category_new"]')){e.preventDefault();e.target.closest('.category-add-panel')?.querySelector('[data-category-add]')?.click()}
});
let searchTimer;root.addEventListener('input',e=>{const kind=e.target.id==='service-search'?'servico':e.target.id==='business-search'?'empresa':null;if(!kind)return;clearTimeout(searchTimer);catalogState[kind].page=0;if(LIVE){searchTimer=setTimeout(()=>loadCatalog(kind,0),300)}else renderListingGrid(kind)});
let bannerPreviewUrl='';
root.addEventListener('change',async e=>{
 const input=e.target;
 if(!(input instanceof HTMLInputElement)||input.name!=='image'||input.closest('#banner-form')===null)return;
 const preview=$('#banner-fit-preview');
 if(bannerPreviewUrl){URL.revokeObjectURL(bannerPreviewUrl);bannerPreviewUrl='';}
 if(!preview||!input.files?.length){if(preview)preview.style.display='none';return;}
 try{
  const selected=input.files[0]; const blob=await processImage(selected,'banner');
  if(input.isConnected&&input.files?.[0]===selected){
   bannerPreviewUrl=URL.createObjectURL(blob);
   preview.querySelector('img').src=bannerPreviewUrl;
   preview.style.display='block';
  }
 }catch(error){toast(error.message||'Não foi possível visualizar o banner.');preview.style.display='none';}
});$('#sort-service').addEventListener('change',()=>{if(LIVE)loadCatalog('servico',0);else renderListingGrid('servico')});
// Mantém o swipe / arraste original, sem cliques acidentais
let drag=null,blockUntil=0;root.addEventListener('pointerdown',e=>{let h=e.target.closest('#home-hero'),r=e.target.closest('#home-promos,#promos-list,#home-services,#home-businesses');if(!h&&!r||e.pointerType==='mouse'&&e.button!==0||e.target.closest('button,a,input,textarea,select'))return;drag={el:h||r,kind:h?'hero':'rail',x:e.clientX,y:e.clientY,scroll:r?.scrollLeft||0,moved:false,pid:e.pointerId};try{drag.el.setPointerCapture(e.pointerId)}catch(_){} });
root.addEventListener('pointermove',e=>{if(!drag||drag.pid!==e.pointerId)return;let dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)>9&&Math.abs(dx)>Math.abs(dy)*1.15){drag.moved=true;drag.el.classList.add('dragging','grabbing');if(drag.kind==='rail')drag.el.scrollLeft=drag.scroll-dx;}});
root.addEventListener('pointerup',e=>{if(!drag||drag.pid!==e.pointerId)return;let d=drag,dx=e.clientX-d.x,dy=e.clientY-d.y;drag=null;d.el.classList.remove('dragging','grabbing');if(d.moved&&Math.abs(dx)>25&&Math.abs(dx)>Math.abs(dy)){blockUntil=Date.now()+300;if(d.kind==='hero'&&Math.abs(dx)>42){slide+=dx<0?1:-1;renderHero()}}});root.addEventListener('pointercancel',()=>{if(drag){drag.el.classList.remove('dragging','grabbing');drag=null}});root.addEventListener('click',e=>{if(Date.now()<blockUntil){e.preventDefault();e.stopImmediatePropagation()}},true);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay.classList.contains('open'))close()});
$('#notice-mode').textContent=LIVE?'Guia da comunidade. Empresas, propagandas e avaliações são administradas pela equipe responsável.':'PRÉVIA LOCAL · Dados ilustrativos. Alterações do painel ficam somente neste navegador; conecte o Supabase para publicar.';
window.YesparkBackup?.mount({authorized:()=>LIVE&&admin&&!!client,client:()=>client,base:()=>code.supabaseUrl,onRestore:async()=>{clearYesparkCache();categoriesLoaded=false;legalLoaded=false;await refreshCloud();await ensureCategories();await ensureLegal();if(catalogState.empresa.loaded)await loadCatalog('empresa',0);if(catalogState.servico.loaded)await loadCatalog('servico',0);}});
initCloud();
})();

