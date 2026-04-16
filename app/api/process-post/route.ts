import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

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

function buildNanoBananaPrompt(caption: string, likes: number, comments: number): string {
  return `
You are the senior content strategist for Smiley Solution — a premium digital product studio.
You translate technical and design decisions into the language of business outcomes.

Your audience: CEOs and founders who measure success in ROI, retention, and time-to-value.
They don't want to know what you built — they want to understand why it matters.

Three strategic principles govern everything you write. Never state them explicitly — let them shape the logic:

1. ROI — every design or technology decision is a business decision.
   A digital product built correctly builds trust before a single word is read,
   shortens the path to conversion, and creates engagement that compounds over time.

2. TTM / TTV — clarity at the start equals fast delivery without shortcuts.
   The right way to shorten time-to-market is not to cut corners —
   it is to reach full clarity before writing a single line of code.

3. Why over How — never mention tools, languages, or technologies by name.
   Explain why the right decision creates a system that holds under pressure,
   scales with the business, and earns user trust.

Forbidden in all output: marketing slogans, feature lists, "what we're building" descriptions,
tool names, framework names, vague inspiration language.
Required in all output: strategic insight, business consequence, the authority of someone
who has already solved this problem.

---

Analyze this high-engagement post (${likes} likes, ${comments} comments) and extract its core strategic idea.
Then produce THREE sections in the exact order below, each preceded by its exact delimiter line.

Source caption:
"${caption}"

---FEED---
Write a premium English Instagram feed caption for Smiley Solution.
Style: Editorial Minimalism — think Awwwards, Stripe, Linear. Confident, sparse, no filler.
Tone: a senior creative director addressing founders who have taste and measure everything.
The copy must express a strategic insight or business consequence — not describe a visual or list steps.
No slogans. No "we help you". No feature descriptions. Speak as a peer, not a vendor.
Structure: one sharp conceptual headline, 2–3 lines of copy, then 3–4 relevant hashtags on the last line.
Rules: English only. No bullet points. No markdown. 60–90 words excluding hashtags.

---STORIES---
Write an authentic Hebrew script for an Instagram Story for Smiley Solution.
Style: direct, warm, conversational — like a sharp founder talking honestly to a peer.
Tone: "talky" and real. Short sentences. No corporate language. Can include a question.
The same strategic insight from the Feed should come through — but expressed like a real person,
not a consultant. Human first, strategic underneath.
Rules: Hebrew only. No bullet points. No markdown. 50–80 words.

---BRIEF---
Write in Hebrew. You are a senior tech studio lead evaluating this post for technical mastery and web potential.

First line — classification only, one of:
🎨 Visual Inspiration — if the post is static graphic design (photo edit, branding, typography)
⚡ CORE TECH — if the post shows complex motion, UI/UX interaction, or high-end web animations (GSAP style)

If Visual Inspiration: briefly describe the composition and how the visual style could translate into design assets for Smiley Solution.
If CORE TECH: focus on technical implementation — how you would build this effect in code, which libraries, and what is technically worth learning.

No markdown. No bullets. Up to 80 words.
  `.trim();
}

interface DashboardContent {
  title:             string;
  source_url:        string;
  raw_excerpt:       string;
  feed_copy_en:      string;
  stories_script_he: string;
  client_persona:    string;
  tags:              string[];
  engagement: {
    shares:     number;
    comments:   number;
    saves:      number;
    trend_tags: string[];
  };
}

