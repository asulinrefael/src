import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_CAL_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

const ParsedEventSchema = z.object({
  title: z.string().min(1).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:mm format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:mm format"),
  location: z.string().max(1000).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  allDay: z.boolean().optional(),
  reminderMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  assumptions: z.array(z.string().max(500)).max(10).optional(),
  warnings: z.array(z.string().max(500)).max(10).optional(),
  followUpQuestion: z.string().max(1000).nullable().optional(),
}).refine(
  (data) => {
    if (data.allDay) return true; // no time validation for all-day events
    const [startH, startM] = data.startTime.split(":").map(Number);
    const [endH, endM] = data.endTime.split(":").map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    return endMins > startMins;
  },
  {
    message: "endTime must be after startTime",
    path: ["endTime"],
  }
);

export type ParsedEvent = z.infer<typeof ParsedEventSchema>;

export type DayEvent = {
  summary: string;
  start: string; // HH:mm or "כל היום"
  end: string;
};

type CalendarEvent = {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

// מושך את האירועים לשבוע הקרוב כדי לתת ל-AI קונטקסט על חפיפות
async function fetchUpcomingEvents(
  nowIso: string,
  tz: string,
  apiKey: string,
  connKey: string,
): Promise<DayEvent[]> {
  try {
    const timeMin = encodeURIComponent(nowIso);
    
    // מחשב תאריך מקסימלי: 7 ימים מהיום
    // Parse ISO string properly using UTC to avoid timezone issues
    const now = new Date(nowIso);
    if (isNaN(now.getTime())) {
      console.error("Invalid ISO date string:", nowIso);
      return [];
    }
    const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const timeMax = encodeURIComponent(maxDate.toISOString());

    const url = `${GATEWAY_CAL_URL}/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}&timeZone=${encodeURIComponent(tz)}&maxResults=30`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Connection-Api-Key": connKey,
        },
        signal: controller.signal,
      });
      
      if (!res.ok) {
        console.warn(`Calendar fetch returned ${res.status}`);
        return [];
      }
      
      const json = (await res.json()) as { items?: CalendarEvent[] };
      const items = json.items ?? [];
      return items.map((it) => {
        const startDateStr = it.start?.dateTime 
          ? new Date(it.start.dateTime).toLocaleString("he-IL", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz })
          : it.start?.date ? `${it.start.date} (כל היום)` : "לא ידוע";
          
        const endDateStr = it.end?.dateTime 
          ? new Date(it.end.dateTime).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: tz })
          : "";

        return { 
          summary: it.summary ?? "(ללא כותרת)", 
          start: startDateStr, 
          end: endDateStr 
        };
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error("Calendar fetch timeout");
    } else {
      console.error("fetchUpcomingEvents failed", e);
    }
    return [];
  }
}

/**
 * Increments a date string (YYYY-MM-DD) by N days.
 * Works with UTC to avoid timezone issues.
 */
function addDaysToDateString(dateStr: string, days: number): string {
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }
  
  const parts = dateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const date = parseInt(parts[2], 10);
  
  const d = new Date(Date.UTC(year, month, date));
  d.setUTCDate(d.getUTCDate() + days);
  
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  
  return `${y}-${m}-${day}`;
}

