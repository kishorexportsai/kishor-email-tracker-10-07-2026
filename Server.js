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

// === FETCH ALL EMAILS ===
async function fetchAllEmails(email) {
  const tokens = await getToken(email);
  if (!tokens) return 0;

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => saveToken(email, { ...tokens, ...newTokens }));

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const afterDate = fiveDaysAgo.toISOString().split('T')[0];
    const query = `in:inbox after:${afterDate}`;

    console.log(`[Gmail] Fetching from ${afterDate}...`);

    const { data: messages_result } = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 500 });
    const messages = messages_result?.messages || [];

    if (!messages.length) return 0;

    let saved = 0;

    for (const msg of messages) {
      const { data: exists } = await supabase.from('emails').select('id').eq('email_id', msg.id).single();
      if (exists) continue;

      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.payload?.headers || [];
      const fromHeader = getHeader(headers, 'From') || '';
      const subject = getHeader(headers, 'Subject') || '(No Subject)';
      const receivedAtRaw = getHeader(headers, 'Date');
      const receivedAt = new Date(receivedAtRaw || Date.now()).toISOString();

      const match = fromHeader.match(/<(.+?)>/);
      const senderEmail = match ? match[1].toLowerCase() : fromHeader.toLowerCase();

      saved++;

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

    console.log(`[Gmail] Saved ${saved} emails`);
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
    if (!unreplied?.length) return;

    console.log(`[Gmail] Checking ${unreplied.length} unreplied emails...`);

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
  res.json({ status: 'OK' });
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

// Fetch every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] 5-min fetch');
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
  console.log('[Tracker] Email tracking active - 5 min fetch, 15 min reply check');
});
