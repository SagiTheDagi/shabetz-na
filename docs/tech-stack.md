# סטאק טכנולוגי וארכיטקטורה

## סטאק נבחר

| רכיב | טכנולוגיה | הערות |
|---|---|---|
| פריימוורק | **Next.js** (App Router) | standalone output mode |
| עיצוב | **Tailwind CSS** | RTL מלא |
| רכיבי UI | **shadcn/ui** | |
| אחסון | **שרת מקומי** | רץ על מחשב ברשת המקומית (LAN) |
| בסיס נתונים | **SQLite** | באמצעות `better-sqlite3` (ללא ORM) |
| Drag & Drop | `@dnd-kit/core` | או ספרייה דומה |

## בסיס נתונים — SQLite

### מיקום הקובץ

קובץ ה-DB נשמר **מחוץ לריפו**, בנתיב שמוגדר ב-`.env`:

```env
DATABASE_PATH=C:/shabetz-na-data/shabetz.db
PEPPER_SECRET=<random-64-char-hex-string>
SESSION_SECRET=<random-64-char-hex-string>
```

> **הקובץ לעולם לא נכנס ל-Git.** קבצי `*.db` חסומים ב-`.gitignore`.
> ברירת מחדל אם לא מוגדר: `~/.shabetz-na/shabetz.db`

### אבטחת בסיס הנתונים

- קובץ ה-DB מכיל מידע אישי (שמות, מספרי עובד, סיסמאות מגובבות) — לכן הוא **לא חלק מהריפו**
- הנתיב מוגדר דרך משתנה סביבה, כך שכל שרת יכול להצביע למיקום אחר
- הרשאות קובץ: רק המשתמש שמריץ את השרת יכול לקרוא/לכתוב את קובץ ה-DB

### יתרונות

- אין תלות בשירותי ענן
- גיבוי פשוט — העתקת קובץ בודד
- ביצועים מצוינים לסקאלה של עשרות עובדים ואלפי משמרות
- אין צורך בהתקנת שרת DB נפרד

### כלים

- `better-sqlite3` — דרייבר מהיר וסינכרוני ל-SQLite
- שאילתות SQL ישירות (ללא ORM) — פשוט וקריא
- סקריפט מיגרציה ידני ב-`scripts/migrate.ts`

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
│     (אימות, לוגיקה עסקית)          │
└──────────────────┬──────────────────────────┘
                   │
                   │
┌──────────────────▼──────────────────────────┐
│               Database                      │
│       SQLite (shabetz.db — קובץ מקומי)     │
└─────────────────────────────────────────────┘

              🖥️ שרת מקומי ברשת LAN
         נגיש דרך http://<local-ip>:3000
```

### פריסה מקומית

- Next.js בנוי עם `output: "standalone"` — יוצר שרת Node.js עצמאי
- רץ על מחשב ברשת המקומית (Windows/Linux/Mac)
- נגיש לכל מכשיר ברשת ה-LAN דרך כתובת ה-IP המקומית
- אין צורך בחיבור אינטרנט בזמן שימוש
- הרצה: `node server.js` (או כ-service שרץ ברקע)

### עקרונות ארכיטקטוניים

1. **הפרדת API** — כל הלוגיקה דרך API routes/server actions, כדי לאפשר אפליקציית Kotlin עתידית לצרוך את אותו API
2. **תגובות JSON** — כל ה-API מחזיר JSON סטנדרטי
3. **RTL מלא** — כל הממשק בעברית, כיוון RTL
4. **ללא חסימות קשיחות** — המערכת מייעצת ומזהירה אבל לעולם לא חוסמת פעולה של מנהל
5. **מקומי לחלוטין** — כל הנתונים נשמרים על השרת המקומי, ללא תלות בענן

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
│   │   ├── assign/
│   │   │   └── page.tsx        # מסך שיבוץ (drag & drop)
│   │   └── settings/
│   │       └── page.tsx        # ניהול דרגות, סוגי משמרות, מטריצת כשירות
│   └── api/
│       ├── auth/
│       │   └── route.ts        # התחברות
│       ├── workers/
│       │   └── route.ts        # CRUD עובדים
│       ├── availability/
│       │   └── route.ts        # זמינות עובדים
│       ├── shifts/
│       │   └── route.ts        # תאריכי משמרות
│       ├── ranks/
│       │   └── route.ts        # CRUD דרגות
│       ├── shift-types/
│       │   └── route.ts        # CRUD סוגי משמרות
│       ├── eligibility/
│       │   └── route.ts        # מטריצת כשירות
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
│   ├── db.ts                   # חיבור SQLite (better-sqlite3) — קורא DATABASE_PATH מ-.env
│   ├── auth.ts                 # לוגיקת אימות (bcrypt + pepper)
│   ├── file-parser.ts          # פרסור קובץ תאריכים
│   ├── shift-rules.ts          # כללים עסקיים ובדיקות
│   └── types.ts                # TypeScript types
├── scripts/
│   ├── migrate.ts              # יצירת טבלאות ומיגרציות
│   ├── seed.ts                 # נתוני ברירת מחדל (דרגות, סוגי משמרות, מטריצת כשירות)
│   └── backup.ts               # סקריפט גיבוי — מעתיק את ה-DB עם timestamp
└── hooks/
    ├── use-drag-drop.ts        # hook לגרירה ושחרור
    └── use-shift-data.ts       # hook לנתוני משמרות
```