async function sendToDashboard(contentData: DashboardContent): Promise<void> {
  const dashboardUrl   = process.env.DASHBOARD_URL;
  const webhookSecret  = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!dashboardUrl || !webhookSecret) {
    console.warn('[Dashboard] Missing Env Vars — skipping push');
    return;
  }

  const internalPayload = {
    title:             contentData.title,
    source_url:        contentData.source_url,
    raw_excerpt:       contentData.raw_excerpt,
    feed_copy_en:      contentData.feed_copy_en,
    stories_script_he: contentData.stories_script_he,
    client_persona:    contentData.client_persona,
    tags:              contentData.tags || [],
    engagement: {
      shares:     contentData.engagement?.shares     || 0,
      comments:   contentData.engagement?.comments   || 0,
      saves:      contentData.engagement?.saves      || 0,
      trend_tags: contentData.engagement?.trend_tags || [],
    },
  };

  const payload = {
    message: {
      text: JSON.stringify(internalPayload),
    },
  };

  try {
    const res  = await fetch(`${dashboardUrl}/api/ingest/telegram`, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();

    if (!res.ok) {
      console.error('[Dashboard] Ingest failed status:', res.status, json);
    } else {
      console.log(`[Dashboard] Success! ID: ${json.id} | Mode: ${json.mode}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Dashboard] Connection error:', msg);
  }
}

export async function POST(req: Request) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const botToken        = process.env.TELEGRAM_BOT_TOKEN;
  const chatId          = process.env.TELEGRAM_CHAT_ID;

  const missingVars = [
    !anthropicApiKey && 'ANTHROPIC_API_KEY',
    !botToken        && 'TELEGRAM_BOT_TOKEN',
    !chatId          && 'TELEGRAM_CHAT_ID',
  ].filter(Boolean);

  if (missingVars.length > 0) {
    const msg = `Missing env vars: ${missingVars.join(', ')}`;
    console.error('[process-post] ' + msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let post: ApifyItem;
  try {
    post = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const postId   = post.id   ?? 'unknown';
  const postUrl  = post.url  ?? '';
  const likes    = post.likesCount    ?? 0;
  const comments = post.commentsCount ?? 0;
  const caption  = post.caption       ?? 'No caption';

  try {
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // Collect image URLs: carousel → first 3 frames, otherwise displayUrl
    const imageUrls: string[] = [];
    if (post.images && post.images.length > 0) {
      imageUrls.push(...post.images.slice(0, 3));
    } else if (post.displayUrl) {
      imageUrls.push(post.displayUrl);
    }

    const imageContent = imageUrls.map(url => ({
      type:   'image' as const,
      source: { type: 'url' as const, url },
    }));

    let fullText: string;
    try {
      const message = await anthropic.messages.create({
        model:      'claude-sonnet-4-5',
        max_tokens: 1200,
        messages:   [{
          role:    'user',
          content: [
            ...imageContent,
            { type: 'text', text: buildNanoBananaPrompt(caption, likes, comments) },
          ],
        }],
      });
      fullText = (message.content[0] as { type: string; text: string }).text;
    } catch {
      // Image URLs rejected — fall back to text-only
      console.warn(`[process-post] Vision failed for ${postId}, retrying text-only`);
      const message = await anthropic.messages.create({
        model:      'claude-sonnet-4-5',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: buildNanoBananaPrompt(caption, likes, comments) }],
      });
      fullText = (message.content[0] as { type: string; text: string }).text;
    }

    const [, afterFeed]    = fullText.split('---FEED---');
    const [feedRaw, afterStories] = (afterFeed ?? '').split('---STORIES---');
    const [storiesRaw, briefRaw]  = (afterStories ?? '').split('---BRIEF---');

    const feedCopyEn      = feedRaw?.trim()    ?? '';
    const storiesScriptHe = storiesRaw?.trim() ?? '';
    const visualBrief     = briefRaw?.trim()   ?? '';

    const telegramText = [
      `📊 *${likes}L / ${comments}C*`,
      feedCopyEn      ? `\n📝 *Feed (EN):*\n${feedCopyEn}`           : '',
      storiesScriptHe ? `\n🎙 *Stories (HE):*\n${storiesScriptHe}`   : '',
      visualBrief     ? `\n🎨 *Brief ויז'ואל:*\n${visualBrief}`      : '',
      `\n\n🔗 [Original Post](${postUrl})`,
    ].join('\n');

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    chatId,
          text:       telegramText,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!telegramRes.ok) {
      const tgErr = await telegramRes.json();
      throw new Error(`Telegram error: ${JSON.stringify(tgErr)}`);
    }

    console.log(`[process-post] Sent post ${postId}`);

    // Push to dashboard — fire and forget, never blocks the Telegram response
    void sendToDashboard({
      title:             feedCopyEn.split('\n')[0],
      source_url:        postUrl,
      raw_excerpt:       caption,
      feed_copy_en:      feedCopyEn,
      stories_script_he: storiesScriptHe,
      client_persona:    '',
      tags:              [],
      engagement: {
        shares:     0,
        comments:   comments,
        saves:      0,
        trend_tags: [],
      },
    });

    return NextResponse.json({ postId, status: 'sent' }, { status: 200 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[process-post] Failed post ${postId}:`, msg);
    return NextResponse.json({ postId, status: 'error', error: msg }, { status: 500 });
  }
}
