import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {bridgeHeaders,verifyBridge} from '../app/lib/ai-booking-bridge.ts';
import {submitAiBooking,validateAiPayload} from '../app/lib/ai-pricer-intake.ts';
import {appendAiPricerLead,getCalendarBusyWindows} from '../app/lib/booking/google.ts';
import {REQUIRED_SHEET_COLUMNS} from '../app/lib/booking/config.ts';
import {buildAvailabilitySlotsForDate} from '../app/lib/booking/scheduling.ts';

test('AI request validates signed identity, literal quote and confirmed scope; durable concurrent retries create one pending row',async()=>{
 const oldEnv={...process.env},oldFetch=globalThis.fetch;
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 Object.assign(process.env,{PRICER_BOOKING_ENABLED:'true',AI_PRICER_BRIDGE_SECRET:'synthetic-bridge-key-at-least-32-characters',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'synthetic@example.test',private_key:privateKey.export({type:'pkcs8',format:'pem'})}),GOOGLE_SPREADSHEET_ID:'synthetic-sheet',GOOGLE_SHEET_TAB:'Open Leads',GOOGLE_CALENDAR_ID:'synthetic-calendar'});
 const headers=[...REQUIRED_SHEET_COLUMNS],rows=[],receipts=new Set();let busy=[],calendarError=false,loseAck=false,writes=0;
 globalThis.fetch=async(input,options={})=>{
  const url=String(input),body=String(options.body??'').startsWith('{')?JSON.parse(String(options.body)):{};
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic-token',expires_in:3600});
  if(url.includes('/calendar/v3/freeBusy'))return Response.json({calendars:{'synthetic-calendar':calendarError?{errors:[{reason:'notFound'}]}:{busy}}});
  assert.ok(url.includes('/synthetic-sheet'),'No network access outside synthetic Sheet/Calendar');
  if(url.includes('?fields='))return Response.json({sheets:[{properties:{sheetId:7,title:'Open Leads'}}]});
  if(url.endsWith(':batchUpdate')){
   const key=body.requests[0].addNamedRange.namedRange.namedRangeId;
   if(receipts.has(key))return new Response('Duplicate receipt',{status:400});
   receipts.add(key);const row=body.requests[1].appendCells.rows[0].values;
   assert.ok(row.every(c=>'stringValue'in c.userEnteredValue));rows.push(row.map(c=>c.userEnteredValue.stringValue));writes++;
   if(loseAck){loseAck=false;throw new Error('Acknowledgement lost');}
   return Response.json({});
  }
  if(url.includes('!1%3A1')||url.includes('!1:1'))return Response.json({values:[headers]});
  // Header-only routes and full-row reads use slightly different encoded ranges.
  if(decodeURIComponent(url).endsWith('!1:1'))return Response.json({values:[headers]});
  return Response.json({values:structuredClone(rows)});
 };
 try {
  const date=new Date(Date.now()+5*86400000).toISOString().slice(0,10),slot=buildAvailabilitySlotsForDate(date,[])[0];assert.ok(slot);
  const payload={estimateId:randomUUID(),requestId:randomUUID(),quoteRevision:3,originalQuote:JSON.stringify({revision:2,displayed:{amount:'$330'}}),selectedServices:['furniture'],services:['Junk Removal'],customer:{name:'Synthetic Customer',email:'synthetic@example.test',phone:'+12025550100'},address:{street:'1 Test Street',city:'Irvine',state:'CA',zip:'92618',accessNotes:'Side gate'},notes:'Synthetic special note',projectDescription:'Remove the old sofa.',confirmedScope:['Sofa'],photos:[],requestedSlot:slot};
  validateAiPayload(payload);assert.throws(()=>validateAiPayload({...payload,customer:{...payload.customer,email:'bad'}}));assert.throws(()=>validateAiPayload({...payload,photos:[{id:'../bad',size:1,contentType:'image/jpeg'}]}));
  const raw=JSON.stringify(payload),path='/api/integrations/ai-pricer/submit',headersAuth=bridgeHeaders(path,raw);
  assert.ok(verifyBridge(new Request(`https://website.test${path}`,{headers:headersAuth}),raw));assert.equal(verifyBridge(new Request(`https://website.test${path}`,{headers:headersAuth}),raw+' '),false);
  const result=await Promise.all([submitAiBooking(payload),submitAiBooking(payload)]);assert.ok(result.every(r=>r.body.pending));assert.equal(writes,1);
  const row=rows[0],value=name=>row[headers.indexOf(name)];assert.equal(value('Status'),'Pending Approval');assert.equal(value('Appointment Type'),'AI Price / Estimate');assert.equal(value('Source'),'AI Pricer');assert.equal(value('Approved Amount'),'');
  const metadata=JSON.parse(value('Internal Notes'));assert.equal(metadata.estimateId,payload.estimateId);assert.equal(metadata.originalQuote.displayed.amount,'$330');assert.equal(metadata.specialNotes,payload.notes);assert.equal(value('Project Description'),payload.projectDescription);
  assert.equal((await submitAiBooking({...payload,requestId:randomUUID()})).body.leadId,result[0].body.leadId);assert.equal(writes,1);
  busy=[{start:slot.start,end:slot.end}];const conflict=await submitAiBooking({...payload,estimateId:randomUUID()});assert.equal(conflict.status,409);assert.equal(conflict.body.unavailable,true);assert.equal(writes,1);
  calendarError=true;await assert.rejects(getCalendarBusyWindows(slot.start,slot.end));calendarError=false;busy=[];
  const uncertain={...payload,estimateId:randomUUID()};loseAck=true;await assert.rejects(submitAiBooking(uncertain));const retried=await submitAiBooking(uncertain);assert.equal(retried.status,200);assert.equal(writes,2);
 }finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);}
});
