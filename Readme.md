# 📧 Kishor Exports Email Tracker

Complete email tracking system for Kishor Exports with Gmail integration, automatic reply detection, and professional dashboard.

---

## ✨ Features

✅ **Real-time Email Tracking** - Fetches all emails from last 5 days every 5 minutes
✅ **Auto-Reply Detection** - Checks for replies every 15 minutes  
✅ **Professional Dashboard** - Login system, email filtering, detail view
✅ **Status Management** - Mark emails as unreplied, replied, or no-reply-needed
✅ **Email Statistics** - Real-time counts and reports
✅ **Multi-Account** - Track emails from multiple Gmail accounts

---

## 📋 Quick Start

### 1️⃣ Database Setup (Supabase)

Go to **Supabase SQL Editor** and run `database-setup.sql`:

```sql
-- Copy entire content of database-setup.sql and paste in SQL Editor
-- Click Run ▶️
```

This creates:
- `users` table - Store agents/account info
- `emails` table - Store all emails
- `reminder_logs` table - Store reminder history
- Indexes and security policies
- Dashboard stats view

---

### 2️⃣ Environment Variables

Create `.env` file (copy from `.env.example`):

```env
# SUPABASE (get from Supabase dashboard)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# GMAIL API (get from Google Cloud Console)
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REDIRECT_URI=https://your-app.com/auth/callback
GMAIL_ACCOUNTS=your-gmail@gmail.com

# EMAIL SENDER (for reminders)
SENDER_EMAIL=your-sender@kishorexports.com
SENDER_PASSWORD=your-app-password

# SERVER
PORT=3000
NODE_ENV=production
```

---

### 3️⃣ Install Dependencies

```bash
npm install
```

---

### 4️⃣ Upload to GitHub

Your repo should have:

```
.
├── server.js              ✅ Main backend
├── index.html             ✅ Dashboard UI
├── package.json           ✅ Dependencies
├── .env                   ✅ (Don't commit - add to .gitignore)
├── .env.example           ✅ Template
├── database-setup.sql     📄 Reference
└── README.md              📄 This file
```

---

### 5️⃣ Deploy to Render

1. Connect GitHub repo to Render
2. Set environment variables in Render dashboard
3. Deploy!

```
https://your-app.onrender.com/
```

---

## 🔧 How It Works

### Email Tracking Flow

```
┌─────────────────┐
│  Gmail Account  │
└────────┬────────┘
         │
         ▼
    [Every 5 min]
    Fetch emails
    (last 5 days)
         │
         ▼
    Save to DB
    Status: unreplied
         │
         ▼
    [Every 15 min]
    Check replies
    in Gmail thread
         │
         ├─→ Reply found? → Update status: replied
         │
         └─→ No reply? → Keep as unreplied
         │
         ▼
    Dashboard
    Shows unreplied count
```

---

## 📊 Database Schema

### users table
```
id                UUID (primary key)
account_email     TEXT (unique)
name              TEXT
role              TEXT (agent, manager, senior_manager)
gmail_token       TEXT (OAuth token from Gmail)
password_hash     TEXT (for future auth)
created_at        TIMESTAMP
updated_at        TIMESTAMP
```

### emails table
```
id                UUID (primary key)
email_id          TEXT (unique, Gmail message ID)
thread_id         TEXT (Gmail thread ID)
account           TEXT (account email - foreign key)
sender_email      TEXT
sender_name       TEXT
subject           TEXT
body_preview      TEXT (snippet)
email_link        TEXT (link to open in Gmail)
received_at       TIMESTAMP
replied_at        TIMESTAMP
status            TEXT (unreplied, replied, no_reply_needed, system_generated)
is_system_generated BOOLEAN
ai_reason         TEXT
ai_confidence     TEXT
created_at        TIMESTAMP
updated_at        TIMESTAMP
```

### reminder_logs table
```
id                UUID (primary key)
email_id          UUID (foreign key to emails)
reminder_type     TEXT (36hour, daily, weekly)
sent_at           TIMESTAMP
recipients        TEXT (JSON array)
created_at        TIMESTAMP
```

---

## 🔌 API Endpoints

