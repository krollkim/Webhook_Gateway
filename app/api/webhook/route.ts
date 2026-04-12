/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const TOP_N = 6; // one slot per creator — parallel calls handle the timeout

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
    !!item.id      && item.id      !== 'undefined' &&
    !!item.url     && item.url     !== 'undefined' &&
    !!item.caption && item.caption.length >= 20   // skip posts with no text to analyze
  );
}

function buildNanoBananaPrompt(caption: string, likes: number, comments: number): string {
  return `
אתה יועץ אסטרטגי בכיר של Smiley Solution — סטודיו לפיתוח מוצרים דיגיטליים.
אתה לא מתאר פיצ'רים. אתה מתרגם החלטות טכניות ועיצוביות לשפה של תוצאות עסקיות.

הקהל שלך: מנכ"לים ומייסדים שמודדים הצלחה ב-ROI, retention ו-time-to-value.
הם לא רוצים לדעת מה בנית — הם רוצים להבין למה זה משנה.

הטון: יועץ בכיר שמדבר עם שווה. חד, מדויק, ללא מילים מיותרות.
אסור: סיסמאות שיווקיות, רשימות פיצ'רים, תיאורי "מה אנחנו בונים".
חובה: תובנה אסטרטגית, השלכה עסקית, סמכות של מי שכבר פתר את הבעיה.

---

שלושה עקרונות שיעצבו את הפוסט. אל תציין אותם — תן להם לעצב את הלוגיקה:

1. ROI — כל החלטת עיצוב או טכנולוגיה היא החלטה עסקית.
   מוצר דיגיטלי שנבנה נכון בונה אמון לפני שנקראת מילה אחת,
   מקצר את הדרך להמרה, ויוצר engagement שמצטבר לאורך זמן.

2. TTM / TTV — בהירות בהתחלה = מסירה מהירה בלי קיצורי דרך.
   הדרך הנכונה לקצר time-to-market היא לא לחתוך בפינות —
   אלא להגיע לבהירות מלאה לפני שכותבים שורת קוד אחת.

3. ה-למה מעל ה-איך — לעולם אל תזכיר כלים, שפות או טכנולוגיות.
   הסבר למה ההחלטה הנכונה יוצרת מערכת שמחזיקה תחת לחץ,
   גדלה עם העסק, וזוכה באמון המשתמשים.

---

ניתחת פוסט בעל engagement גבוה (${likes} לייקים, ${comments} תגובות).
חלץ את הרעיון המרכזי וכתב ממנו פוסט בעברית עבור Smiley Solution.

המבנה המדויק:

[כותרת]
שורה אחת. הצהרה קונספטואלית. ללא סימן שאלה, ללא קריאה.
תן שם לרעיון — לא לתוכן, לא לכלי, לא לפיצ'ר.

[פסקה 1]
פרש את התובנה דרך עדשת ה-ROI. מה הפוסט הזה אומר על האופן שבו
עסקים רציניים בונים אמון ומניעים תוצאות דרך הנוכחות הדיגיטלית שלהם?

[פסקה 2]
חבר ל-TTM/TTV ול-למה. כיצד קבלת ההחלטה הנכונה מהרגע הראשון
מקצרת את ה-time-to-value ויוצרת מוצר שמחזיק תחת לחץ?
דבר כשותף שכבר מיפה את הדרך — לא כמפתח שמסביר תהליך.

[חתימה]
משפט סיום אחד. מאופק. ללא CTA.
שיישמע כמו משהו שמייסד אומר למייסד אחר — לא סלוגן.
דוגמה לקצב (אל תעתיק): "זה הסטנדרט שאנחנו בונים לפיו."

#עיצוב_דיגיטלי #smileysolution #ux #מוצר_דיגיטלי

---

קפטשן המקור:
"${caption}"

כללים:
- עברית בלבד
- 100–150 מילים, לא כולל hashtags
- ללא רשימות, ללא תבליטים
- ללא אזכור של כלים, שפות או טכנולוגיות
- פלט: הפוסט הסופי בלבד — ללא כותרות, ללא הסברים, ללא markdown
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

    // 3. Filter → best post per creator → top N across creators
    step = 'filter_and_rank';
    const validItems = rawItems.filter(isValidItem);

    // Group by creator, keep only their single best post by engagement
    const byCreator = new Map<string, ApifyItem>();
    for (const item of validItems) {
      const creator = item.ownerUsername || 'unknown';
      const existing = byCreator.get(creator);
      const itemEngagement = (item.likesCount || 0) + (item.commentsCount || 0);
      const existingEngagement = existing
        ? (existing.likesCount || 0) + (existing.commentsCount || 0)
        : -1;
      if (itemEngagement > existingEngagement) {
        byCreator.set(creator, item);
      }
    }

    // Sort the per-creator winners by engagement, take top N
    const topPosts = [...byCreator.values()]
      .sort((a, b) => {
        const eA = (a.likesCount || 0) + (a.commentsCount || 0);
        const eB = (b.likesCount || 0) + (b.commentsCount || 0);
        return eB - eA;
      })
      .slice(0, TOP_N);

    console.log(`[webhook] ${rawItems.length} raw → ${validItems.length} valid → ${byCreator.size} creators → ${topPosts.length} selected`);

    if (topPosts.length === 0) {
      return NextResponse.json({ status: 'No valid items after filtering' }, { status: 200 });
    }

    // 4. Process all posts in parallel — Claude + Telegram fire simultaneously
    step = 'process_posts';
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    async function processPost(post: ApifyItem): Promise<{ postId: string; status: string; error?: string }> {
      const postId   = post.id!;
      const postUrl  = post.url!;
      const likes    = post.likesCount    || 0;
      const comments = post.commentsCount || 0;
      const caption  = post.caption       || 'No caption';

      const message = await anthropic.messages.create({
        model:      'claude-sonnet-4-5',
        max_tokens: 512,
        messages:   [{ role: 'user', content: buildNanoBananaPrompt(caption, likes, comments) }],
      });
      const formattedPost = (message.content[0] as { type: string; text: string }).text;

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
        throw new Error(`Telegram error: ${JSON.stringify(tgErr)}`);
      }

      return { postId, status: 'sent' };
    }

    // Promise.allSettled — one failure never blocks the others
    const settled = await Promise.allSettled(topPosts.map(processPost));

    const results = settled.map((result, i) => {
      const postId = topPosts[i].id!;
      if (result.status === 'fulfilled') {
        console.log(`[webhook] Sent post ${postId}`);
        return result.value;
      }
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[webhook] Failed post ${postId}:`, msg);
      return { postId, status: 'error', error: msg };
    });

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
