import { createHmac, timingSafeEqual } from 'node:crypto';
export type AiBookingPayload = {
  estimateId: string; requestId: string; quoteRevision: number; originalQuote: string;
  selectedServices: string[]; services: ('Junk Removal'|'Light Demolition'|'Storage / Relocation')[];
  customer: {name:string;phone:string;email:string};
  address: {street:string;city:string;state:string;zip:string;accessNotes:string};
  notes:string; projectDescription:string; confirmedScope:string[];
  requestedSlot: {start:string;end:string;label:string};
  photos: {id:string;size:number;contentType:string}[];
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function bridgeEnabled() { return process.env.PRICER_BOOKING_ENABLED==='true' && (process.env.AI_PRICER_BRIDGE_SECRET?.length??0)>=32; }
function mac(path:string, time:string, body:string) {
  const key=process.env.AI_PRICER_BRIDGE_SECRET;
  if(!bridgeEnabled()||!key)throw new Error('Booking is unavailable.');
  return createHmac('sha256',key).update(`whs-ai-booking-v1\n${path}\n${time}\n${body}`).digest('hex');
}
export function bridgeHeaders(path:string, body:string, now=Date.now()) {
  const time=String(now);return {'Content-Type':'application/json','x-whs-time':time,'x-whs-signature':mac(path,time,body)};
}
export function verifyBridge(req:Request,body:string, now=Date.now()) {
  if(!bridgeEnabled())return false;
  const time=req.headers.get('x-whs-time')??'',sig=req.headers.get('x-whs-signature')??'';
  if(!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>60_000||!/^[a-f0-9]{64}$/.test(sig))return false;
  const expected=mac(new URL(req.url).pathname,time,body);
  return timingSafeEqual(Buffer.from(sig),Buffer.from(expected));
}
export function configuredOrigin(name:string) {
  const value=process.env[name];if(!value)throw new Error('Booking connection is unavailable.');
  const u=new URL(value);
  if(u.origin!==value||u.username||u.password||(u.protocol!=='https:' && !(process.env.NODE_ENV!=='production'&&u.hostname==='localhost')))throw new Error('Invalid booking origin.');
  return value;
}
export async function bridgeFetch(origin:string,path:string,value:unknown,bypass?:string) {
  const body=JSON.stringify(value);
  return fetch(`${origin}${path}`,{method:'POST',headers:{...bridgeHeaders(path,body),...(bypass?{'x-vercel-protection-bypass':bypass}:{})},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(110_000)});
}
export async function boundedBridgeBody(req:Request) {
  const reader=req.body?.getReader();if(!reader)throw new Error('Missing body.');
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128*1024){await reader.cancel();throw new Error('Body too large.');}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
}
