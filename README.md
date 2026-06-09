# 🗓️ יומן AI - מדריך הרצה והתקנה

זהו ה-Backend של אפליקציית "יומן AI", המבוסס על TanStack Start ו-Claude 3.5 Sonnet.

## 🚀 הרצה מקומית (Development)

1. **התקנת תלויות:**
   ```bash
   npm install
   ```

2. **הגדרת משתני סביבה:**
   צור קובץ `.env` והוסף את המפתחות הבאים:
   ```env
   LOVABLE_API_KEY=your_key_here
   GOOGLE_CALENDAR_API_KEY=your_key_here
   ```

3. **הרצה:**
   ```bash
   npm run dev
   ```

## 📱 איך הופכים את זה לאפליקציה בטלפון? (PWA)

האפליקציה בנויה כ-Web App רספונסיבית. כדי להתקין אותה על מסך הבית:

### ב-iPhone (iOS):
1. פתח את הלינק של האפליקציה ב-**Safari**.
2. לחץ על כפתור ה-**Share** (הריבוע עם החץ למעלה).
3. בחר ב-**"Add to Home Screen"** (הוסף למסך הבית).

### ב-Android:
1. פתח את הלינק ב-**Chrome**.
2. לחץ על שלוש הנקודות בצד.
3. בחר ב-**"Install app"** או **"Add to Home screen"**.

## 🏗️ פריסה לענן (Deployment)

הדרך הקלה ביותר היא דרך **Vercel**:
1. חבר את ה-Repo ל-Vercel.
2. הגדר את ה-Environment Variables בהגדרות הפרויקט.
3. המערכת תזהה אוטומטית את Vinxi (המנוע של TanStack Start) ותפרוס את ה-Server Functions.

## 🛠️ טכנולוגיות
- **Frontend/Backend:** TanStack Start (React + Vinxi)
- **AI:** Claude 3.5 Sonnet (דרך Lovable Gateway)
- **Auth/Calendar:** Google OAuth & Calendar API
- **Validation:** Zod
