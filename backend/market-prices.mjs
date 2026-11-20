let cached=null,pending=null,validUntil=0;
export function parsePrices(data,now=Date.now()) {
 const prices={};
 for(const [asset,id] of [['SOL','solana'],['USDC','usd-coin']]){
  const price=data?.[id]?.usd,updated=data?.[id]?.last_updated_at;
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0||price>1e9||!Number.isFinite(updated)||updated*1000<now-300000||updated*1000>now+60000)throw Error('Market price is unavailable or stale.');
  prices[asset]={usd:price,updatedAt:updated*1000};
 }
 return {prices,source:'CoinGecko'};
}
export async function marketPrices(env) {
 if(cached&&Date.now()<validUntil)return cached;
 if(pending)return pending;
 pending=(async()=>{
  const headers={Accept:'application/json'};if(env.COINGECKO_API_KEY)headers['x-cg-demo-api-key']=env.COINGECKO_API_KEY;
  const response=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,usd-coin&vs_currencies=usd&include_last_updated_at=true',{redirect:'manual',headers,signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error('USD market prices are temporarily unavailable.');
  cached=parsePrices(await response.json());
  validUntil=Math.min(Date.now()+60000,...Object.values(cached.prices).map(price=>price.updatedAt+300000));
  return cached;
 })();
 try{return await pending;}finally{pending=null;}
}
