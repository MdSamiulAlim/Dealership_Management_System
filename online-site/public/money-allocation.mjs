/** Exact percentage rounding and allocation in integer cents.
 * BigInt prevents both native overflow and floating-point tie drift. */
export function percentageDiscountCents(subtotal, basisPoints) {
 if(!Number.isSafeInteger(subtotal)||subtotal<0||!Number.isSafeInteger(basisPoints)||basisPoints<0||basisPoints>10000)throw Error('Invalid percentage discount.');
 // basisPoints is hundredths of one percent. Round the exact rational value
 // once, half up, rather than letting 0.57 become 0.5699999999999999.
 return Number((BigInt(subtotal)*BigInt(basisPoints)+5000n)/10000n);
}

/** Largest remainder; equal remainders use item order. */
export function allocateCents(total,weights){
 if(!Number.isSafeInteger(total)||total<0||weights.some(w=>!Number.isSafeInteger(w)||w<0))throw Error('Invalid allocation amount.');
 const sum=weights.reduce((a,b)=>a+BigInt(b),0n);
 if(sum===0n){if(total!==0)throw Error('Cannot allocate a payment without an invoice total.');return weights.map(()=>0);}
 const products=weights.map(w=>BigInt(total)*BigInt(w));
 const values=products.map(p=>Number(p/sum));
 const order=products.map((p,i)=>({i,remainder:p%sum})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
 const remaining=total-values.reduce((a,b)=>a+b,0);
 if(remaining<0||remaining>=weights.length)throw Error('Invalid allocation remainder.');
 for(let i=0;i<remaining;i++)values[order[i].i]++;
 return values;
}
