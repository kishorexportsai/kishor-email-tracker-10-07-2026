require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(express.json());

// === 15 TRACKED SENDERS ONLY ===
const TRACKED = new Set([
  'nirvana.balsingh@wefashion.com',
  'ilona.van.de.schootbrugge@wefashion.com',
  'kurt@kurtklingberg.se',
  'cg@carebyme.dk',
  'ivy.ho@polarnopyret.se',
  'jo@lakor.dk',
  'stine@lakor.dk',
  'johnny.lai@polarnopyret.se',
  'rishabh.shrivastava@ul.com',
  'jeppe@lakor.dk',
  'fiona@littleones.ie',
  'mg@carebyme.dk',
  'bettina@gai-lisva.com',
  'camillad@luxkids.dk',
  'emma@emmamalena.com'
].map(e => e.toLowerCase()));

// === UTILITY FUNCTIONS ===

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function getToken(email) {
  const { data } = await supabase.from('users').select('gmail_token').eq('account_email', email).single();
  if (!data?.gmail_token) return null;
  try {
    return typeof data.gmail_token === 'string' ? JSON.parse(data.gmail_token) : data.gmail_token;
  } catch {
    return null;
  }
}

async function saveToken(email, tokens) {
  await supabase.from('users').update({ gmail_token: JSON.stringify(tokens) }).eq('account_email', email);
}

// === FETCH EMAILS - ONLY FROM 15 TRACKED SENDERS ===
async function fetchAllEmails(email) {
  const tokens = await getToken(email);
  if (!tokens) return 0;

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => saveToken(email, { ...tokens, ...newTokens }));

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    // === HARD LIMIT: LAST 5 DAYS ONLY ===
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const afterDate = fiveDaysAgo.toISOString().split('T')[0];
    const query = `in:inbox after:${afterDate}`;

    console.log(`[Gmail] Fetching from ${afterDate} (5 days) - TRACKED SENDERS ONLY`);

    const { data: messages_result } = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 500 });
    const messages = messages_result?.messages || [];

    if (!messages.length) {
      console.log(`[Gmail] No emails found`);
      return 0;
    }

    let saved = 0;
    let skipped = 0;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    for (const msg of messages) {
      const { data: exists } = await supabase.from('emails').select('id').eq('email_id', msg.id).single();
      if (exists) continue;

      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.payload?.headers || [];
      const fromHeader = getHeader(headers, 'From') || '';
      const subject = getHeader(headers, 'Subject') || '(No Subject)';
      const receivedAtRaw = getHeader(headers, 'Date');
      const receivedAt = new Date(receivedAtRaw || Date.now()).toISOString();

      // === EXTRACT SENDER EMAIL ===
      const match = fromHeader.match(/<(.+?)>/);
      let senderEmail = match ? match[1].toLowerCase().trim() : fromHeader.toLowerCase().trim();

      // === CHECK IF SENDER IS TRACKED ===
      if (!TRACKED.has(senderEmail)) {
        skipped++;
        continue;
      }

      // === DOUBLE CHECK: EMAIL IS WITHIN 5 DAYS ===
      const emailTimeMs = new Date(receivedAt).getTime();
      const nowMs = Date.now();
      if ((nowMs - emailTimeMs) > fiveDaysMs) {
        skipped++;
        console.log(`[Gmail] SKIP (too old): ${senderEmail}`);
        continue;
      }

      saved++;
      console.log(`[Gmail] SAVE: ${senderEmail}`);

      await supabase.from('emails').insert({
        email_id: msg.id,
        thread_id: full.threadId,
        account: email,
        sender_email: senderEmail,
        sender_name: fromHeader.split('<')[0].trim(),
        subject: subject,
        received_at: receivedAt,
        status: 'unreplied',
        body_preview: full.snippet || '',
        email_link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      });
    }

    console.log(`[Gmail] SAVED: ${saved} | SKIPPED: ${skipped}`);
    return saved;

  } catch (err) {
    console.error(`[Gmail] Error:`, err.message);
    return 0;
  }
}

