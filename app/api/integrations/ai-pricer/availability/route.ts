import { boundedBridgeBody,verifyBridge } from '@/app/lib/ai-booking-bridge';
import { GET } from '@/app/api/booking/availability/route';
export const runtime='nodejs';
export async function POST(req:Request) {
  try {const raw=await boundedBridgeBody(req);if(!verifyBridge(req,raw))return Response.json({error:'Unauthorized.'},{status:401});
    const {date}=JSON.parse(raw);if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:'Choose a valid date.'},{status:400});
    const url=new URL('/api/booking/availability',req.url);url.searchParams.set('date',date);
    const response=await GET(new Request(url));response.headers.set('Cache-Control','no-store');return response;
  }catch{return Response.json({error:'Available times are temporarily unavailable.'},{status:503});}
}