### Dashboard & View

- `GET /` → Dashboard HTML
- `GET /health` → Health check

### Email Management

- `GET /api/emails` → All emails with pagination
  - `?status=unreplied` → Filter by status
  - `?account=email@domain.com` → Filter by account
  - `?page=2&limit=50` → Pagination

- `GET /api/emails/unreplied` → Only unreplied emails
  - Same query parameters as above

- `GET /api/emails/:emailId/body` → Get full email content
  - Returns HTML or plain text

- `PATCH /api/emails/:emailId/status` → Update email status
  - Body: `{ "status": "replied" }`

### Stats & Info

- `GET /api/stats` → Dashboard statistics
  - Returns: total, unreplied, replied, noreply counts

- `GET /api/agents` → List all agents/users

---

## ⏱️ Cron Jobs

The system automatically runs:

| Schedule | Action | Description |
|----------|--------|-------------|
| Every 5 min | Fetch emails | Gets all emails from last 5 days |
| Every 15 min | Check replies | Checks if unreplied emails got replies |

---

## 🔐 Gmail Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download credentials JSON

### 2. Get Credentials

From `credentials.json`:
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REDIRECT_URI` = Your app URL + `/auth/callback`

### 3. First Time Authorization

User clicks "Connect Gmail" button on dashboard to grant access.

---

## 📊 Dashboard Features

### Login
- Email-based login
- Role-based access (agent, manager, senior_manager)

### Dashboard
- Stats cards (Total, Unreplied, Replied, No Reply)
- Quick stats chart

### Email Lists
- **Unreplied** - All emails waiting for reply
- **All Emails** - Every email tracked
- **No Reply Needed** - Automated/system emails

### Per Email
- Sender info
- Subject
- Received date/time
- Current status
- Actions:
  - Open in Gmail
  - Mark as replied
  - Mark as no-reply-needed

### Filters
- By status
- By account
- Pagination (50 per page)

---

## 🚀 Deployment Checklist

- [ ] Run database setup SQL in Supabase
- [ ] Create `.env` with all credentials
- [ ] Push to GitHub
- [ ] Connect repo to Render
- [ ] Set environment variables in Render
- [ ] Deploy
- [ ] Test login
- [ ] Connect Gmail account
- [ ] Wait 5 minutes, check for emails
- [ ] Verify reply checking works

---

## 🔧 Troubleshooting

### No emails showing?
- Check if Gmail account is connected
- Wait 5 minutes for cron job to run
- Check Render logs for errors

### Emails not marking as replied?
- Gmail thread ID might be missing
- Check if SENT label is set correctly in Gmail
- Wait 15 minutes for reply check to run

### Login not working?
- Check if user exists in `users` table
- Verify Supabase connection string

### Gmail API errors?
- Verify credentials in `.env`
- Check if Gmail API is enabled in Google Cloud
- Check if OAuth tokens are still valid

---

## 📝 Sample .env

```env
SUPABASE_URL=https://wegemqfijgcsqecwyocz.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

GMAIL_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-abc123xyz789
GMAIL_REDIRECT_URI=https://email-tracker.onrender.com/auth/callback
GMAIL_ACCOUNTS=kishor.merchant06@gmail.com

SENDER_EMAIL=hi@kishorexports.com
SENDER_PASSWORD=abcd efgh ijkl mnop

PORT=3000
NODE_ENV=production
```

---

## 📞 Support

For issues or questions:
1. Check Render logs
2. Check Supabase for data
3. Verify `.env` variables

---

## 📄 License

Internal use only - Kishor Exports

---

## ✅ What's Included

✅ `server.js` - Backend with all features
✅ `index.html` - Professional dashboard
✅ `package.json` - All dependencies
✅ `.env.example` - Environment template
✅ `database-setup.sql` - Complete DB schema
✅ `README.md` - This guide

---

## 🎯 Next Steps

1. **Setup Database** → Run SQL code
2. **Setup Environment** → Create `.env`
3. **Deploy Backend** → Push to GitHub/Render
4. **Connect Gmail** → Authenticate in dashboard
5. **Monitor Emails** → Watch real-time tracking

Happy tracking! 📧