// === CHECK FOR REPLIES ===
async function checkForReplies(email) {
  const tokens = await getToken(email);
  if (!tokens) return;

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const { data: unreplied } = await supabase.from('emails').select('id, thread_id, received_at').eq('status', 'unreplied');
    if (!unreplied?.length) {
      console.log(`[Gmail] No unreplied emails to check`);
      return;
    }

    console.log(`[Gmail] Checking ${unreplied.length} unreplied emails for replies...`);

    let updated = 0;

    for (const emailRecord of unreplied) {
      if (!emailRecord.thread_id) continue;

      try {
        const { data: thread } = await gmail.users.threads.get({ userId: 'me', id: emailRecord.thread_id, format: 'metadata' });
        const messages = thread.messages || [];
        const receivedTime = new Date(emailRecord.received_at).getTime();

        const hasReply = messages.some(m => {
          const isSent = (m.labelIds || []).includes('SENT');
          const msgTime = parseInt(m.internalDate || '0');
          return isSent && msgTime > receivedTime;
        });

        if (hasReply) {
          await supabase.from('emails').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', emailRecord.id);
          updated++;
          console.log(`[Gmail] ✅ Email marked as REPLIED`);
        }
      } catch (e) {}
    }

    console.log(`[Gmail] Updated ${updated} to replied`);

  } catch (err) {
    console.error(`[Gmail] Error checking replies:`, err.message);
  }
}

// === API ROUTES ===

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Email Tracker Running - Tracking 15 senders only (last 5 days)' });
});

// Get all emails with pagination
app.get('/api/emails', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = (parseInt(req.query.page) - 1 || 0) * limit;
    const status = req.query.status;
    const account = req.query.account;

    let query = supabase.from('emails').select('*', { count: 'exact' }).order('received_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (account) query = query.eq('account', account);

    query = query.range(offset, offset + limit - 1);

    const { data, count } = await query;

    res.json({
      emails: data || [],
      total: count || 0,
      limit,
      page: Math.floor(offset / limit) + 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get unreplied emails
app.get('/api/emails/unreplied', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = (parseInt(req.query.page) - 1 || 0) * limit;
    const account = req.query.account;

    let query = supabase.from('emails').select('*', { count: 'exact' }).eq('status', 'unreplied').order('received_at', { ascending: false });

    if (account) query = query.eq('account', account);

    query = query.range(offset, offset + limit - 1);

    const { data, count } = await query;

    res.json({
      emails: data || [],
      total: count || 0,
      limit,
      page: Math.floor(offset / limit) + 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get email body
app.get('/api/emails/:emailId/body', async (req, res) => {
  try {
    const { data: email } = await supabase.from('emails').select('*').eq('email_id', req.params.emailId).single();
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const tokens = await getToken(email.account);
    if (!tokens) return res.status(401).json({ error: 'No token' });

    const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const { data: full } = await gmail.users.messages.get({ userId: 'me', id: req.params.emailId, format: 'full' });
    const payload = full.payload;
    let body = '';
    let mimeType = 'text/plain';

    if (payload.parts) {
      const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
      const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
      if (htmlPart) {
        mimeType = 'text/html';
        body = Buffer.from(htmlPart.body.data || '', 'base64').toString();
      } else if (textPart) {
        body = Buffer.from(textPart.body.data || '', 'base64').toString();
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString();
    }

    res.json({ body, mimeType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update email status
app.patch('/api/emails/:emailId/status', async (req, res) => {
  try {
    const { status } = req.body;
    await supabase.from('emails').update({ status, updated_at: new Date().toISOString() }).eq('email_id', req.params.emailId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get agents/accounts
app.get('/api/agents', async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('account_email, name, role');
    res.json(users || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const { data: emails } = await supabase.from('emails').select('status');

    const total = emails?.length || 0;
    const unreplied = emails?.filter(e => e.status === 'unreplied').length || 0;
    const replied = emails?.filter(e => e.status === 'replied').length || 0;
    const noReplyNeeded = emails?.filter(e => e.status === 'no_reply_needed').length || 0;

    res.json({ total, unreplied, replied, noReplyNeeded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CRON JOBS ===

// Fetch every 5 minutes - ONLY FROM 15 TRACKED SENDERS, LAST 5 DAYS
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] 5-min fetch - Tracking 15 senders only (last 5 days)');
  const { data: users } = await supabase.from('users').select('account_email').not('gmail_token', 'is', null);
  for (const user of users || []) {
    await fetchAllEmails(user.account_email);
  }
});

// Check replies every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('[Cron] 15-min reply check');
  const { data: users } = await supabase.from('users').select('account_email').not('gmail_token', 'is', null);
  for (const user of users || []) {
    await checkForReplies(user.account_email);
  }
});

// === START SERVER ===

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log('[Tracker] ✅ Tracking ONLY 15 senders from last 5 days');
  console.log('[Tracked Senders]:');
  Array.from(TRACKED).forEach(s => console.log(`  • ${s}`));
  console.log('[Cron] 5-min fetch, 15-min reply check');
});
