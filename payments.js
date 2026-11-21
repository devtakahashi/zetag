'use strict';
(() => {
 const base=new URL('/pay/_payments/',location.origin);
 async function api(path,body){const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Payment service unavailable'), {failed: data.failed === true, errorCode:data.errorCode, verificationDetail:data.verificationDetail});return data;}
 const rpc=ZeTagSolana.connection(new URL('rpc',base).href);
 const dialog=document.createElement('dialog');dialog.className='payment-review-dialog';dialog.setAttribute('aria-labelledby','transfer-title');
 dialog.innerHTML=`
 <div class="dialog-heading"><button id="transfer-back" class="transfer-back" type="button" aria-label="Back to amount">←</button><h2 id="transfer-title" tabindex="-1">Review payment</h2><button class="wallet-close" type="button" aria-label="Close payment">×</button></div>
 <div id="transfer-progress" class="transfer-progress" role="progressbar" aria-label="Payment steps" aria-valuemin="1" aria-valuemax="3" aria-valuenow="2"><span></span><span></span><span></span></div>
 <p id="transfer-step" class="transfer-step">2 of 3 · Review</p>
 <section id="transfer-review" aria-label="Payment review">
  <div id="transfer-recipient" class="transfer-parties"></div>
  <div class="transfer-amount-summary"><p class="transfer-total" id="transfer-total"></p><p id="transfer-usd" class="transfer-usd" hidden></p></div>
  <dl class="transfer-details"><div><dt>Network</dt><dd>Solana mainnet</dd></div><div><dt>Network fee</dt><dd id="transfer-fee">Calculating…</dd></div><div><dt>Token account creation</dt><dd id="transfer-rent">Calculating…</dd></div></dl>
 </section>
 <section id="transfer-success" class="transfer-success" role="status" aria-live="polite" aria-label="Confirmed payment" hidden>
  <div id="transfer-wallet-scene" class="wallet-scene" aria-hidden="true">
   <div class="wallet-illustration"><div class="wallet-aura"></div><div class="wallet-back"></div><div class="wallet-coin">$</div>
   <div class="wallet-pocket"></div><div class="wallet-flap"><div class="wallet-brand"><svg viewBox="0 0 40 34"><path d="M8 3h30l-7 7H1zM1 14h30l7 7H8zM8 25h30l-7 7H1z" fill="currentColor"/></svg><b><span class="zelle-initial">Z</span>elle</b></div><span></span></div>
   <div class="wallet-seal"><svg viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
  </div>
  <div id="transfer-success-recipient"></div>
  <p id="transfer-success-total" class="success-total"></p><p id="transfer-success-usd" class="transfer-usd" hidden></p>
  <div id="transfer-success-note" class="success-note" hidden></div>
 </section>
 <p id="transfer-status" class="help" role="status" aria-live="polite"></p>
 <a id="transfer-receipt" target="_blank" rel="noopener" hidden>View transaction</a>
 <button id="transfer-confirm" class="primary" type="button" disabled>Confirm and send</button>
 <button id="transfer-check" class="secondary" type="button" hidden>Check payment</button>
 <button id="transfer-done" class="primary" type="button" hidden>Done</button>
 <a id="transfer-return" class="linkbutton" hidden>Return to store</a>
`;
 document.body.append(dialog);const get=id=>dialog.querySelector('#transfer-'+id);
 let intent=null,plan=null,signer='',sending=false,checking=false,pending=null,pollTimer=null,pollAttempts=0,backAction=null,celebrated='';
 const partyRuns=new WeakMap();
 function party(profile,label,role){
  const el=document.createElement('div');el.className='transfer-person';
  const face=window.ZeTagUI?.avatar?ZeTagUI.avatar(profile,'avatar-contact'):document.createElement('span');
  if(!window.ZeTagUI?.avatar){face.className='mini-avatar avatar-contact';face.textContent=(profile?.tag||label).slice(0,2).toUpperCase();}
  const text=document.createElement('span');text.className='transfer-person-text';const caption=document.createElement('small');caption.className='transfer-role';caption.textContent=role;
  const tag=document.createElement('strong');tag.textContent=profile?.tag?'@'+profile.tag:label;tag.title=tag.textContent;text.append(caption,tag);el.append(face,text);return el;
 }
 function purposeBadge(note){
  if(!note?.trim())return null;const parts=note.trim().split(/\s*·\s*/);const category=parts.shift();const known=/^(?:for\s+)?(lunch|uber|other)$/i.exec(category);const name=known?known[1].toLowerCase():'note';
  const wrap=document.createElement('div');wrap.className='transfer-purpose';const chip=document.createElement('span');chip.className='purpose-chip';
  const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent={lunch:'🍽️',uber:'🚗',other:'✨',note:'💬'}[name];const label=document.createElement('span');label.textContent={lunch:'Lunch',uber:'Uber',other:'Other',note:'Note'}[name];chip.append(icon,label);wrap.append(chip);
  const detail=known?parts.join(' · '):note.trim();if(detail){const text=document.createElement('small');text.className='purpose-detail';text.textContent=detail;wrap.append(text);}return wrap;
 }
 function setPurpose(target,note){const route=target.querySelector('.transfer-route');if(!route)return;route.querySelector('.transfer-purpose')?.remove();const badge=purposeBadge(note);if(badge)route.append(badge);}
 async function parties(target,receiver,sender=ZeTagWallet.address,note=''){
  const run={};partyRuns.set(target,run);const short=value=>value?value.slice(0,4)+'…'+value.slice(-4):'Connect wallet';
  const draw=owner=>{if(partyRuns.get(target)!==run)return;const connector=document.createElement('span');connector.className='transfer-connector';connector.setAttribute('role','img');connector.setAttribute('aria-label','Sending to');for(let i=0;i<3;i++){const arrow=document.createElement('span');arrow.textContent='›';arrow.setAttribute('aria-hidden','true');connector.append(arrow);}const route=document.createElement('div');route.className='transfer-route';route.append(connector);const badge=purposeBadge(note);if(badge)route.append(badge);target.replaceChildren(party(owner,short(sender),'From'),route,party(receiver,receiver?.name||'Recipient','To'));};
  draw(null);
  if(sender&&sender===ZeTagWallet.address&&window.ZeTagUI?.api){try{const me=await ZeTagUI.api('/_me');if(me.wallet===sender)draw(me.profile);}catch{}}
 }
 async function reviewPeople(data){
  const target=get('recipient');const receiver={tag:data.tag,name:data.name};get('success-recipient').replaceChildren(party(receiver,data.name||'Recipient','To'));void parties(target,receiver,data.sender||ZeTagWallet.address,data.note);
  if(data.tag&&window.ZeTagUI?.api){try{const person=await ZeTagUI.api('/'+encodeURIComponent(data.tag));if(intent?.id===data.id){void parties(target,person,data.sender||ZeTagWallet.address,data.note);get('success-recipient').replaceChildren(party(person,data.name||'Recipient','To'));}}catch{}}
 }
 async function estimateUsd(data){get('usd').hidden=true;get('success-usd').hidden=true;try{const rates=await api('prices');const rate=rates.prices?.[data.asset];if(intent?.id!==data.id||!Number.isFinite(rate?.usd)||Date.now()-rate.updatedAt>300000)return;const estimate=Number(data.amount)*rate.usd;if(!Number.isFinite(estimate))return;get('usd').textContent=estimate>0&&estimate<.01?'< $0.01':'≈ '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(estimate);get('usd').hidden=false;get('success-usd').textContent=get('usd').textContent;get('success-usd').hidden=false;}catch{}}
 get('back').onclick=()=>{if(sending||pending)return;dialog.close();backAction?.();};
 function remember(data){pending=data;try{if(data)localStorage.setItem('zetag:pending-payment',JSON.stringify(data));else localStorage.removeItem('zetag:pending-payment');}catch{}}
 try{pending=JSON.parse(localStorage.getItem('zetag:pending-payment'));if(!pending?.id)pending=null;}catch{}
 dialog.querySelector('.wallet-close').onclick=()=>{if(!sending)dialog.close();};
 dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});
 function submitted(){get('back').hidden=true;get('fee').textContent=pending?.fee?ZeTagTokens.formatUnits(BigInt(pending.fee),'SOL')+' SOL':'See transaction';get('rent').textContent=pending?.rent?ZeTagTokens.formatUnits(BigInt(pending.rent),'SOL')+' SOL':'See transaction';get('title').textContent='Payment status';get('check').hidden=false;if(pending?.signature){get('receipt').href='https://explorer.solana.com/tx/'+pending.signature;get('receipt').textContent='View transaction';get('receipt').hidden=false;}}
 function paid(data){get('review').hidden=true;get('success').hidden=false;get('status').hidden=true;get('done').hidden=false;get('progress').setAttribute('aria-valuenow','3');get('step').textContent='3 of 3 · Sent';get('success-total').textContent=ZeTagTokens.formatAmount(data.amount,data.asset)+' '+data.asset;get('success-note').replaceChildren();const badge=purposeBadge(data.note);if(badge)get('success-note').append(badge);get('success-note').hidden=!badge;if(celebrated!==data.id){get('wallet-scene').classList.add('is-celebrating');celebrated=data.id;}get('back').hidden=true;if(get('fee').textContent==='Calculating…')get('fee').textContent='See transaction';if(get('rent').textContent==='Calculating…')get('rent').textContent='See transaction';get('title').textContent='Payment sent';dialog.dataset.state='paid';clearTimeout(pollTimer);plan=null;intent=data;get('status').textContent='Payment confirmed.';get('confirm').hidden=true;get('check').hidden=true;get('receipt').href='https://explorer.solana.com/tx/'+data.signature;get('receipt').hidden=false;remember(null);dialog.scrollTop=0;get('title').focus?.({preventScroll:true});document.dispatchEvent(new CustomEvent('zetag:payment-confirmed',{detail:data}));if(data.returnUrl){const u=new URL(data.returnUrl);if(u.protocol==='https:'){get('return').href=u.href;get('return').hidden=false;}}}
 dialog.addEventListener('close',()=>clearTimeout(pollTimer));
 async function check(){
  if(checking||!intent)return;submitted();dialog.dataset.state='pending';checking=true;get('check').disabled=true;
  try{let data;try{data=await api('intents/'+intent.id+(pending?.signature?'/confirm':'/recover'),pending?.signature?{signature:pending.signature}:{});}catch(error){if(error.errorCode!=='TRANSFER_MISMATCH')throw error;const recovered=await api('intents/'+intent.id+'/recover',{});if(recovered.status!=='paid')throw error;data=recovered;}if(data.status==='paid')paid(data);else get('status').textContent='Still awaiting final confirmation. Check again shortly. Do not send a second payment.';}
  catch(e){if(e.failed){remember(null);plan=null;get('confirm').hidden=true;get('check').hidden=true;get('status').textContent=e.message+' Close this review and start again.';}else {dialog.dataset.state='attention';get('status').textContent=e.errorCode==='TRANSFER_MISMATCH'?'Your transaction was submitted, but verification needs another check. '+(e.verificationDetail||'')+' Check this payment before sending again.':e.message+' You can check again without sending another payment.';}}
  finally{checking=false;get('check').disabled=false;clearTimeout(pollTimer);if (pending && dialog.open && pollAttempts++ < 30) pollTimer=setTimeout(()=>{if (!document.hidden) void check();},2000);}
 }
 function render(data){get('review').hidden=false;get('success').hidden=true;get('status').hidden=false;get('done').hidden=true;get('wallet-scene').classList.remove('is-celebrating');get('progress').setAttribute('aria-valuenow','2');get('step').textContent='2 of 3 · Review';get('back').hidden=false;get('title').textContent='Review payment';dialog.dataset.state='review';clearTimeout(pollTimer);pollAttempts=0;intent=data;plan=null;get('confirm').hidden=false;get('confirm').disabled=true;get('check').hidden=true;get('receipt').hidden=true;get('return').hidden=true;void reviewPeople(data);void estimateUsd(data);get('total').textContent=ZeTagTokens.formatAmount(data.amount,data.asset)+' '+data.asset;get('fee').textContent='Calculating…';get('rent').textContent='Calculating…';get('status').textContent='';if(!dialog.open)dialog.showModal();}
 async function begin(input){const service=await api('connection');if(!(service.paymentProtocol>=2))throw Error('The payment backend update is not live yet. Run START-HERE.cmd, then check the existing payment again.');backAction=typeof input.onBack==='function'?input.onBack:null;
  if(sending)throw Error('A payment is already in progress');
  if(pending){render(await api('intents/'+pending.id));input.onReady?.();get('confirm').hidden=true;get('check').hidden=false;get('status').textContent='Check your previous payment before starting another.';await check();return;}
  if(!ZeTagWallet.address){document.querySelector('#wallet-button').click();throw Error('Connect your wallet, then review the payment again.');}
  signer=ZeTagWallet.address;
  const data=input.intentId?await api('intents/'+input.intentId):await api('intents',{...input,sender:signer});
  render(data);input.onReady?.();if(data.status==='paid'){paid(data);return;}
  if(Date.now()>data.expires){get('status').textContent='This payment has expired. Request a new link.';return;}
  if(data.sender&&data.sender!==signer)throw Error('This payment belongs to a different sending wallet');
  try{const prepared=await ZeTagSolana.build(data,signer,rpc);if(intent?.id!==data.id||!dialog.open)return;plan=prepared;if(signer!==ZeTagWallet.address)throw Error('Wallet changed. Review again.');get('fee').textContent=ZeTagTokens.formatUnits(BigInt(plan.fee),'SOL')+' SOL';get('rent').textContent=ZeTagTokens.formatUnits(BigInt(plan.rent),'SOL')+' SOL';get('confirm').disabled=false;}
  catch(e){get('status').textContent=e.message;}
 }
 get('confirm').onclick=async()=>{
  if(sending||!plan||!intent||intent.status==='paid')return;const data=intent;
  if(signer!==ZeTagWallet.address){get('confirm').disabled=true;get('status').textContent='Wallet changed. Close and review again.';return;}
  if(Date.now()>data.expires){get('confirm').disabled=true;get('status').textContent='Payment expired. Review again.';return;}
  let submissionStarted = false;
  sending=true;get('confirm').disabled=true;get('status').textContent='Approve this payment in your wallet.';
  try{
   const rebuilt=await ZeTagSolana.build(data,signer,rpc);
   if(rebuilt.fee!==plan.fee||rebuilt.rent!==plan.rent){plan=rebuilt;get('fee').textContent=ZeTagTokens.formatUnits(BigInt(plan.fee),'SOL')+' SOL';get('rent').textContent=ZeTagTokens.formatUnits(BigInt(plan.rent),'SOL')+' SOL';get('status').textContent='The fee estimate changed. Review it and confirm again.';get('confirm').disabled=false;return;}
   if (signer !== ZeTagWallet.address) throw Error('Wallet changed. Review again.');
   submissionStarted = true;
   remember({id:data.id,sender:signer,signature:null,fee:rebuilt.fee,rent:rebuilt.rent});
   const signature=await ZeTagWallet.sendTransaction(rebuilt.tx,rpc);
   remember({id:data.id,sender:signer,signature,fee:rebuilt.fee,rent:rebuilt.rent});get('confirm').hidden=true;get('check').hidden=false;get('status').textContent='Submitted. Waiting for final confirmation…';
   await check();
  }catch(e){
   if (!submissionStarted) { get('status').textContent=e.message; get('confirm').disabled=false; }
   else if(e.code===4001||/reject|declin|cancel/i.test(e.message)){remember(null);get('status').textContent='Payment cancelled in your wallet.';get('confirm').disabled=false;}
   else {get('status').textContent=e.message+' Check the payment before trying again.';get('confirm').hidden=true;get('check').hidden=false;}
  }finally{sending=false;}
 };
 get('check').onclick=check;
 get('done').onclick=()=>dialog.close();
 // Successful submission never automatically repeats a transfer.
 document.addEventListener('zetag:wallet-changed',()=>{if(intent&&!sending){plan=null;get('confirm').disabled=true;get('status').textContent='Wallet changed. Review the payment again.';}});
 window.ZeTagPayments=Object.freeze({begin,api,rpc,parties,setPurpose});
})();
