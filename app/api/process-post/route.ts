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

---

לאחר הפוסט, הוסף שורה בדיוק כך: ---BRIEF---
ואז כתוב Brief ויז'ואל קצר בעברית — כיצד לבנות את הפוסט הזה עבור Smiley Solution לפי מה שאתה רואה בתמונות:
- אם קרוסלה: תאר כל פריים בשורה נפרדת (פריים 1: ..., פריים 2: ...)
- אם וידאו/ריל: תאר 2–3 רגעי מפתח (שניות 0–3: ..., שניות 3–10: ...)
- אם תמונה בודדת: תאר את הקומפוזיציה ומה להדגיש
ללא markdown, ללא bullets. עד 80 מילים.
  `.trim();
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
        max_tokens: 900,
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
        max_tokens: 900,
        messages:   [{ role: 'user', content: buildNanoBananaPrompt(caption, likes, comments) }],
      });
      fullText = (message.content[0] as { type: string; text: string }).text;
    }

    const [postText, briefText] = fullText.split('---BRIEF---');
    const formattedPost = postText.trim();
    const visualBrief   = briefText?.trim() ?? '';

    const telegramText = visualBrief
      ? `📊 *${likes}L / ${comments}C*\n\n${formattedPost}\n\n🎨 *Brief ויז'ואל:*\n${visualBrief}\n\n🔗 [Original Post](${postUrl})`
      : `📊 *${likes}L / ${comments}C*\n\n${formattedPost}\n\n🔗 [Original Post](${postUrl})`;

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
    return NextResponse.json({ postId, status: 'sent' }, { status: 200 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[process-post] Failed post ${postId}:`, msg);
    return NextResponse.json({ postId, status: 'error', error: msg }, { status: 500 });
  }
}