export const parseEventFromText = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string; nowIso: string; tz: string; profile?: string }) => {
    const schema = z
      .object({
        text: z.string().min(1).max(2000),
        nowIso: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d{3})?Z?$/, "Invalid ISO date format"),
        tz: z.string().min(1).max(64),
        profile: z.string().max(2000).optional(),
      });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY?.trim();
    const GOOGLE_CALENDAR_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY?.trim();

    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY environment variable not set");
      return { ok: false as const, error: "LOVABLE_API_KEY חסר" };
    }

    const agendaPromise = GOOGLE_CALENDAR_API_KEY
      ? fetchUpcomingEvents(data.nowIso, data.tz, LOVABLE_API_KEY, GOOGLE_CALENDAR_API_KEY)
      : Promise.resolve<DayEvent[]>([]);

    const profileBlock = data.profile?.trim()
      ? `\n\nפרופיל אישי של המשתמש (קונטקסט חיוני — שמות, מקומות, תפקידים, העדפות, אילוצים):\n"""\n${data.profile.trim()}\n"""\nכשרלוונטי, השלם פרטים חסרים מהפרופיל (מקום קבוע, משך אופייני, כותרת מדויקת) — אבל אל תמציא מידע שלא נתמך.`
      : "";

    const agenda = await agendaPromise;
    const agendaBlock = agenda.length
      ? `\n\nהאירועים ביומן לשבוע הקרוב:\n${agenda.map((a) => `- ${a.start}${a.end ? ` עד ${a.end}` : ""}: ${a.summary}`).join("\n")}\n* בדוק תמיד אם התאריך/שעה שהמשתמש ביקש מתנגשים עם אחד מהאירועים ברשימה זו. אם כן, הוסף אזהרה (warning) מפורטת.`
      : "";

    const systemPrompt = `אתה Chief of Staff אישי חכם בעברית. אתה לא רק מחלץ פרטים — אתה חושב לעומק על האירוע ועוזר למשתמש להחליט נכון.

הזמן הנוכחי: ${data.nowIso} (אזור זמן: ${data.tz}).

כללי חשיבה:
1. תאריכים יחסיים ("מחר", "ביום שני הבא", "בעוד שבועיים", "בערב", "אחה״צ") — פרש ביחס לזמן הנוכחי בצורה מדויקת.
2. אם אין שעת התחלה כלל → allDay=true ושעות 00:00–23:59.
3. אם יש שעת התחלה ואין סיום → הסק משך הגיוני לפי סוג האירוע (פגישה=שעה, ארוחה=שעה, משמרת=8, סדנה=3 וכו').
4. הסק תזכורת חכמה (reminderMinutes): פגישה רגילה=30, נסיעה רחוקה=60, אירוע משפחתי=120, פגישה רפואית=180. אם המשתמש ציין במפורש — כבד אותו.
5. assumptions: רשימת הנחות שעשית שלא היו במפורש בטקסט (למשל "הנחתי שמשך המשמרת 8 שעות לפי הפרופיל"). תהיה שקוף.
6. warnings: אזהרות מעשיות — חפיפה עם אירוע קיים, סוף שבוע, שעה מאוד מאוחרת/מוקדמת, אילוץ שמופיע בפרופיל ("המשתמש ציין שלא לקבוע בשישי אחה״צ").
7. followUpQuestion: רק אם משהו ממש לא ברור ודרוש להבהיר — אחרת null.
8. תאריך בפורמט YYYY-MM-DD, שעות HH:mm (24).${profileBlock}${agendaBlock}`;

    const res = await fetch(GATEWAY_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: data.text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_event",
              description: "פרטי אירוע יומן + חשיבה מעמיקה",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  date: { type: "string", description: "YYYY-MM-DD" },
                  startTime: { type: "string", description: "HH:mm" },
                  endTime: { type: "string", description: "HH:mm" },
                  location: { type: "string" },
                  description: { type: "string" },
                  allDay: { type: "boolean" },
                  reminderMinutes: {
                    type: "number",
                    description: "כמה דקות לפני האירוע להתריע (0 = ללא תזכורת)",
                  },
                  assumptions: {
                    type: "array",
                    items: { type: "string" },
                    description: "הנחות שהמודל עשה כדי להשלים פרטים חסרים",
                  },
                  warnings: {
                    type: "array",
                    items: { type: "string" },
                    description: "אזהרות מעשיות למשתמש (חפיפה, אילוץ מהפרופיל וכו')",
                  },
                  followUpQuestion: {
                    type: "string",
                    description: "שאלת הבהרה — רק אם משהו לא ברור באמת",
                  },
                },
                required: ["title", "date", "startTime", "endTime"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_event" } },
        reasoning: { effort: "medium" },
      }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (res.status === 429) {
      return { ok: false as const, error: "הגעת למגבלת הקצב, נסה שוב בעוד דקה" };
    }
    if (res.status === 402) {
      return { ok: false as const, error: "נגמרו הקרדיטים ב-Lovable AI" };
    }
    if (res.status === 401 || res.status === 403) {
      console.error("Auth error from AI gateway", res.status);
      return { ok: false as const, error: "בעיה בהרשאה ל-AI" };
    }
    if (!res.ok) {
      const t = await res.text();
      console.error("AI gateway error", res.status, t);
      return { ok: false as const, error: `שגיאת AI (${res.status})` };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      console.error("Failed to parse AI response", e);
      return { ok: false as const, error: "תגובת ה-AI לא תקינה" };
    }

    const toolCall = (json as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function: {
              arguments: string;
            };
          }>;
        };
      }>;
    }).choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("Missing tool call in AI response", json);
      return { ok: false as const, error: "ה-AI לא הצליח לחלץ אירוע" };
    }

    try {
      const args = JSON.parse(toolCall.function.arguments) as unknown;
      const parsed = ParsedEventSchema.parse(args);
      return { ok: true as const, event: parsed, agenda };
    } catch (e) {
      console.error("parse error", e);
      return { ok: false as const, error: "פלט ה-AI לא תקין" };
    }
  });

