/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const TOP_N = 6; // how many posts to send per run

interface ApifyItem {
  id?:            string;
  url?:           string;
  type?:          string;
  caption?:       string;
  likesCount?:    number;
  commentsCount?: number;
  ownerUsername?: string;
}

function isValidItem(item: ApifyItem): boolean {
  return (
    (item.type === 'Video' || item.type === 'Image' || item.type === 'Video/Image') &&
    !!item.id   && item.id  !== 'undefined' &&
    !!item.url  && item.url !== 'undefined'
  );
}

function buildNanoBananaPrompt(caption: string, likes: number, comments: number): string {
  return `
You are the content voice of Smiley Solution — a tech studio that builds digital products
people love and systems that hold under pressure.

Studio philosophy: "We don't start with requirements. We start with understanding."
Core values: Clarity, Craft, Excellence, Precision, Performance, Partnership.

Your audience: founders and business leaders who are responsible for outcomes — revenue,
trust, market position. They don't want to hear about tools or frameworks.
They want to understand why decisions compound into results.

Your tone: a trusted partner, not a vendor. Direct, grounded, and clear.
You share insight the way a co-founder would — without selling, without jargon.

---

Three pillars to weave into every post. Do not list them. Let them shape the argument:

1. ROI — Visual excellence is not aesthetic preference. It is a business decision.
   Great digital products build trust before a single word is read, shorten the path
   to conversion, and drive engagement that compounds over time.
   Connect the insight to outcomes: trust, retention, revenue.

2. TTM / TTV — Speed and craft are not opposites. The studio delivers without cutting
   corners because the process — Discovery → Architecture → Engineering → Deployment —
   is already optimised. Faster time-to-market and faster time-to-value are the result
   of clarity up front, not shortcuts at the end.

3. The 'Why' over the 'How' — Never name tools, stacks, or frameworks in the post.
   Explain why a technological decision creates a system that holds under pressure,
   scales with the business, and earns the trust of its users. The 'what' is invisible.
   The 'why' is everything.

---

You have been given a high-engagement social media post (${likes} likes, ${comments} comments).
Extract the core idea from the caption and rewrite it as a Smiley Solution post in English.

Use this exact structure:

[Headline]
One declarative line. Conceptual and precise. No question marks. No exclamation points.
Name the idea — not the content, not the tool, not the feature.

[Body — paragraph 1]
Reframe the insight through the ROI pillar. What does this signal about how ambitious
businesses build trust and drive results through their digital presence?
Use the studio's vocabulary: visual fidelity, clarity, craft, strategic alignment,
systems that generate, built to the highest standard.

[Body — paragraph 2]
Connect to TTM/TTV and the 'Why'. How does getting this right — from the first decision —
compress time-to-value and create something that holds under pressure?
Speak as a partner who has already mapped this path, not a developer explaining a process.

[Signature]
One closing sentence. Understated. No calls-to-action.
It should feel like something a founder says to another founder — not a tagline.
Cadence example (do not copy verbatim): "This is the standard we build to."

#hashtag1 #hashtag2 #hashtag3 #hashtag4

---

Source post caption:
"${caption}"

Rules:
- English only
- 130–190 words total, excluding hashtags
- No bullet points, no numbered lists in the output
- Do not reference tools, frameworks, or technical stack
- Output only the final post — no labels, no commentary, no markdown headings
  `.trim();
}

export async function POST(req: Request) {
  // Env validation
  const apifyToken      = process.env.APIFY_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const botToken        = process.env.TELEGRAM_BOT_TOKEN;
  const chatId          = process.env.TELEGRAM_CHAT_ID;

  const missingVars = [
    !apifyToken      && 'APIFY_TOKEN',
    !anthropicApiKey && 'ANTHROPIC_API_KEY',
    !botToken        && 'TELEGRAM_BOT_TOKEN',
    !chatId          && 'TELEGRAM_CHAT_ID',
  ].filter(Boolean);

  if (missingVars.length > 0) {
    const msg = `Missing env vars: ${missingVars.join(', ')}`;
    console.error('[webhook] ' + msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let step = 'parse_body';
  try {
    // 1. Parse Apify webhook body
    const body      = await req.json();
    const datasetId = body.resource?.defaultDatasetId;

    if (!datasetId) {
      console.error('[webhook] Missing datasetId. Payload:', JSON.stringify(body));
      return NextResponse.json(
        { error: 'No dataset ID found', receivedPayload: body },
        { status: 400 }
      );
    }

    // 2. Fetch items from Apify
    step = 'apify_fetch';
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`
    );
    if (!apifyResponse.ok) {
      throw new Error(`Apify responded ${apifyResponse.status}: ${await apifyResponse.text()}`);
    }
    const rawItems: ApifyItem[] = await apifyResponse.json();

    // 3. Filter invalid items, sort by engagement, take top N
    step = 'filter_and_rank';
    const topPosts = rawItems
      .filter(isValidItem)
      .sort((a, b) => {
        const eA = (a.likesCount || 0) + (a.commentsCount || 0);
        const eB = (b.likesCount || 0) + (b.commentsCount || 0);
        return eB - eA;
      })
      .slice(0, TOP_N);

    console.log(`[webhook] ${rawItems.length} raw → ${topPosts.length} valid top posts`);

    if (topPosts.length === 0) {
      return NextResponse.json({ status: 'No valid items after filtering' }, { status: 200 });
    }

    // 4. For each post: generate Nano Banana copy → send to Telegram
    step = 'process_posts';
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const results: { postId: string; status: string; error?: string }[] = [];

    for (const post of topPosts) {
      const postId  = post.id!;
      const postUrl = post.url!;
      const likes    = post.likesCount    || 0;
      const comments = post.commentsCount || 0;
      const caption  = post.caption       || 'No caption';

      try {
        // Generate Nano Banana formatted post
        const message = await anthropic.messages.create({
          model:      'claude-sonnet-4-5',
          max_tokens: 512,
          messages:   [{
            role:    'user',
            content: buildNanoBananaPrompt(caption, likes, comments),
          }],
        });
        const formattedPost = (message.content[0] as { type: string; text: string }).text;

        // Send to Telegram
        const telegramRes = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              chat_id:    chatId,
              text:       `📊 *${likes}L / ${comments}C*\n\n${formattedPost}\n\n🔗 [Original Post](${postUrl})`,
              parse_mode: 'Markdown',
            }),
          }
        );

        if (!telegramRes.ok) {
          const tgErr = await telegramRes.json();
          console.error(`[webhook] Telegram failed for post ${postId}:`, tgErr);
          results.push({ postId, status: 'telegram_failed', error: JSON.stringify(tgErr) });
          continue; // don't stop — move to next post
        }

        results.push({ postId, status: 'sent' });
        console.log(`[webhook] Sent post ${postId}`);

      } catch (postError) {
        // One post failing must not stop the loop
        const msg = postError instanceof Error ? postError.message : String(postError);
        console.error(`[webhook] Error on post ${postId}:`, msg);
        results.push({ postId, status: 'error', error: msg });
      }
    }

    return NextResponse.json({ status: 'Done', results }, { status: 200 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] FAILED at step="${step}":`, error);
    return NextResponse.json(
      { error: 'Internal Server Error', step, detail: msg },
      { status: 500 }
    );
  }
}
