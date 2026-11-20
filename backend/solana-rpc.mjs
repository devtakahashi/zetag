// Keep RPC credentials on the Worker and never include the endpoint in errors.
export async function solanaRpc(env, method, params) {
 const endpoint=env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
 let url;try{url=new URL(endpoint);}catch{throw Error('SOLANA_RPC_URL is not a valid URL.');}
 if(url.protocol!=='https:')throw Error('SOLANA_RPC_URL must use HTTPS.');
 let response;
 try {
  response=await fetch(url.href,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
 } catch { throw Error('The RPC connection failed or timed out. Check SOLANA_RPC_URL.'); }
 if(response.status>=300&&response.status<400)throw Error('Solana RPC redirected. Configure the final RPC endpoint URL.');
 if(response.status===401||response.status===403)throw Error('RPC access denied (HTTP '+response.status+'). Check the provider endpoint and API key in SOLANA_RPC_URL.');
 if(response.status===429)throw Error('RPC rate limit reached. Use a dedicated mainnet RPC endpoint in SOLANA_RPC_URL.');
 if(!response.ok)throw Error('RPC provider unavailable (HTTP '+response.status+'). Check SOLANA_RPC_URL.');
 let data;try{data=await response.json();}catch{throw Error('The RPC provider returned an invalid response.');}
 if(data.error){const code=data.error.code;if(code===429||code===-32429)throw Error('RPC rate limit reached. Check your provider limits.');throw Error('RPC method '+method+' failed (code '+String(code??'unknown')+'). Check your provider supports this method.');}
 if(!Object.hasOwn(data,'result'))throw Error('The RPC provider returned no result.');
 return data.result;
}