## גיבוי ושחזור

### גיבוי אוטומטי

סקריפט `scripts/backup.ts` מעתיק את קובץ ה-DB עם timestamp:

```bash
npx tsx scripts/backup.ts
# → יוצר: C:/shabetz-na-data/backups/shabetz_2026-06-14_1200.db
```

- ניתן להריץ כ-scheduled task / cron job
- הגיבויים נשמרים באותה תיקייה של ה-DB תחת `backups/`

### גיבוי ידני

- העתקת קובץ `shabetz.db` לתיקייה אחרת / כונן חיצוני
- ייצוא/ייבוא JSON זמין כגיבוי לוגי (ראה [data-model.md](data-model.md))

### שחזור

- החלפת קובץ `shabetz.db` בגיבוי והפעלה מחדש של השרת

## אבטחת מידע

### עקרונות מנחים

המערכת מאחסנת מידע אישי (שמות, מספרי עובד, סיסמאות) ולכן חייבת לעמוד בסטנדרטים בסיסיים של אבטחת מידע, גם כשרצה רק ברשת מקומית.

### אימות סיסמאות — Salt + Pepper + bcrypt

סיסמאות מנהלים נשמרות בפורמט: `bcrypt(pepper + password)`

| מושג | מה זה | איפה נשמר |
|---|---|---|
| **Salt** | מחרוזת אקראית ייחודית לכל סיסמה | בתוך ה-hash של bcrypt (מובנה אוטומטית) |
| **Pepper** | סוד גלובלי קבוע של האפליקציה | `.env` (`PEPPER_SECRET`) — **לא ב-DB ולא בקוד** |
| **bcrypt** | אלגוריתם hashing איטי מכוון (cost factor 12) | — |

**תהליך:**
1. בעת יצירת סיסמה: `hash = bcrypt.hash(PEPPER_SECRET + plaintext, 12)`
2. בעת אימות: `bcrypt.compare(PEPPER_SECRET + input, storedHash)`
3. Salt נוצר אוטומטית ע"י bcrypt — לא צריך לנהל אותו בנפרד

> **למה pepper?** אם קובץ ה-DB נגנב, ה-hashes חסרי ערך בלי ה-pepper שנמצא רק ב-`.env` על השרת.

### ניהול Sessions

- Sessions מנוהלים עם token חתום (`SESSION_SECRET` מ-`.env`)
- לכל session יש תוקף מוגבל (TTL)
- Session token נשמר ב-httpOnly cookie — לא נגיש מ-JavaScript בצד הלקוח
- Logout מבטל את ה-session בשרת

### הגנת API

- **כל route של מנהל** דורש session תקף עם `is_admin = true`
- **כל route של עובד** דורש session תקף עם `worker_id` תואם
- **Parameterized queries בלבד** — כל שאילתת SQL משתמשת ב-`?` placeholders, אף פעם לא string concatenation (מניעת SQL Injection)
- **Input validation** — כל קלט מהמשתמש עובר סניטציה (אורך, תווים, סוג)
- **Rate limiting** — הגבלת ניסיונות התחברות כושלים (למשל 5 ניסיונות, נעילה ל-15 דקות)

### הגנת רשת

- השרת מאזין רק ברשת ה-LAN — אין חשיפה לאינטרנט
- מומלץ: הגדרת firewall שחוסם גישה מחוץ ל-LAN ל-port 3000
- כל התעבורה ברשת מקומית — אם הרשת מוצפנת (WPA2/WPA3) התעבורה מוגנת

### הגנה מפני התקפות נפוצות (OWASP)

| התקפה | הגנה |
|---|---|
| **SQL Injection** | Parameterized queries בלבד — אין string concatenation |
| **XSS** | React escapes by default; אין `dangerouslySetInnerHTML` ללא סניטציה |
| **CSRF** | SameSite cookies + בדיקת Origin header |
| **Brute Force** | Rate limiting על login endpoint |
| **Session Hijacking** | httpOnly + Secure cookies; session invalidation on logout |

### מה לא לשמור ב-Git

| פריט | מיקום | ב-Git? |
|---|---|---|
| קוד מקור | `src/` | כן |
| תיעוד | `docs/` | כן |
| קובץ DB | `DATABASE_PATH` | **לא** |
| משתני סביבה | `.env` | **לא** |
| גיבויים | `backups/` | **לא** |

## תמיכה עתידית באפליקציית Kotlin

הארכיטקטורה מתוכננת כך שאפליקציית Kotlin עתידית תוכל:
- לצרוך את אותם API routes (כולם מחזירים JSON)
- להתחבר לשרת המקומי דרך ה-LAN
- לנהל push notifications (לא קיים בגרסת הווב)
- לספק חוויית מובייל מותאמת

**לא נדרש** לפתח שום דבר ספציפי ל-Kotlin בשלב הנוכחי — רק לשמור על ארכיטקטורת API נקייה.
