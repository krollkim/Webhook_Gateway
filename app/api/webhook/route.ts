import { NextResponse } from 'next/server';

const TOP_PER_CREATOR = 5; // up to 5 best posts per creator → max 30 total (5 × 6 creators)

const CREATOR_WHITELIST = new Set([
  'keanu.visuals',
  'aristidebenoist',
  'akella_',
  'lina.tech.flat',
  'sebintel',
  'timkoda_',
]);

interface ApifyItem {
  id?:            string;
  url?:           string;
  type?:          string;
  caption?:       string;
  likesCount?:    number;
  commentsCount?: number;
  ownerUsername?: string;
  displayUrl?:    string;
  images?:        string[];
  videoUrl?:      string;
}

function isValidItem(item: ApifyItem): boolean {
  return (
    (item.type === 'Video' || item.type === 'Image' || item.type === 'Video/Image') &&
    !!item.id           && item.id      !== 'undefined' &&
    !!item.url          && item.url     !== 'undefined' &&
    !!item.caption      && item.caption.length >= 20 &&
    !!item.ownerUsername && CREATOR_WHITELIST.has(item.ownerUsername)
  );
}

export async function POST(req: Request) {
  const apifyToken = process.env.APIFY_TOKEN;

  if (!apifyToken) {
    return NextResponse.json({ error: 'Missing APIFY_TOKEN' }, { status: 500 });
  }

  let step = 'parse_body';
  try {
    const body      = await req.json();
    const datasetId = body.resource?.defaultDatasetId;

    if (!datasetId) {
      console.error('[webhook] Missing datasetId. Payload:', JSON.stringify(body));
      return NextResponse.json({ error: 'No dataset ID found', receivedPayload: body }, { status: 400 });
    }

    // Fetch items from Apify
    step = 'apify_fetch';
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`
    );
    if (!apifyResponse.ok) {
      throw new Error(`Apify responded ${apifyResponse.status}: ${await apifyResponse.text()}`);
    }
    const rawItems: ApifyItem[] = await apifyResponse.json();

    // Filter → group by creator → top 5 per creator → flatten
    step = 'filter_and_rank';
    const validItems = rawItems.filter(isValidItem);

    const byCreator = new Map<string, ApifyItem[]>();
    for (const item of validItems) {
      const creator = item.ownerUsername || 'unknown';
      if (!byCreator.has(creator)) byCreator.set(creator, []);
      byCreator.get(creator)!.push(item);
    }

    const topPosts: ApifyItem[] = [];
    for (const [, posts] of byCreator) {
      const sorted = posts.sort((a, b) => {
        const eA = (a.likesCount || 0) + (a.commentsCount || 0);
        const eB = (b.likesCount || 0) + (b.commentsCount || 0);
        return eB - eA;
      });
      topPosts.push(...sorted.slice(0, TOP_PER_CREATOR));
    }

    console.log(`[webhook] ${rawItems.length} raw → ${validItems.length} valid → ${byCreator.size} creators → ${topPosts.length} selected (top ${TOP_PER_CREATOR} per creator)`);

    if (topPosts.length === 0) {
      return NextResponse.json({ status: 'No valid items after filtering' }, { status: 200 });
    }

    // Fire one request per post to /api/process-post — each gets its own 30s budget
    step = 'fire_sub_requests';
    const origin     = new URL(req.url).origin;
    const processUrl = `${origin}/api/process-post`;

    for (const post of topPosts) {
      fetch(processUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(post),
      }).catch(err => console.error(`[webhook] sub-request fire error for ${post.id}:`, err));
      await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ status: 'Triggered', count: topPosts.length }, { status: 200 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] FAILED at step="${step}":`, error);
    return NextResponse.json({ error: 'Internal Server Error', step, detail: msg }, { status: 500 });
  }
}

export async function GET() {
  return new Response(JSON.stringify({
    status:    'success',
    message:   'API "listener" is running successfully',
    timestamp: new Date().toISOString(),
  }), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}
