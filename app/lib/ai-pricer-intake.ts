import { createHash } from 'node:crypto';
import { put, head } from '@vercel/blob';
import { bridgeFetch, configuredOrigin, UUID, type AiBookingPayload } from './ai-booking-bridge';
import { appendAiPricerLead, getCalendarBusyWindows, getLeadById, googleConfigured } from './booking/google';
import { buildAvailabilitySlotsForDate, calendarQueryRangeForDate } from './booking/scheduling';
import { validateSubmission } from './booking/validation';
import type { NormalizedLead, PhotoReference } from './booking/types';
import { aiBookingMetadata } from './ai-booking-metadata';
export function validateAiPayload(value:unknown):AiBookingPayload {
  if(!value||typeof value!=='object')throw new Error('Invalid request.');
  const p=value as AiBookingPayload;
  if(!UUID.test(p.estimateId)||!UUID.test(p.requestId)||!Number.isInteger(p.quoteRevision)||p.quoteRevision<1||p.quoteRevision>25)throw new Error('Invalid reference.');
  const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
  if(!text(p.originalQuote,16000)||!p.originalQuote||!text(p.projectDescription,28000)||!p.projectDescription||!text(p.notes,1000))throw new Error('Invalid description.');
  if(!Array.isArray(p.confirmedScope)||p.confirmedScope.length>40||p.confirmedScope.some(s=>!text(s,180)))throw new Error('Invalid scope.');
  if(!Array.isArray(p.selectedServices)||p.selectedServices.length<1||p.selectedServices.length>7||p.selectedServices.some(s=>!['mixed junk','furniture','demo debris','appliances','cardboard only','storage relocation','concrete / dirt / heavy debris'].includes(s)))throw new Error('Invalid services.');
  if(!p.customer||!text(p.customer.name,100)||!text(p.customer.email,254)||!text(p.customer.phone,30))throw new Error('Invalid contact.');
  if(!p.address||!text(p.address.street,240)||!text(p.address.city,120)||!text(p.address.state,2)||!text(p.address.zip,10)||!text(p.address.accessNotes,800))throw new Error('Invalid address.');
  if(!p.requestedSlot||!text(p.requestedSlot.start,35)||!text(p.requestedSlot.end,35)||!text(p.requestedSlot.label,160)||!Number.isFinite(Date.parse(p.requestedSlot.start))||!Number.isFinite(Date.parse(p.requestedSlot.end)))throw new Error('Invalid time.');
  if(!Array.isArray(p.photos)||p.photos.length>10||p.photos.some(f=>!UUID.test(f.id)||!Number.isInteger(f.size)||f.size<1||f.size>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.contentType))||p.photos.reduce((s,f)=>s+f.size,0)>35*1024*1024)throw new Error('Invalid photos.');
  const check=validateSubmission({services:p.services,appointmentType:'Service Appointment Request',customer:p.customer,address:p.address,projectDescription:'AI pricer confirmed scope',photos:[],requestedSlot:p.requestedSlot,startedAt:Date.now()-5000});
  if(!check.ok)throw new Error('Invalid booking details.');
  return p;
}
export function aiLeadId(estimateId:string){return `AI-${estimateId}`;}
async function copyPhotos(p:AiBookingPayload,leadId:string):Promise<PhotoReference[]> {
  const photos:PhotoReference[]=[];
  for(const photo of p.photos) {
    const pathname=`booking-photos/leads/${leadId}/ai-${photo.id}`;
    let exists=false;try {const metadata=await head(pathname,{storeId:process.env.BLOB_STORE_ID});exists=metadata.pathname===pathname&&metadata.size===photo.size&&metadata.contentType===photo.contentType&&new URL(metadata.url).hostname.endsWith('.private.blob.vercel-storage.com');if(!exists)throw new Error('Stored photo mismatch.');}catch{/* Copy a missing photo; immutable put rejects a conflicting existing object. */}
    if(!exists) {
      const response=await bridgeFetch(configuredOrigin('AI_PRICER_ORIGIN'),'/api/booking/photo-export',{estimateId:p.estimateId,requestId:p.requestId,photoId:photo.id},process.env.AI_PRICER_PREVIEW_BYPASS);
      if(!response.ok||response.headers.get('content-type')!==photo.contentType)throw new Error('Photo transfer unavailable.');
      const reader=response.body?.getReader();if(!reader)throw new Error('Photo unavailable.');
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>photo.size){await reader.cancel();throw new Error('Photo size mismatch.');}chunks.push(value);}
      if(size!==photo.size)throw new Error('Photo incomplete.');
      try {await put(pathname,Buffer.concat(chunks),{access:'private',contentType:photo.contentType,addRandomSuffix:false,allowOverwrite:false,storeId:process.env.BLOB_STORE_ID});}
      catch {const stored=await head(pathname,{storeId:process.env.BLOB_STORE_ID});if(stored.size!==photo.size||stored.contentType!==photo.contentType)throw new Error('Photo copy mismatch.');}
    }
    photos.push({id:pathname,url:pathname,name:`photo-${photos.length+1}`,size:photo.size,contentType:photo.contentType});
  }
  // Copies stay private and are never deleted on uncertain Sheet writes. Source
  // pricer objects are read-only. Deterministic paths make retries safe.
  return photos;
}
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
function payloadHash(p:AiBookingPayload) { return createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex'); }
function receipt(lead:{leadId:string;requestedTime:string;status:string;internalNotes:string},p:AiBookingPayload){
  const metadata=aiBookingMetadata(lead.internalNotes);
  if(metadata?.payloadHash!==payloadHash(p)||metadata?.requestId!==p.requestId)
    return {status:409,body:{error:'An existing request has different details. Contact WHS; no new request was created.'}};
  if(lead.status!=='Pending Approval')return {status:409,body:{error:'This request has already been reviewed. Contact WHS for its current status.'}};
  return {status:200,body:{ok:true,pending:true,leadId:lead.leadId,requestId:p.requestId,requestedTime:lead.requestedTime}};
}
export async function submitAiBooking(p:AiBookingPayload) {
  // Controlled shared-service testing only. No browser flag can enable writes.
  if(process.env.VERCEL_ENV!=='preview'||process.env.AI_PRICER_SYNTHETIC_TEST_MODE!=='true')throw new Error('Synthetic Preview booking is not enabled.');
  if(!p.customer.name.startsWith('TEST \u2014 WHS AI Pricer'))throw new Error('Use the required synthetic test label.');
  if(!googleConfigured())throw new Error('Booking unavailable.');
  const leadId=aiLeadId(p.estimateId),existing=await getLeadById(leadId);
  if(existing)return receipt(existing,p);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.requestedSlot.start));
  const range=calendarQueryRangeForDate(date);if(!range)throw new Error('Invalid date.');
  const busy=await getCalendarBusyWindows(range.timeMin,range.timeMax);
  const slot=buildAvailabilitySlotsForDate(date,busy).find(s=>s.start===p.requestedSlot.start&&s.end===p.requestedSlot.end);
  if(!slot)return {status:409,body:{error:'That time is no longer available. Please choose another.',unavailable:true}};
  const photos=await copyPhotos(p,leadId);
  const validation=validateSubmission({services:p.services,appointmentType:'Service Appointment Request',address:p.address,projectDescription:'AI pricer confirmed scope',customer:p.customer,requestedSlot:slot,photos,startedAt:Date.now()-5000});
  if(!validation.ok)throw new Error('Invalid booking.');
  const lead:NormalizedLead={...validation.value,projectDescription:p.projectDescription};
  const metadata=JSON.stringify({source:'AI Pricer',synthetic:true,requestId:p.requestId,estimateId:p.estimateId,quoteRevision:p.quoteRevision,originalQuote:JSON.parse(p.originalQuote),selectedServices:p.selectedServices,confirmedScope:p.confirmedScope,specialNotes:p.notes,payloadHash:payloadHash(p)});
  const saved=await appendAiPricerLead(leadId,lead,metadata);
  return receipt(saved,p);
}
