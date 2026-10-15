import { boundedBridgeBody,verifyBridge } from '@/app/lib/ai-booking-bridge';
import { submitAiBooking,validateAiPayload } from '@/app/lib/ai-pricer-intake';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(req:Request) {
  try {const raw=await boundedBridgeBody(req);if(!verifyBridge(req,raw))return Response.json({error:'Unauthorized.'},{status:401});
    let payload;try {payload=validateAiPayload(JSON.parse(raw));}catch{return Response.json({error:'Invalid booking details.'},{status:400});}
    const result=await submitAiBooking(payload);return Response.json(result.body,{status:result.status,headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Your request could not be confirmed. Retry the same request.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
