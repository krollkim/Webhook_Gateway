/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // ── Env validation (fail fast with a clear message) ──────────────────────
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
    // 1. Parse body
    const body = await req.json();
    const datasetId = body.resource?.defaultDatasetId;

    if (!datasetId) {
      console.error('[webhook] Missing datasetId. Payload received:', JSON.stringify(body));
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
    const items = await apifyResponse.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ status: 'No items to process' }, { status: 200 });
    }

    // 3. Pick winner post
    step = 'pick_winner';
    const winnerPost = [...items].sort((a: any, b: any) => {
      const engagementA = (a.likesCount || 0) + (a.commentsCount || 0);
      const engagementB = (b.likesCount || 0) + (b.commentsCount || 0);
      return engagementB - engagementA;
    })[0];

    const rawCaption = winnerPost.caption || 'No caption found';
    const postUrl    = winnerPost.url      || 'No URL found';
    const stats = {
      likes:    winnerPost.likesCount    || 0,
      comments: winnerPost.commentsCount || 0,
    };

    // 4. Claude analysis
    step = 'claude_api';
    const systemPrompt = `
      Context:
      אתה האסטרטג הראשי של Smiley Solution - סטודיו לעיצוב ופיתוח High-end המתמחה ב-Editorial Minimalism ובביצועי קצה (GSAP).
      אנחנו לא בונים "אתרים", אנחנו בונים "נכסים דיגיטליים" שמייצרים ROI מובהק ללקוח.
      הפוסט שנבחר לניתוח הוא ה-"Winner" מתוך הסריקה האחרונה - זה הפוסט עם ה-Engagement הגבוה ביותר (${stats.likes} לייקים, ${stats.comments} תגובות).

      Task:
      נתח למה הפוסט הזה ספציפית "שבר את האינטרנט". האם זה ה-Hook? האם זה הערך הוויזואלי?
      איך אנחנו יכולים לקחת את המומנטום הזה ולתרגם אותו לשפת ה-Editorial Minimalism שלנו?

      Output Framework (Markdown for Telegram):

      💎 **Strategic Insight (The 'Why')**
      נתח את הפסיכולוגיה הצרכנית מאחורי הפוסט. מה הם מנסים למכור ברמת התת-מודע? (סמכות? פתרון כאב מהיר?).

      🚀 **Conversion & ROI Analysis**
      איך האלמנטים בפוסט הזה משפיעים על ה-TTV (Time To Value) של הלקוח?
      האם יש פה טכניקה של צמצום TTM (Time To Market) שאנחנו יכולים ללמוד ממנה?

      🎨 **The Smiley Standard (Technical/Design)**
      איך היינו מיישמים את זה בסטודיו תחת השפה של Editorial Minimalism?
      (למשל: שימוש ב-GSAP ScrollTrigger כדי להעביר את המסר במינימום חיכוך).

      💰 **Sales Pitch Gold**
      תן לי "שורת מחץ" לשיחת מכירה הבאה שלי שמבוססת על התובנה הזו. משהו שיגרום ללקוח להבין שאנחנו רואים נתונים וערך, לא רק פיקסלים.

      Instructions:
      - טון חד, יוקרתי, ואנליטי.
      - אל תחזור על המידע בפוסט, תן פרשנות (Insights over Info).
      - הטקסט בתוך הניתוח חייב להיות בעברית.
    `;

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Data to analyze:\n' + rawCaption }],
    });

    const aiResponse = (message.content[0] as { type: string; text: string }).text;

    // 5. Send to Telegram
    step = 'telegram';
    const telegramBody = {
      chat_id:    chatId,
      text:       `🚀 **Smiley Scout: High-Engagement Insight**\n\n📊 *Stats:* ${stats.likes} Likes | ${stats.comments} Comments\n\n${aiResponse}\n\n🔗 [Link to Winner Post](${postUrl})`,
      parse_mode: 'Markdown',
    };

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(telegramBody),
      }
    );

    if (!telegramResponse.ok) {
      const telegramError = await telegramResponse.json();
      console.error('[webhook] Telegram error:', telegramError);
      // Not throwing — Telegram failure shouldn't kill the whole flow
    }

    return NextResponse.json({ status: 'Success' }, { status: 200 });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] FAILED at step="${step}":`, error);
    // TODO: remove "step" and "detail" from response once debugging is done
    return NextResponse.json(
      { error: 'Internal Server Error', step, detail: message },
      { status: 500 }
    );
  }
}
