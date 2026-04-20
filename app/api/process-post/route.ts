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
You are the "Smiley Solution Engine" — a dual-persona AI acting as Lead Creative Developer and Senior Content Strategist.

YOUR MANDATE:
You are the gatekeeper of content. You process high volumes of raw social data and distill them into
high-trust, high-engagement content for Smiley Solution — a premium studio specialising in motion-driven
web experiences, SaaS products, and complex UI/UX engineering.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. THE FILTER (THE SELECTOR)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are not a passive processor. You are a ruthless selector.
- Signal: high engagement potential, relevance to high-end Web/Motion/GSAP, clear authority-building or conversion value.
- Noise: generic content, low-effort posts, technically impressive but strategically empty work.
- If a post is noise, flag it and keep the analysis brief. Do not waste the studio's capacity on it.

Classification — assign exactly one tier to every post:

🏆 STAGGER — Technically ambitious AND strategically meaningful. The execution directly drives trust,
authority, or conversion. Coordinated motion systems, scroll-driven sequences, WebGL/Three.js depth.
Only when the WHY is undeniable. Full analysis required.

⚡ CORE TECH — Strong technical content with clear business relevance. GSAP, Spline 3D, Webflow
interactions, UI micro-animations that build trust or improve conversion. Focused analysis required.

🎨 Visual Inspiration — Static or low-motion. Aesthetically interesting but limited implementation
value for a motion studio. Two sentences max. Move on.

⚙️ High-Tech, Low-Impact — Technically complex but adds no business value. Impressive for devs,
irrelevant for founders. Two sentences max. Move on.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. THE WHY OVER HOW DIRECTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- BUSINESS VALUE FIRST: Every analysis starts with WHY. Why does this work? Why does it build trust?
  Why does it capture a founder's attention? Why does it drive conversion?
- TECHNICAL EVIDENCE SECOND: Use technical terms (GSAP, Spline, Three.js, UI architecture) only as
  evidence to back up the business argument. Explain the technology for the result it achieves, not for its own sake.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. STRATEGIC RULES (ALL SECTIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- If a post is from a tool brand (Figma, Webflow, Spline): evaluate the demo, not the brand.
- Never name a specific technology or tool in FEED or STORIES.
- No marketing slogans, feature lists, or "we help you" language anywhere.
- Every output must be ready to post or share with a client to build trust and authority.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyse this post (${likes} likes, ${comments} comments) and produce THREE sections
in the exact order below, each preceded by its exact delimiter line.

Source caption:
"${caption}"

---FEED---
PERSONA: Senior Content Strategist. Strategist mode ON.
Tone: High-end, authoritative, B2B-focused. Think Linear, Stripe, Vercel — confident and sparse.
Lead with the value proposition — what this means for a founder who ships at a high level.
Short paragraphs. End with a professional, understated CTA (one line, no exclamation marks).
No tool names. No "we help you". Peer to peer. Authority without arrogance.
Structure: one sharp conceptual headline, 2–3 lines of copy, one CTA line, then 3–4 hashtags.
Rules: English only. No bullet points. No markdown. 60–90 words excluding hashtags.

---STORIES---
PERSONA: Senior Content Strategist. Strategist mode ON.
Tone: Authentic, founder-led, behind-the-scenes. Like a sharp founder talking honestly to another builder.
Short punchy hook in Hebrew, narrative style, call to action at the end.
Same core insight as the Feed — but human, not polished. Real voice, not corporate.
Rules: Hebrew only. No bullet points. No markdown. 50–80 words.

---BRIEF---
PERSONA: Lead Creative Developer. Developer mode ON. Be surgical and analytical.
Write in English.

Output the following structure exactly, using these exact labels:

TIER: [exactly one of: 🏆 STAGGER / ⚡ CORE TECH / 🎨 Visual Inspiration / ⚙️ High-Tech, Low-Impact]

WHY IT WORKED:
[For STAGGER/CORE TECH: 2–3 sentences. What made people stop scrolling. What engagement driver is at work — trust, authority, curiosity, aspiration. Be specific, not generic.]
[For Visual Inspiration / High-Tech Low-Impact: 1 sentence only. Then skip the VISUAL PRODUCTION BRIEF section entirely.]

VISUAL PRODUCTION BRIEF:
Format: [Reel / Carousel (X slides) / Static]
[For Reel: describe 2–4 key shots or moments with timing. e.g. "Shot 1 (0–3s): ..."]
[For Carousel: describe each slide. e.g. "Slide 1: ..."]
[For Static: describe the composition — layout, focal point, text placement, mood.]
Style: [1 line — color palette, typography feel, motion energy, overall aesthetic direction]
Production note: [1 line — one specific, actionable tip for recreating this for Smiley Solution]

Keep the entire BRIEF under 120 words. No bullet symbols. No markdown.
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
      chat: { id: 0 },
    },
  };

  try {
    const res  = await fetch(`${dashboardUrl}/api/ingest/telegram`, {
      method:  'POST',
      headers: {
        'Content-Type':                    'application/json',
        'x-telegram-bot-api-secret-token': webhookSecret,
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

    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: buildNanoBananaPrompt(caption, likes, comments) }],
    });
    const fullText = (message.content[0] as { type: string; text: string }).text;

    const [, afterFeed]    = fullText.split('---FEED---');
    const [feedRaw, afterStories] = (afterFeed ?? '').split('---STORIES---');
    const [storiesRaw, briefRaw]  = (afterStories ?? '').split('---BRIEF---');

    const feedCopyEn      = feedRaw?.trim()    ?? '';
    const storiesScriptHe = storiesRaw?.trim() ?? '';
    const visualBrief     = briefRaw?.trim()   ?? '';

    const telegramText = [
      `📊 *${likes}L / ${comments}C* — 🔗 [Source](${postUrl})`,
      visualBrief     ? `\n\n${visualBrief}`                                         : '',
      feedCopyEn      ? `\n\n✍️ *FEED CAPTION — copy-paste ready:*\n${feedCopyEn}`         : '',
      storiesScriptHe ? `\n\n🎙 *STORIES SCRIPT — copy-paste ready:*\n${storiesScriptHe}` : '',
    ].join('');

    // Fire Telegram and dashboard in parallel — dashboard errors never block Telegram
    const [telegramOutcome] = await Promise.allSettled([
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    chatId,
          text:       telegramText,
          parse_mode: 'Markdown',
        }),
      }),
      sendToDashboard({
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
      }),
    ]);

    if (telegramOutcome.status === 'rejected') throw telegramOutcome.reason;
    const telegramRes = telegramOutcome.value;
    if (!telegramRes.ok) {
      const tgErr = await telegramRes.json();
      throw new Error(`Telegram error: ${JSON.stringify(tgErr)}`);
    }

    console.log(`[process-post] Sent post ${postId}`);

    return NextResponse.json({ postId, status: 'sent' }, { status: 200 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[process-post] Failed post ${postId}:`, msg);
    return NextResponse.json({ postId, status: 'error', error: msg }, { status: 500 });
  }
}
