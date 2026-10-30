const {chromium}=require('playwright');
const URL='https://northbit-dev.github.io/callseal/';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'vid',size:{width:1280,height:720}},deviceScaleFactor:1});
const t0=Date.now();
const p=await ctx.newPage();
await p.goto(URL);await p.waitForSelector('#loading',{state:'detached',timeout:60000});
await p.addStyleTag({content:`
#cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;z-index:9999;background:rgba(10,12,28,.92);color:#fff;font:600 22px/1.35 Inter,sans-serif;padding:14px 26px;border-radius:12px;border:1px solid #8b7bff;box-shadow:0 8px 30px rgba(0,0,0,.5);text-align:center;transition:opacity .35s}
#cap .k{color:#a99dff;margin-right:10px}
#card{position:fixed;inset:0;z-index:10000;background:#0b0e1f;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:Inter,sans-serif;transition:opacity .6s}
#card h1{font-size:64px;margin:0 0 12px}#card p{font-size:26px;color:#c9c6ff;margin:6px}#card small{font-size:20px;color:#8f93b8;margin-top:22px}
#cur{position:fixed;width:18px;height:18px;border-radius:50%;background:rgba(255,214,90,.9);border:2px solid #fff;z-index:9998;pointer-events:none;transform:translate(-50%,-50%);transition:left .0s,top .0s}
#toast{top:20px!important;bottom:auto!important;opacity:0;transform:translateX(-50%)!important;transition:opacity .25s!important;z-index:10001;font:600 20px Inter,sans-serif;color:#fff;background:#2a1830!important;border-color:#ff7a90!important;padding:12px 20px!important}
#toast.show{opacity:1}
.hl{outline:3px solid #ffd65a!important;outline-offset:4px;border-radius:8px}`});
await p.evaluate(()=>{const c=document.createElement('div');c.id='cur';c.style.left='640px';c.style.top='360px';document.body.appendChild(c);
document.addEventListener('mousemove',e=>{c.style.left=e.clientX+'px';c.style.top=e.clientY+'px'});
const cap=document.createElement('div');cap.id='cap';cap.style.opacity=0;document.body.appendChild(cap);});
const tStart=Date.now();
const card=async(h,lines,ms)=>{await p.evaluate(([h,l])=>{const d=document.createElement('div');d.id='card';d.innerHTML=`<h1>${h}</h1>`+l.map((x,i)=>i==l.length-1&&l.length>2?`<small>${x}</small>`:`<p>${x}</p>`).join('');document.body.appendChild(d)},[h,lines]);await wait(ms);await p.evaluate(()=>{const d=document.getElementById('card');d.style.opacity=0;setTimeout(()=>d.remove(),700)});await wait(700)};
const cap=async(k,t,ms=2500)=>{await p.evaluate(([k,t])=>{const c=document.getElementById('cap');c.innerHTML=(k?`<span class="k">${k}</span>`:'')+t;c.style.opacity=1},[k,t]);await wait(ms)};
const scrollTo=async(sel,block='center')=>{await p.evaluate(([s,b])=>document.querySelector(s).scrollIntoView({behavior:'smooth',block:b}),[sel,block]);await wait(900)};
const move=async(sel)=>{const l=p.locator(sel).first();await l.scrollIntoViewIfNeeded();const bb=await l.boundingBox();await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps:20});await wait(250);return l};
const click=async(sel)=>{await move(sel);await p.mouse.down();await p.mouse.up();await wait(600)};
const fill=async(sel,v)=>{const l=await move(sel);await l.click({clickCount:3});await l.pressSequentially(String(v),{delay:70});await wait(300)};
const select=async(sel,v)=>{await move(sel);await p.selectOption(sel,v);await wait(400)};
const hl=async(sel,on=true)=>p.evaluate(([s,o])=>document.querySelectorAll(s).forEach(e=>e.classList.toggle('hl',o)),[sel,on]);

await card('🔒 CallSeal',['Sealed trading calls with a provable track record','Zero-knowledge proofs on Midnight · live browser demo'],3500);
await p.evaluate(()=>window.scrollTo(0,250));await wait(500);
await cap('Step 1','Alice is a registered analyst. Her calls stay in a private vault on her device.',3200);
await cap('Step 1','A trivial call is rejected inside the proof: BTC ≥ 99,000 is less than 2 % from the last close.',800);
await fill('#level',99000);await click('#seal');await wait(2200);
await cap('Step 2','Seal a real call: BTC closes ≥ 101,000 at round 1.',600);
await fill('#level',101000);await click('#seal');await wait(2300);
await cap('Step 2','A second call: ETH closes ≤ 3,300 at round 1.',600);
await select('#asset','ETH');await select('#dir','BELOW');await fill('#level',3300);await click('#seal');await wait(2200);
await scrollTo('#public','center');await hl('#ledger');
await cap('Step 2','The public ledger sees only a commitment, the analyst key and the rounds. No asset, side or level.',4200);
await hl('#ledger',false);
await scrollTo('#analyst','start');
await cap('Step 3','The oracle publishes the round-1 closes: BTC 102,500 and ETH 3,450.',600);
await fill('#close-BTC',102500);await fill('#close-ETH',3450);await click('#publish');await wait(1500);
await cap('Step 4','Alice proves call #0 hit, in zero knowledge, without revealing it.',1200);
await click('#vault button[data-prove="0"]');await wait(1500);
await hl('#vault tr:first-child .pill');await cap('Step 4','proveHit → HIT. The call itself stays sealed.',2800);await hl('#vault tr:first-child .pill',false);
await cap('Step 5','Her ETH call missed. She cannot prove it, and she cannot hide it.',3000);
await cap('Step 5','The oracle publishes round 2, so the grace window closes.',600);
await click('#drift');await click('#publish');await wait(1200);
await scrollTo('#public','center');
await cap('Step 5','Anyone can now expire the unproven call into a public MISS.',900);
await click('#ledger button[data-expire="1"]');await wait(1500);
await hl('#board');await hl('#totals');
await cap('Step 6','The counter: 2 calls · 1 hit · 1 miss · 50 % hit rate. Honest by construction.',4500);
await hl('#board',false);await hl('#totals',false);
await scrollTo('#analyst','start');
await cap('Step 7','Paying subscribers can get the opening privately and check it against the chain.',900);
await click('#vault button[data-share="0"]');await wait(1200);
await click('#verify-btn');await wait(500);await hl('#verify-out');await wait(2500);await hl('#verify-out',false);
await cap('Step 7','Edit the level after the fact and the check fails.',600);
await p.evaluate(()=>{const t=document.querySelector('#verify-input');t.value=t.value.replace('"level": 101000','"level": 100000')});await wait(600);
await click('#verify-btn');await wait(500);await hl('#verify-out');await wait(2600);await hl('#verify-out',false);
await p.evaluate(()=>{const h=[...document.querySelectorAll('#onchain h3')].find(x=>/preview/.test(x.textContent));h.scrollIntoView({behavior:'smooth',block:'start'})});await wait(1000);
await cap('On-chain','The same season ran on the Midnight preview testnet: 10 transactions, all SucceedEntirely.',4500);
await p.evaluate(()=>{document.getElementById('cap').style.opacity=0});
await card('🔒 CallSeal',['Prove your track record. Never leak a call.','github.com/northbit-dev/callseal','northbit-dev.github.io/callseal · Apache-2.0'],4000);
const vpath=await p.video().path();await ctx.close();await b.close();
require('fs').writeFileSync('meta.json',JSON.stringify({vpath,offset:(tStart-t0)/1000}));console.log(vpath,(tStart-t0)/1000,(Date.now()-tStart)/1000);
})();