export const insertCalendarEvent = createServerFn({ method: "POST" })
  .inputValidator((input: { event: ParsedEvent; tz: string }) => {
    return z
      .object({
        event: ParsedEventSchema,
        tz: z.string().min(1).max(64),
      })
      .parse(input);
  })
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY?.trim();
    const GOOGLE_CALENDAR_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY?.trim();

    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY environment variable not set");
      return { ok: false as const, error: "LOVABLE_API_KEY חסר" };
    }

    if (!GOOGLE_CALENDAR_API_KEY) {
      console.error("GOOGLE_CALENDAR_API_KEY environment variable not set");
      return { ok: false as const, error: "Google Calendar לא מחובר" };
    }

    const { event, tz } = data;

    const reminders =
      event.reminderMinutes != null && event.reminderMinutes > 0
        ? {
            useDefault: false,
            overrides: [{ method: "popup", minutes: event.reminderMinutes }],
          }
        : undefined;

    // חישוב תאריך סיום תקין לאירוע של יום שלם (בלי בעיות timezone)
    const allDayEndDate = event.allDay ? addDaysToDateString(event.date, 1) : event.date;

    const body = event.allDay
      ? {
          summary: event.title,
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          start: { date: event.date },
          end: { date: allDayEndDate },
          reminders,
        }
      : {
          summary: event.title,
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          start: { dateTime: `${event.date}T${event.startTime}:00`, timeZone: tz },
          end: { dateTime: `${event.date}T${event.endTime}:00`, timeZone: tz },
          reminders,
        };

    const res = await fetch(`${GATEWAY_CAL_URL}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_CALENDAR_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (res.status === 401 || res.status === 403) {
      console.error("Auth error when inserting calendar event", res.status);
      return { ok: false as const, error: "בעיה בהרשאה ליומן" };
    }

    if (!res.ok) {
      const t = await res.text();
      console.error("Calendar insert failed", res.status, t);
      return { ok: false as const, error: `שגיאת יומן (${res.status})` };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      console.error("Failed to parse calendar response", e);
      return { ok: false as const, error: "תגובת היומן לא תקינה" };
    }

    const id = (json as { id?: string }).id;
    const link = (json as { htmlLink?: string }).htmlLink;

    if (!id) {
      console.error("Missing event ID in calendar response", json);
      return { ok: false as const, error: "האירוע לא נוצר כראוי" };
    }

    return {
      ok: true as const,
      eventId: id,
      htmlLink: link,
    };
  });
