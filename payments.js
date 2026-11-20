'use strict';
(() => {
 const base=new URL('/pay/_payments/',location.origin);
 async function api(path,body){const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Payment service unavailable'), {failed: data.failed === true, errorCode:data.errorCode});return data;}
 const rpc=ZeTagSolana.connection(new URL('rpc',base).href);
 const dialog=document.createElement('dialog');dialog.className='payment-review-dialog';dialog.setAttribute('aria-labelledby','transfer-title');
 dialog.innerHTML='<p class="transfer-eyebrow">ZEPAY · SECURE TRANSFER</p><div class="dialog-heading"><h2 id="transfer-title">Review payment</h2><button class="wallet-close" type="button" aria-label="Close payment review">×</button></div><p id="transfer-recipient"></p><p class="transfer-total" id="transfer-total"></p><dl class="transfer-details"><div><dt>Network</dt><dd>Solana mainnet</dd></div><div><dt>Network fee</dt><dd id="transfer-fee">Calculating…</dd></div><div><dt>Token account creation</dt><dd id="transfer-rent">Calculating…</dd></div></dl><p id="transfer-note" class="transfer-note help"></p><p id="transfer-status" class="help" role="status" aria-live="polite"></p><a id="transfer-receipt" target="_blank" rel="noopener" hidden>View transaction receipt</a><button id="transfer-confirm" class="primary" type="button" disabled>Confirm and send</button><button id="transfer-check" class="secondary" type="button" hidden>Check payment</button><a id="transfer-return" class="linkbutton" hidden>Return to store</a>';
 document.body.append(dialog);const get=id=>dialog.querySelector('#transfer-'+id);
 let intent=null,plan=null,signer='',sending=false,checking=false,pending=null,pollTimer=null,pollAttempts=0;
 function remember(data){pending=data;try{if(data)localStorage.setItem('zetag:pending-payment',JSON.stringify(data));else localStorage.removeItem('zetag:pending-payment');}catch{}}
 try{pending=JSON.parse(localStorage.getItem('zetag:pending-payment'));if(!pending?.id)pending=null;}catch{}
 dialog.querySelector('.wallet-close').onclick=()=>{if(!sending)dialog.close();};
 dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});
 function submitted(){get('title').textContent='Payment status';get('check').hidden=false;if(pending?.signature){get('receipt').href='https://explorer.solana.com/tx/'+pending.signature;get('receipt').textContent='View transaction';get('receipt').hidden=false;}}
 function paid(data){get('title').textContent='Payment complete';dialog.dataset.state='paid';clearTimeout(pollTimer);plan=null;intent=data;get('status').textContent='Payment confirmed.';get('confirm').hidden=true;get('check').hidden=true;get('receipt').href='https://explorer.solana.com/tx/'+data.signature;get('receipt').hidden=false;remember(null);document.dispatchEvent(new CustomEvent('zetag:payment-confirmed',{detail:data}));if(data.returnUrl){const u=new URL(data.returnUrl);if(u.protocol==='https:'){get('return').href=u.href;get('return').hidden=false;}}}
 dialog.addEventListener('close',()=>clearTimeout(pollTimer));
 async function check(){
  if(checking||!intent)return;submitted();dialog.dataset.state='pending';checking=true;get('check').disabled=true;
  try{let data=await api('intents/'+intent.id+(pending?.signature?'/confirm':'/recover'),pending?.signature?{signature:pending.signature}:{});if(data.status==='paid')paid(data);else get('status').textContent='Still awaiting final confirmation. Check again shortly. Do not send a second payment.';}
  catch(e){if(e.failed){remember(null);plan=null;get('confirm').hidden=true;get('check').hidden=true;get('status').textContent=e.message+' Close this review and start again.';}else {dialog.dataset.state='attention';get('status').textContent=e.errorCode==='TRANSFER_MISMATCH'?'Your transaction was submitted, but verification needs another check. Check this payment before sending again.':e.message+' You can check again without sending another payment.';}}
  finally{checking=false;get('check').disabled=false;clearTimeout(pollTimer);if (pending && dialog.open && pollAttempts++ < 30) pollTimer=setTimeout(()=>{if (!document.hidden) void check();},2000);}
 }
 function render(data){get('title').textContent='Review payment';dialog.dataset.state='review';clearTimeout(pollTimer);pollAttempts=0;intent=data;plan=null;get('confirm').hidden=false;get('confirm').disabled=true;get('check').hidden=true;get('receipt').hidden=true;get('return').hidden=true;get('recipient').textContent=data.merchant?data.name:'To @'+data.tag;get('total').textContent=ZeTagTokens.formatAmount(data.amount,data.asset)+' '+data.asset;get('note').textContent=data.note?'For '+data.note:'';get('note').hidden=!data.note;get('fee').textContent='Calculating…';get('rent').textContent='Calculating…';get('status').textContent='';if(!dialog.open)dialog.showModal();}
 async function begin(input){
  if(sending)throw Error('A payment is already in progress');
  if(pending){render(await api('intents/'+pending.id));get('confirm').hidden=true;get('check').hidden=false;get('status').textContent='Check your previous payment before starting another.';await check();return;}
  if(!ZeTagWallet.address){document.querySelector('#wallet-button').click();throw Error('Connect your wallet, then review the payment again.');}
  signer=ZeTagWallet.address;
  const data=input.intentId?await api('intents/'+input.intentId):await api('intents',{...input,sender:signer});
  render(data);if(data.status==='paid'){paid(data);return;}
  if(Date.now()>data.expires){get('status').textContent='This payment has expired. Request a new link.';return;}
  if(data.sender&&data.sender!==signer)throw Error('This payment belongs to a different sending wallet');
  try{plan=await ZeTagSolana.build(data,signer,rpc);if(signer!==ZeTagWallet.address)throw Error('Wallet changed. Review again.');get('fee').textContent=ZeTagTokens.formatUnits(BigInt(plan.fee),'SOL')+' SOL';get('rent').textContent=ZeTagTokens.formatUnits(BigInt(plan.rent),'SOL')+' SOL';get('confirm').disabled=false;}
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
   remember({id:data.id,sender:signer,signature:null});
   const signature=await ZeTagWallet.sendTransaction(rebuilt.tx,rpc);
   remember({id:data.id,sender:signer,signature});get('confirm').hidden=true;get('check').hidden=false;get('status').textContent='Submitted. Waiting for final confirmation…';
   await check();
  }catch(e){
   if (!submissionStarted) { get('status').textContent=e.message; get('confirm').disabled=false; }
   else if(e.code===4001||/reject|declin|cancel/i.test(e.message)){remember(null);get('status').textContent='Payment cancelled in your wallet.';get('confirm').disabled=false;}
   else {get('status').textContent=e.message+' Check the payment before trying again.';get('confirm').hidden=true;get('check').hidden=false;}
  }finally{sending=false;}
 };
 get('check').onclick=check;
 // Successful submission never automatically repeats a transfer.
 document.addEventListener('zetag:wallet-changed',()=>{if(intent&&!sending){plan=null;get('confirm').disabled=true;get('status').textContent='Wallet changed. Review the payment again.';}});
 window.ZeTagPayments=Object.freeze({begin,api,rpc});
})();
