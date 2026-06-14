# מודל נתונים

## ישויות

### Rank (דרגה) — דינמי

| שדה | סוג | הערות |
|---|---|---|
| `rank_id` | string (PK) | מזהה ייחודי (למשל `OL1`, `NOL2`, או כל ערך שהמנהל מגדיר) |
| `name` | string | שם הדרגה (למשל "קצין רמה 1") |
| `display_order` | integer | סדר הצגה ברשימות |
| `created_at` | datetime | |

> המנהל מגדיר את רשימת הדרגות. אין הגבלה על מספר או שמות הדרגות.

### ShiftType (סוג משמרת) — דינמי

| שדה | סוג | הערות |
|---|---|---|
| `shift_type_id` | string (PK) | מזהה ייחודי (למשל `OFFICER`, `GUARD`, או כל ערך) |
| `name` | string | שם סוג המשמרת (למשל "משמרת קצין") |
| `display_order` | integer | סדר הצגה |
| `created_at` | datetime | |

> המנהל מגדיר את סוגי המשמרות. ניתן להוסיף, לערוך ולמחוק סוגים לפי הצורך.

### RankShiftEligibility (כשירות דרגה-משמרת) — דינמי

| שדה | סוג | הערות |
|---|---|---|
| `rank_id` | string (FK) | |
| `shift_type_id` | string (FK) | |
| `priority` | integer? | עדיפות (1 = הכי גבוהה). `null` = כשיר ללא עדיפות מיוחדת |

> **Primary Key**: (`rank_id`, `shift_type_id`)
>
> טבלת מיפוי: כל שורה אומרת "דרגה X כשירה לסוג משמרת Y".
> אם אין שורה — הדרגה לא כשירה לסוג המשמרת הזה.
> שדה `priority` מאפשר להגדיר עדיפויות (כמו שהיה ל-OL3/OL4 עם משמרת מפקד).

### Worker (עובד)

| שדה | סוג | הערות |
|---|---|---|
| `worker_id` | string (PK) | מספר עובד — מזהה ייחודי + משמש להתחברות |
| `name` | string | שם מלא |
| `rank_id` | string (FK) | מפנה ל-Rank — דרגת העובד |
| `is_admin` | boolean | האם המשתמש מנהל |
| `password_hash` | string? | רק למנהלים — null לעובדים רגילים |
| `is_exempt` | boolean | האם העובד פטור ממשמרות |
| `exemption_reason` | string? | סיבת הפטור (חובה אם `is_exempt = true`) |
| `receives_shift_allocation` | boolean | האם מקבלים עבורו הקצאת משמרת למרות הפטור |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### Quarter (רבעון)

| שדה | סוג | הערות |
|---|---|---|
| `quarter_id` | string (PK) | פורמט: `2026-Q1` |
| `start_date` | date | |
| `end_date` | date | |
| `status` | enum | `draft`, `in_progress`, `published` |
| `created_at` | datetime | |

### ShiftDate (תאריך משמרת)

| שדה | סוג | הערות |
|---|---|---|
| `shift_date_id` | string (PK) | |
| `quarter_id` | string (FK) | |
| `date` | date | |
| `shift_type_id` | string (FK) | מפנה ל-ShiftType — סוג המשמרת |
| `is_weekend` | boolean | חמישי עד שבת = סופ"ש |

> מקור הנתונים: קובץ שהמנהל מעלה בתחילת כל רבעון.

### WorkerAvailability (זמינות עובד)

| שדה | סוג | הערות |
|---|---|---|
| `availability_id` | string (PK) | |
| `worker_id` | string (FK) | |
| `quarter_id` | string (FK) | |
| `date` | date | |
| `status` | enum | `unavailable`, `prefer_work`, `prefer_not_work` |

### ShiftAssignment (שיבוץ למשמרת)

| שדה | סוג | הערות |
|---|---|---|
| `assignment_id` | string (PK) | |
| `shift_date_id` | string (FK) | |
| `worker_id` | string (FK) | |
| `assigned_by` | string (FK) | מספר עובד של המנהל שביצע |
| `is_forced` | boolean | `true` אם העובד שובץ למרות שלא כשיר / לא זמין |
| `force_reason` | string? | סיבת שיבוץ כפוי |
| `assigned_at` | datetime | |

### ShiftHistory (היסטוריית משמרות)

| שדה | סוג | הערות |
|---|---|---|
| `history_id` | string (PK) | |
| `worker_id` | string (FK) | |
| `quarter_id` | string (FK) | |
| `shift_date_id` | string (FK) | |
| `was_weekend` | boolean | האם המשמרת הייתה בסופ"ש |

> משמש למעקב: כמה זמן עבר מאז המשמרת האחרונה, וחוק הסופ"ש השנתי.

## יחסים (ERD)

```
Rank 1──N Worker
Rank 1──N RankShiftEligibility

ShiftType 1──N ShiftDate
ShiftType 1──N RankShiftEligibility

Worker 1──N WorkerAvailability
Worker 1──N ShiftAssignment
Worker 1──N ShiftHistory

Quarter 1──N ShiftDate
Quarter 1──N WorkerAvailability

ShiftDate 1──N ShiftAssignment
ShiftDate 1──N ShiftHistory
```

## פורמט ייצוא/ייבוא (JSON)

הקובץ המיוצא מכיל את כל מצב הרבעון הנוכחי ומאפשר המשך עבודה:

```json
{
  "version": 2,
  "exported_at": "2026-03-25T12:00:00Z",
  "ranks": [
    { "rank_id": "OL1", "name": "קצין רמה 1" }
  ],
  "shift_types": [
    { "shift_type_id": "OFFICER", "name": "משמרת קצין" }
  ],
  "eligibility": [
    { "rank_id": "OL1", "shift_type_id": "OFFICER", "priority": null }
  ],
  "quarter": {
    "quarter_id": "2026-Q1",
    "start_date": "2026-01-01",
    "end_date": "2026-03-31",
    "status": "in_progress"
  },
  "shift_dates": [
    {
      "shift_date_id": "...",
      "date": "2026-01-15",
      "shift_type_id": "OFFICER",
      "is_weekend": false
    }
  ],
  "assignments": [
    {
      "shift_date_id": "...",
      "worker_id": "12345",
      "is_forced": false,
      "force_reason": null,
      "assigned_at": "2026-03-25T12:00:00Z"
    }
  ],
  "worker_availability": [
    {
      "worker_id": "12345",
      "date": "2026-01-15",
      "status": "unavailable"
    }
  ]
}
```
