# סטאק טכנולוגי וארכיטקטורה

## סטאק נבחר

| רכיב | טכנולוגיה | הערות |
|---|---|---|
| פריימוורק | **Next.js** (App Router) | |
| עיצוב | **Tailwind CSS** | RTL מלא |
| רכיבי UI | **shadcn/ui** | |
| אחסון | **Vercel** | |
| בסיס נתונים | **טרם הוחלט** | ראה אפשרויות למטה |
| פרסור קבצים | `xlsx` (ספריית JS) | לפרסור קבצי Excel |
| Drag & Drop | `@dnd-kit/core` | או ספרייה דומה |

## אפשרויות בסיס נתונים

הדרישה: DB מקומי. אפשרויות מתאימות ל-Vercel:

| אפשרות | יתרונות | חסרונות |
|---|---|---|
| **SQLite + Turso** | פשוט, מקומי, edge-ready | הגדרה נדרשת ב-Vercel |
| **Vercel Postgres** | אינטגרציה מובנית | לא בדיוק "מקומי" אבל managed |
| **Vercel KV (Redis)** | מהיר לקריאה/כתיבה | פחות מתאים ליחסים מורכבים |
| **PlanetScale (MySQL)** | serverless, מהיר | שירות חיצוני |

> **המלצה**: SQLite עם Turso או Vercel Postgres — ההחלטה הסופית של המשתמש.

## ארכיטקטורה

```
┌─────────────────────────────────────────────┐
│                   Frontend                  │
│              Next.js App Router             │
│         (shadcn/ui + Tailwind + RTL)        │
└──────────────────┬──────────────────────────┘
                   │
                   │ Server Actions / API Routes
                   │
┌──────────────────▼──────────────────────────┐
│                  Backend                    │
│           Next.js API Routes                │
│     (אימות, לוגיקה עסקית, פרסור)          │
└──────────────────┬──────────────────────────┘
                   │
                   │
┌──────────────────▼──────────────────────────┐
│               Database                      │
│          (מקומי — טרם הוחלט)               │
└─────────────────────────────────────────────┘
```

### עקרונות ארכיטקטוניים

1. **הפרדת API** — כל הלוגיקה דרך API routes/server actions, כדי לאפשר אפליקציית Kotlin עתידית לצרוך את אותו API
2. **תגובות JSON** — כל ה-API מחזיר JSON סטנדרטי
3. **RTL מלא** — כל הממשק בעברית, כיוון RTL
4. **ללא חסימות קשיחות** — המערכת מייעצת ומזהירה אבל לעולם לא חוסמת פעולה של מנהל

## מבנה תיקיות מוצע

```
src/
├── app/
│   ├── layout.tsx              # RTL root layout
│   ├── page.tsx                # דף התחברות
│   ├── worker/
│   │   └── page.tsx            # מסך עובד — הגשת זמינות
│   ├── admin/
│   │   ├── page.tsx            # מסך ניהול ראשי
│   │   ├── upload/
│   │   │   └── page.tsx        # העלאת קובץ תאריכים
│   │   └── assign/
│   │       └── page.tsx        # מסך שיבוץ (drag & drop)
│   └── api/
│       ├── auth/
│       │   └── route.ts        # התחברות
│       ├── workers/
│       │   └── route.ts        # CRUD עובדים
│       ├── availability/
│       │   └── route.ts        # זמינות עובדים
│       ├── shifts/
│       │   └── route.ts        # תאריכי משמרות
│       ├── assignments/
│       │   └── route.ts        # שיבוצים
│       └── export/
│           └── route.ts        # ייצוא/ייבוא JSON
├── components/
│   ├── ui/                     # shadcn/ui components
│   ├── shift-calendar.tsx      # לוח שנה למשמרות
│   ├── worker-list.tsx         # רשימת עובדים (צד ימין)
│   ├── shift-card.tsx          # כרטיס משמרת
│   └── drag-drop-zone.tsx      # אזור גרירה
├── lib/
│   ├── db.ts                   # חיבור DB
│   ├── auth.ts                 # לוגיקת אימות
│   ├── xlsx-parser.ts          # פרסור קבצי Excel
│   ├── shift-rules.ts          # כללים עסקיים ובדיקות
│   └── types.ts                # TypeScript types
└── hooks/
    ├── use-drag-drop.ts        # hook לגרירה ושחרור
    └── use-shift-data.ts       # hook לנתוני משמרות
```

## תמיכה עתידית באפליקציית Kotlin

הארכיטקטורה מתוכננת כך שאפליקציית Kotlin עתידית תוכל:
- לצרוך את אותם API routes (כולם מחזירים JSON)
- לנהל push notifications (לא קיים בגרסת הווב)
- לספק חוויית מובייל מותאמת

**לא נדרש** לפתח שום דבר ספציפי ל-Kotlin בשלב הנוכחי — רק לשמור על ארכיטקטורת API נקייה.
