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
  try {
    const response=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,usd-coin&vs_currencies=usd&include_last_updated_at=true',{redirect:'manual',headers,signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw Error('Price feed unavailable');
    cached=parsePrices(await response.json());
  } catch {
    const response=await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD',{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw Error('USD market prices are temporarily unavailable.');
    const data=await response.json();
    if(data?.data?.currency!=='USD')throw Error('Invalid exchange-rate currency');
    const prices={};
    for(const asset of ['SOL','USDC']){
      const raw=data.data.rates?.[asset];
      if(typeof raw!=='string'||!/^\d+(?:\.\d+)?$/.test(raw))throw Error('Invalid exchange rate');
      const rate=Number(raw),price=1/rate;
      if(!Number.isFinite(price)||price<=0||price>1e9)throw Error('Invalid exchange rate');
      prices[asset]={usd:price,updatedAt:Date.now()};
    }
    cached={prices,source:'Coinbase',timeType:'retrievedAt'};
  }
  validUntil=Math.min(Date.now()+60000,...Object.values(cached.prices).map(price=>price.updatedAt+300000));
  return cached;
 })();
 try{return await pending;}finally{pending=null;}
}
