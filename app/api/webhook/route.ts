import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const data = await req.json();

    // This is the log you will see in Netlify to verify that the information has arrived
    console.log("--- New Data Received from Apify ---");
    console.log(JSON.stringify(data, null, 2));

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to parse JSON' }, { status: 400 });
  }
}

// Optional: Short GET just to make sure the URL is live in the browser
export async function GET() {
  return new Response("Webhook Gateway is Live", { status: 200 });
}
