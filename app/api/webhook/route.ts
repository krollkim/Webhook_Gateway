/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // שליפת ה-Dataset ID מתוך ה-Webhook של Apify
    const datasetId = body.resource?.defaultDatasetId;
    if (!datasetId) {
      console.error("Missing datasetId in webhook payload");
      return NextResponse.json({ error: 'No dataset ID found' }, { status: 400 });
    }

    // 1. משיכת נתונים גולמיים מ-Apify
    const apifyToken = process.env.APIFY_TOKEN;
    const apifyResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`);
    const items = await apifyResponse.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ status: 'No items to process' }, { status: 200 });
    }

    // 2. לוגיקת בחירת ה-"Winner" - הפוסט עם ה-Engagement הכי גבוה
    const winnerPost = items.sort((a: any, b: any) => {
      const engagementA = (a.likesCount || 0) + (a.commentsCount || 0);
      const engagementB = (b.likesCount || 0) + (b.commentsCount || 0);
      return engagementB - engagementA; // מהגבוה לנמוך
    })[0];

    const rawCaption = winnerPost.caption || "No caption found";
    const postUrl = winnerPost.url || "No URL found";
    const stats = {
      likes: winnerPost.likesCount || 0,
      comments: winnerPost.commentsCount || 0
    };

    // 3. הפעלת שכבת האינטליגנציה (Gemini AI / Nano Banana 2)
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

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

    const aiResult = await model.generateContent(systemPrompt);
    const aiResponse = aiResult.response.text();

    // 4. שליחה לטלגרם (Smiley Scout Bot)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    const telegramBody = {
      chat_id: chatId,
      text: `🚀 **Smiley Scout: High-Engagement Insight**\n\n📊 *Stats:* ${stats.likes} Likes | ${stats.comments} Comments\n\n${aiResponse}\n\n🔗 [Link to Winner Post](${postUrl})`,
      parse_mode: "Markdown",
    };

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramBody),
    });

    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      console.error("Telegram API Error:", errorData);
    }

    return NextResponse.json({ status: 'Success' }, { status: 200 });

  } catch (error) {
    console.error('Critical Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}