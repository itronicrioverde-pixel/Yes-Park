import {chromium,webkit,devices} from 'playwright';
import assert from 'node:assert/strict';
const base='https://itronicrioverde-pixel.github.io/Yes-Park/';
for(const [name,engine,options] of [
 ['iPhone 13 Safari',webkit,devices['iPhone 13']],
 ['Pixel 7 Chrome',chromium,devices['Pixel 7']],
 ['desktop Chrome',chromium,{viewport:{width:1440,height:900}}]
]){
 const browser=await engine.launch({headless:true});const ctx=await browser.newContext(options),page=await ctx.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message.slice(0,200)));
 const checked=[];
 const overflow=async label=>{const d=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert(d.scroll<=d.width+2,name+' '+label+' overflow '+JSON.stringify(d));checked.push(label)};
 try{
  const r=await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});assert(r.ok());await page.locator('#home-businesses [data-listing]').first().waitFor({timeout:20000});await overflow('home');
  for(const [tab,view] of [['businesses','businesses'],['services','services'],['promos','promos']]){
    await page.locator('#nav [data-tab='+tab+']').click();await page.locator('#view-'+view+'.active').waitFor();await overflow(view);
    if(tab!=='promos'){const input=page.locator('#'+(tab==='businesses'?'business':'service')+'-search');await input.fill('zzzz-nonexistent-qa');await page.waitForTimeout(750);await input.fill('');await page.locator('#'+(tab==='businesses'?'businesses':'services')+'-list [data-listing]').first().waitFor({timeout:15000});await overflow(view+' search');}
  }
  await page.locator('#nav [data-tab=businesses]').click();await page.locator('#businesses-list [data-listing]').first().click();await page.locator('#overlay.open').waitFor();await overflow('listing detail');await page.locator('#overlay [data-close]').first().click();
  for(const kind of ['privacy','terms']){await page.locator('[data-'+kind+']').filter({visible:true}).first().click();await page.locator('#legal-document-title').waitFor();await overflow(kind);await page.locator('#overlay [data-close]').first().click();}
  await page.locator('#admin-entry').click();await page.locator('#admin-login').waitFor();await overflow('login');await page.locator('#overlay [data-close]').first().click();
  await page.goto(base+'recuperar.html');await page.locator('#request-form').waitFor();await overflow('password recovery');
  assert.equal(errors.length,0,'Page exceptions: '+errors.join('; '));
  console.log('UI_RESULT '+JSON.stringify({device:name,checks:checked.length,passed:true,errors:0}));
 }catch(e){console.log('UI_RESULT '+JSON.stringify({device:name,checks:checked.length,passed:false,error:String(e).slice(0,300),pageErrors:errors}));process.exitCode=1}
 finally{await browser.close()}
}