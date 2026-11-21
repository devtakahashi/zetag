import { solanaRpc } from './solana-rpc.mjs';
import { marketPrices } from './market-prices.mjs';
// Mainnet payment intents. The server never holds a user's signing keys.
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function base58(bytes) {
 let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
 let s = ''; while(n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
 for(const b of bytes) { if(b) break; s = '1' + s; } return s;
}
export function key(value, size = 32) {
 if(typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || value.length > 90) return false;
 let n=0n;for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));
 let length=0;while(n){length++;n>>=8n;}return length+(value.match(/^1*/)[0].length)===size;
}
export function units(amount, asset) {
 if(!['USDC','SOL'].includes(asset)||typeof amount!=='string'||amount.length>30||!new RegExp('^[0-9]+(?:\\.[0-9]{1,'+(asset==='SOL'?9:6)+'})?$').test(amount)) throw Error('Invalid amount');
 const [a,b='']=amount.split('.');const value=BigInt(a+b.padEnd(asset==='SOL'?9:6,'0'));
 if(value<=0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Amount is outside the supported range');return value.toString();
}
async function body(request) {
 const reader=request.body?.getReader();if(!reader)throw Error('JSON required');let size=0,parts=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();throw Error('Request too large');}parts.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(all));
}
export const rpc = solanaRpc;
let checkedEndpoint='',checkedAt=0;
async function mainnet(env) {
 const endpoint=env.SOLANA_RPC_URL||'public';if(checkedEndpoint===endpoint&&Date.now()-checkedAt<300000)return;
 if(await rpc(env,'getGenesisHash',[])!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('A Solana mainnet RPC is required');checkedEndpoint=endpoint;checkedAt=Date.now();
}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function merchant(request,db) {
 const secret=request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];if(!secret)return null;
 return db.prepare('SELECT * FROM payment_merchants WHERE key_hash = ? AND enabled = 1').bind(await digest(secret)).first();
}
const view=row=>({id:row.id,tag:row.tag,recipient:row.recipient,amount:row.amount,asset:row.asset,units:row.units,reference:row.reference,name:row.label,note:row.note,status:row.status,signature:row.signature||null,expires:row.expires,returnUrl:row.return_url||null,merchant:Boolean(row.merchant_id),sender:row.sender||null});
async function create(db,input,shop) {
 let recipient,tag='',label;
 if(shop){recipient=shop.wallet;label=shop.name;}
 else {
  tag=String(input.tag||'').trim().toLowerCase().replace(/^@/,'');if(!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(tag))throw Error('Enter a valid ZeTag');
  const profile=await db.prepare('SELECT wallet, tag FROM profiles WHERE tag = ?1 OR wallet = (SELECT wallet FROM profile_tag_aliases WHERE tag = ?1)').bind(tag).first();
  if(!profile)throw Error('That ZeTag has not been claimed');recipient=profile.wallet;tag=profile.tag;label='@'+tag;
 }
 if(!key(recipient))throw Error('Recipient wallet is invalid');
 const asset=shop?'USDC':input.asset;const value=units(input.amount,asset);
 const sender=shop?'':input.sender;if(!shop&&(!key(sender)||sender===recipient))throw Error('Connect a different sending wallet');
 const note=typeof input.note==='string'?input.note.trim():'';if(note.length>100)throw Error('Note is too long');
 let returnUrl='';if(shop&&input.returnUrl){const u=new URL(input.returnUrl);if(u.origin!==shop.origin||u.protocol!=='https:'||u.href.length>1000)throw Error('Invalid return URL');returnUrl=u.href;}
 const order=shop?String(input.order||''):'';if(shop&&!/^[A-Za-z0-9_-]{1,80}$/.test(order))throw Error('Invalid order reference');
 const row={id:crypto.randomUUID(),recipient,sender,tag,asset,amount:input.amount,units:value,reference:base58(crypto.getRandomValues(new Uint8Array(32))),label,note,created_at:Date.now(),expires:Date.now()+(shop?86400000:1800000),merchant_id:shop?.id||null,merchant_order:order||null,return_url:returnUrl,status:'pending',signature:null};
 await db.prepare(`INSERT INTO payment_intents (id,recipient,sender,tag,asset,amount,units,reference,label,note,created_at,expires,merchant_id,merchant_order,return_url,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...['id','recipient','sender','tag','asset','amount','units','reference','label','note','created_at','expires','merchant_id','merchant_order','return_url','status'].map(k=>row[k])).run();return row;
}
// Verify the actual finalized transfer, not a browser success callback or wallet balance.
export function verifyTransfer(tx,intent,diagnose=()=>{}) {
 const fail=reason=>{diagnose(reason);return false;};
 if(!tx||tx.meta?.err||!tx.blockTime)return fail('Finalized transaction details are incomplete.');
 if(tx.blockTime*1000<intent.created_at-60000||tx.blockTime*1000>intent.expires+30000)return fail('The transaction is outside this payment’s time window.');
 const keys=tx.transaction?.message?.accountKeys||[];
 const address=k=>typeof k==='string'?k:k.pubkey;
 if(!keys.some(k=>address(k)===intent.reference))return fail('The transaction has a different payment reference.');
 const payer=address(keys[0]);if(!key(payer)||(intent.sender&&payer!==intent.sender))return fail('The transaction has a different sending wallet.');
 const instructions=[...(tx.transaction?.message?.instructions||[]),...(tx.meta.innerInstructions||[]).flatMap(group=>group.instructions||[])];
 let transferred=0n;
 for(const ix of instructions){const info=ix.parsed?.info;if(!info)continue;
  if(intent.asset==='SOL'&&ix.programId===SYSTEM&&ix.parsed.type==='transfer'&&info.source===payer&&info.destination===intent.recipient&&Number.isSafeInteger(info.lamports))transferred+=BigInt(info.lamports);
  // Agave labels extra reference accounts as signers and uses multisigAuthority.
  // Accept only our single reference layout with the payer still a real signer.
  if(intent.asset==='USDC'&&ix.programId===TOKEN&&ix.parsed.type==='transferChecked'&&(info.authority===payer||(!info.authority&&info.multisigAuthority===payer&&keys[0]?.signer===true&&Array.isArray(info.signers)&&info.signers.length===1&&info.signers[0]===intent.reference))&&info.mint===USDC&&info.tokenAmount?.decimals===6&&/^[0-9]+$/.test(info.tokenAmount?.amount||'')){
   const index=keys.findIndex(k=>address(k)===info.destination);
   const destination=tx.meta.postTokenBalances?.find(b=>b.accountIndex===index&&b.owner===intent.recipient&&b.mint===USDC&&b.uiTokenAmount?.decimals===6);
   if(destination)transferred+=BigInt(info.tokenAmount.amount);
  }
 }
 return transferred===BigInt(intent.units)||fail('The verified token, recipient or transferred amount differs from this payment.');
}
async function settle(db,env,row,signature) {
 if(row.status==='paid')return row;
 if(!key(signature,64))throw Error('Invalid transaction signature');
 const tx=await rpc(env,'getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
 if(!tx)return row;
 if(tx.meta?.err) throw Object.assign(Error('Transaction failed on Solana. No transfer was completed.'), { failed: true });
 let verificationDetail='';if(!verifyTransfer(tx,row,detail=>verificationDetail=detail))throw Object.assign(Error('Transaction does not match this payment'),{errorCode:'TRANSFER_MISMATCH',verificationDetail});
 await db.batch([
  db.prepare(`INSERT INTO payment_receipts (signature,intent_id,confirmed_at) VALUES (?,?,?) ON CONFLICT(signature) DO NOTHING`).bind(signature,row.id,Date.now()),
  db.prepare(`UPDATE payment_intents SET status='paid', signature=? WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM payment_receipts WHERE signature=? AND intent_id=?)`).bind(signature,row.id,signature,row.id)
 ]);
 return db.prepare('SELECT * FROM payment_intents WHERE id=?').bind(row.id).first();
}
async function limit(request,db){
 const ip=request.headers.get('CF-Connecting-IP');if(!ip)return;const bucket=await digest(ip+':'+Math.floor(Date.now()/60000));
 const row=await db.prepare('INSERT INTO payment_rate (bucket, hits, expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket,Date.now()+120000).first();
 if(row.hits>180)throw Error('Too many requests; try again shortly');
 if(Math.random()<.01)await db.prepare('DELETE FROM payment_rate WHERE expires < ?').bind(Date.now()).run();
}
export async function payments(request,env,url) {
 const route=url.pathname.slice('/pay/_payments'.length);
 if(route==='/connection'&&request.method==='GET')return json({rpcConfigured:Boolean(env.SOLANA_RPC_URL),paymentsEnabled:env.PAYMENTS_ENABLED==='true',paymentVersion:'history16',paymentProtocol:2});
 if(route==='/prices'&&request.method==='GET'){
  try{return json(await marketPrices(env));}catch{return json({error:'USD market prices are temporarily unavailable.'},503);}
 }
 if(env.PAYMENTS_ENABLED!=='true')return json({error:'Payments are not enabled yet.'},503);
 try{
  const path=url.pathname.slice('/pay/_payments'.length);const db=env.DB;
  const isMerchant=path.startsWith('/merchant/');
  if(request.method==='POST'&&!isMerchant&&request.headers.get('Origin')!==url.origin)return json({error:'Origin forbidden'},403);
  await limit(request,db);
  if(path==='/rpc'&&request.method==='POST'){
   const data=await body(request);const {method,params}=data;
   const methods=new Set(['getLatestBlockhash','getFeeForMessage','getMinimumBalanceForRentExemption','getBalance','getAccountInfo','getTokenAccountsByOwner','sendTransaction','getSignatureStatuses','getBlockHeight','getTransaction','getSignaturesForAddress']);
   if(!methods.has(method)||!Array.isArray(params))return json({error:'Unsupported request'},400);
   await mainnet(env);const result=await rpc(env,method,params);return json({jsonrpc:'2.0',id:data.id,result});
  }
  if(path==='/intents'&&request.method==='POST') {await mainnet(env);return json(view(await create(db,await body(request))),201);}
  if(path==='/merchant/intents'&&request.method==='POST'){
   const shop=await merchant(request,db);if(!shop)return json({error:'Merchant authentication required'},401);
   await mainnet(env);const row=await create(db,await body(request),shop);return json({...view(row),checkoutUrl:url.origin+'/pay/?intent='+row.id},201);
  }
  const match=path.match(/^\/(merchant\/)?intents\/([0-9a-f-]{36})(\/confirm|\/recover)?$/);
  if(!match)return json({error:'Not found'},404);
  let row=await db.prepare('SELECT * FROM payment_intents WHERE id=?').bind(match[2]).first();if(!row)return json({error:'Payment not found'},404);
  if(match[1]){const shop=await merchant(request,db);if(!shop||shop.id!==row.merchant_id)return json({error:'Merchant authentication required'},401);}
  if(request.method==='POST'&&match[3]==='/confirm'){await mainnet(env);const data=await body(request);row=await settle(db,env,row,data.signature);}
  else if(request.method==='POST'&&match[3]==='/recover'){
   await mainnet(env);const found=await rpc(env,'getSignaturesForAddress',[row.reference,{limit:5},'finalized']);
   for(const tx of found||[]){if(tx.err)continue;try{row=await settle(db,env,row,tx.signature);}catch{}if(row.status==='paid')break;}
  }else if(request.method!=='GET'||match[3])return json({error:'Method not allowed'},405);
  return json(view(row));
 }catch(error){const message=error.message||'Payment service unavailable';const invalid=/Invalid|valid |outside|claimed|different|long|does not match|too large|JSON/.test(message);return json({error:message,...(error.errorCode?{errorCode:error.errorCode,verificationDetail:error.verificationDetail}:{}),...(error.failed?{failed:true}:{})},invalid||error.failed?400:503);}
}
