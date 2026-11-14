import { timingSafeEqual } from "node:crypto";
import { digestDueNow } from "../../../lib/command-center/digest";
import { sendDailyDigest } from "../../../lib/command-center/send-digest";
import { CommandCenterError } from "../../../lib/command-center/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ ok: false, message: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // Two daily UTC schedules cover daylight/standard time; only 08:xx Pacific sends.
  if (!digestDueNow()) return Response.json({ ok: true, skipped: true, message: "Outside the 8 AM Pacific delivery window." }, { headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ ok: true, ...await sendDailyDigest() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("command-center.digest", { status: error instanceof CommandCenterError ? error.status : 503 });
    return Response.json({ ok: false, message: "Daily digest could not be delivered. Check the delivery receipt and configuration." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
