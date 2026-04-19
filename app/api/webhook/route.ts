import { NextResponse } from 'next/server';

const TOP_PER_CREATOR   = 5;  // up to 5 best posts per creator → max 55 total (5 × 11 creators)
const DATASET_THRESHOLD = 10; // minimum unique posts expected — abort + alert if below

const CREATOR_WHITELIST = new Set([
  'awwwards',
  'splinetool',
  'webflow',
  'gsap_greensock',
  'dribbble',
  'developers_society',
  'figma',
  'sebintel',
  'timkoda_',
  'keanu.visuals',
  'lina.tech.flat',
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
  timestamp?:     string; // ISO date string — used for 24h freshness filter
}

const FRESHNESS_HOURS = 72; // 3 days — Apify may return posts up to a few days old

function isValidItem(item: ApifyItem): boolean {
  // Freshness check — skip posts older than 24h if timestamp is present
  if (item.timestamp) {
    const cutoff = new Date(Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000);
    if (new Date(item.timestamp) < cutoff) return false;
  }

  return (
    (item.type === 'Video' || item.type === 'Image' || item.type === 'Sidecar' ||
     item.type === 'GraphImage' || item.type === 'GraphSidecar' || item.type === 'GraphVideo') &&
    !!item.id           && item.id      !== 'undefined' &&
    !!item.url          && item.url     !== 'undefined' &&
    !!item.caption      && item.caption.length >= 20 &&
    !!item.ownerUsername && CREATOR_WHITELIST.has(item.ownerUsername)
  );
}

async function validateDataset(
  count: number,
  botToken: string | undefined,
  chatId: string | undefined,
): Promise<boolean> {
  if (count >= DATASET_THRESHOLD) return true;

  console.warn(`[webhook] Validation failed: only ${count} unique posts (threshold: ${DATASET_THRESHOLD})`);

  if (botToken && chatId) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id: chatId,
        text:    `⚠️ *Scraper Warning: Low data count received.*\nGot ${count} posts from Apify (threshold: ${DATASET_THRESHOLD}).\nCheck Apify actor — possible scraper failure or blocked accounts.`,
        parse_mode: 'Markdown',
      }),
    }).catch(err => console.error('[webhook] Failed to send alert:', err));
  }

  return false;
}

export async function POST(req: Request) {
  const apifyToken = process.env.APIFY_TOKEN;
  const botToken   = process.env.TELEGRAM_BOT_TOKEN;
  const chatId     = process.env.TELEGRAM_CHAT_ID;

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

    // Diagnostic — log structure of first item + all unique type values seen
    console.log('[webhook] Sample item (first raw):', JSON.stringify(rawItems[0] ?? null, null, 2));
    console.log('[webhook] Unique types in dataset:', [...new Set(rawItems.map(i => i.type))]);

    // Deduplicate by post ID before any further processing
    const uniqueItems = Array.from(new Map(rawItems.map(item => [item.id, item])).values());

    // Validate dataset volume — abort and alert if below threshold
    step = 'validate_dataset';
    const isValid = await validateDataset(uniqueItems.length, botToken, chatId);
    if (!isValid) {
      return NextResponse.json(
        { status: 'Aborted — low data count', received: uniqueItems.length, threshold: DATASET_THRESHOLD },
        { status: 200 },
      );
    }

    // Filter → group by creator → top 5 per creator → flatten
    step = 'filter_and_rank';
    const validItems = uniqueItems.filter(isValidItem);

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

    console.log(`[webhook] ${rawItems.length} raw → ${uniqueItems.length} unique → ${validItems.length} valid → ${byCreator.size} creators → ${topPosts.length} selected (top ${TOP_PER_CREATOR} per creator)`);

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
