require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// GOOGLE OAUTH SETUP
// =====================================================

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
];

function getDefaultGmailAccount() {
  return (process.env.GMAIL_ACCOUNTS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)[0] || '';
}

// =====================================================
// ONLY THESE 15 SENDERS WILL BE TRACKED
// =====================================================

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
].map(email => email.toLowerCase()));

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function getHeader(headers, name) {
  return (
    headers.find(
      header => header.name.toLowerCase() === name.toLowerCase()
    )?.value || ''
  );
}

function extractSenderEmail(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/);

  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }

  return fromHeader.trim().toLowerCase();
}

async function getToken(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const { data, error } = await supabase
    .from('users')
    .select('gmail_token')
    .eq('account_email', normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error(`[Supabase] Failed to load token for ${normalizedEmail}:`, error.message);
    return null;
  }

  if (!data?.gmail_token) {
    return null;
  }

  try {
    return typeof data.gmail_token === 'string'
      ? JSON.parse(data.gmail_token)
      : data.gmail_token;
  } catch (error) {
    console.error(`[Token] Invalid Gmail token for ${normalizedEmail}`);
    return null;
  }
}

async function saveToken(email, tokens) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('Account email is missing while saving Gmail token.');
  }

  const { data: existingUser, error: findError } = await supabase
    .from('users')
    .select('account_email')
    .eq('account_email', normalizedEmail)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (!existingUser) {
    throw new Error(
      `No user row found for ${normalizedEmail}. Add this email to the users table under account_email first.`
    );
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      gmail_token: JSON.stringify(tokens)
    })
    .eq('account_email', normalizedEmail);

  if (updateError) {
    throw updateError;
  }
}

function createOAuthClient(tokens, email) {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  client.setCredentials(tokens);

  client.on('tokens', async newTokens => {
    try {
      const mergedTokens = {
        ...tokens,
        ...newTokens
      };

      await saveToken(email, mergedTokens);
      console.log(`[OAuth] Refreshed token saved for ${email}`);
    } catch (error) {
      console.error(`[OAuth] Failed to save refreshed token for ${email}:`, error.message);
    }
  });

  return client;
}

// =====================================================
// FETCH EMAILS - ONLY FROM 15 TRACKED SENDERS
// =====================================================

async function fetchAllEmails(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const tokens = await getToken(normalizedEmail);

  if (!tokens) {
    console.log(`[Gmail] No token found for ${normalizedEmail}`);
    return 0;
  }

  const client = createOAuthClient(tokens, normalizedEmail);

  const gmail = google.gmail({
    version: 'v1',
    auth: client
  });

  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const afterDate = fiveDaysAgo.toISOString().split('T')[0];

    const senderQuery = Array.from(TRACKED)
      .map(sender => `from:${sender}`)
      .join(' OR ');

    const query = `in:inbox after:${afterDate} (${senderQuery})`;

    console.log(
      `[Gmail] Fetching emails for ${normalizedEmail} from ${afterDate}`
    );

    const { data: messageResult } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500
    });

    const messages = messageResult?.messages || [];

    if (!messages.length) {
      console.log(`[Gmail] No tracked emails found for ${normalizedEmail}`);
      return 0;
    }

    let saved = 0;
    let skipped = 0;

    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    for (const message of messages) {
      try {
        const { data: existingEmail } = await supabase
          .from('emails')
          .select('id')
          .eq('email_id', message.id)
          .maybeSingle();

        if (existingEmail) {
          skipped++;
          continue;
        }

        const { data: fullMessage } = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });

        const headers = fullMessage.payload?.headers || [];

        const fromHeader = getHeader(headers, 'From');
        const subject = getHeader(headers, 'Subject') || '(No Subject)';
        const receivedAtRaw = getHeader(headers, 'Date');

        const senderEmail = extractSenderEmail(fromHeader);

        if (!TRACKED.has(senderEmail)) {
          skipped++;
          continue;
        }

        const receivedDate = new Date(receivedAtRaw || Date.now());

        if (Number.isNaN(receivedDate.getTime())) {
          skipped++;
          console.log(`[Gmail] Invalid date for email from ${senderEmail}`);
          continue;
        }

        const receivedAt = receivedDate.toISOString();
        const emailAge = Date.now() - receivedDate.getTime();

        if (emailAge > fiveDaysMs) {
          skipped++;
          console.log(`[Gmail] Skipped old email from ${senderEmail}`);
          continue;
        }

        const { error: insertError } = await supabase
          .from('emails')
          .insert({
            email_id: message.id,
            thread_id: fullMessage.threadId,
            account: normalizedEmail,
            sender_email: senderEmail,
            sender_name: fromHeader.split('<')[0].trim(),
            subject,
            received_at: receivedAt,
            status: 'unreplied',
            body_preview: fullMessage.snippet || ''
          });

        if (!insertError) {
          saved++;
          console.log(`[Gmail] Saved email from ${senderEmail}: "${subject}"`);
        }
      } catch (messageError) {
        if (!messageError.code?.includes('PGRST')) {
          console.error(
            `[Gmail] Error processing message ${message.id}:`,
            messageError.message
          );
        }
      }
    }

    console.log(
      `[Gmail] Fetch complete for ${normalizedEmail}: ${saved} saved, ${skipped} skipped`
    );

    return saved;
  } catch (error) {
    console.error(`[Gmail] Fetch error for ${normalizedEmail}:`, error.message);
    return 0;
  }
}

// =====================================================
// CHECK FOR REPLIES - IMPROVED WITH DETAILED LOGGING
// =====================================================

async function checkForReplies(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const tokens = await getToken(normalizedEmail);

  if (!tokens) {
    console.log(`[Gmail] No token found for reply check: ${normalizedEmail}`);
    return;
  }

  const client = createOAuthClient(tokens, normalizedEmail);

  const gmail = google.gmail({
    version: 'v1',
    auth: client
  });

  try {
    const { data: unrepliedEmails, error: fetchError } = await supabase
      .from('emails')
      .select('id, thread_id, received_at, account, sender_email, subject')
      .eq('status', 'unreplied')
      .eq('account', normalizedEmail);

    if (fetchError) {
      throw fetchError;
    }

    if (!unrepliedEmails || unrepliedEmails.length === 0) {
      console.log(`[Gmail] No unreplied emails to check for ${normalizedEmail}`);
      return;
    }

    console.log(`[Gmail] ========================================`);
    console.log(`[Gmail] Checking ${unrepliedEmails.length} unreplied emails for ${normalizedEmail}`);
    console.log(`[Gmail] ========================================`);

    let updated = 0;

    for (const emailRecord of unrepliedEmails) {
      if (!emailRecord.thread_id) {
        console.log(`[Gmail] ⚠️  SKIPPED: "${emailRecord.subject}"`);
        console.log(`        From: ${emailRecord.sender_email} - NO THREAD ID`);
        continue;
      }

      try {
        const { data: thread } = await gmail.users.threads.get({
          userId: 'me',
          id: emailRecord.thread_id,
          format: 'metadata'
        });

        if (!thread) {
          console.log(`[Gmail] ⚠️  SKIPPED: Thread ${emailRecord.thread_id} not found`);
          continue;
        }

        const messages = thread.messages || [];
        const receivedTime = new Date(emailRecord.received_at).getTime();

        console.log(`[Gmail] 🔍 CHECKING: "${emailRecord.subject}"`);
        console.log(`        From: ${emailRecord.sender_email}`);
        console.log(`        Thread ID: ${emailRecord.thread_id}`);
        console.log(`        Messages in thread: ${messages.length}`);
        console.log(`        Original received: ${new Date(receivedTime).toISOString()}`);

        let foundReply = false;

        for (const message of messages) {
          const labels = message.labelIds || [];
          const isSentEmail = labels.includes('SENT');
          const messageTime = Number(message.internalDate || 0);

          if (isSentEmail && messageTime > receivedTime) {
            console.log(`        ✅ REPLY DETECTED - SENT at ${new Date(messageTime).toISOString()}`);
            foundReply = true;
            break;
          }
        }

        if (!foundReply) {
          console.log(`        ❌ NO REPLY found in this thread`);
          continue;
        }

        const { error: updateError } = await supabase
          .from('emails')
          .update({
            status: 'replied',
            replied_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', emailRecord.id);

        if (updateError) {
          console.error(`[Supabase] Failed to update email ${emailRecord.id}:`, updateError.message);
          continue;
        }

        updated++;
        console.log(`        ✅ DATABASE UPDATED to REPLIED`);
        console.log(`[Gmail] ----------------------------------------`);
      } catch (threadError) {
        console.error(`[Gmail] ❌ Error checking thread ${emailRecord.thread_id}:`, threadError.message);
      }
    }

    console.log(`[Gmail] ========================================`);
    console.log(`[Gmail] REPLY CHECK COMPLETE`);
    console.log(`[Gmail] Account: ${normalizedEmail}`);
    console.log(`[Gmail] Total checked: ${unrepliedEmails.length}`);
    console.log(`[Gmail] Updated to replied: ${updated}`);
    console.log(`[Gmail] Still unreplied: ${unrepliedEmails.length - updated}`);
    console.log(`[Gmail] ========================================`);
  } catch (error) {
    console.error(`[Gmail] Reply check error for ${normalizedEmail}:`, error.message);
  }
}

// =====================================================
// SEND REMINDER EMAILS
// =====================================================

async function sendReminderEmails() {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SENDER_EMAIL,
        pass: process.env.SENDER_PASSWORD
      }
    });

    const { data: unrepliedEmails } = await supabase
      .from('emails')
      .select('id, sender_email, subject, account')
      .eq('status', 'unreplied');

    if (!unrepliedEmails || unrepliedEmails.length === 0) {
      console.log('[Reminder] No unreplied emails to remind about');
      return;
    }

    const { data: users } = await supabase
      .from('users')
      .select('account_email')
      .eq('role', 'senior_manager');

    if (!users || users.length === 0) {
      console.log('[Reminder] No managers to send reminders to');
      return;
    }

    for (const user of users) {
      const unrepliedList = unrepliedEmails
        .filter(e => e.account === user.account_email)
        .map(e => `- From: ${e.sender_email}\n  Subject: ${e.subject}`)
        .join('\n');

      if (!unrepliedList) {
        continue;
      }

      const emailContent = `
Hello,

You have ${unrepliedEmails.filter(e => e.account === user.account_email).length} unreplied emails that need your attention:

${unrepliedList}

Please reply to these emails at your earliest convenience.

Best regards,
Email Tracker System
      `;

      try {
        await transporter.sendMail({
          from: process.env.SENDER_EMAIL,
          to: user.account_email,
          subject: `Reminder: ${unrepliedEmails.filter(e => e.account === user.account_email).length} Unreplied Emails`,
          text: emailContent
        });

        console.log(`[Reminder] Sent reminder to ${user.account_email}`);
      } catch (mailError) {
        console.error(`[Reminder] Failed to send to ${user.account_email}:`, mailError.message);
      }
    }
  } catch (error) {
    console.error('[Reminder] Error sending reminders:', error.message);
  }
}

// =====================================================
// ROUTES
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/auth/google', (req, res) => {
  const account = req.query.account || getDefaultGmailAccount();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state: account,
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

// =====================================================
// OAUTH CALLBACK - BOTH ROUTES TO HANDLE ALL CASES
// =====================================================

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state: account } = req.query;

    if (!code) {
      return res.status(400).send('No authorization code provided');
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.warn('[OAuth] No refresh token in response');
    }

    await saveToken(account, tokens);

    console.log(`[OAuth] Successfully authenticated ${account}`);
    res.redirect(`/?success=true&account=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state: account } = req.query;

    if (!code) {
      return res.status(400).send('No authorization code provided');
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.warn('[OAuth] No refresh token in response');
    }

    await saveToken(account, tokens);

    console.log(`[OAuth] Successfully authenticated ${account}`);
    res.redirect(`/?success=true&account=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// =====================================================
// API: GET EMAILS
// =====================================================

app.get('/api/emails', async (req, res) => {
  try {
    const { status, account, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .order('received_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (account) {
      query = query.eq('account', account);
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      data,
      count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('[API] Error fetching emails:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API: GET UNREPLIED EMAILS
// =====================================================

app.get('/api/emails/unreplied', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .eq('status', 'unreplied')
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      data,
      count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('[API] Error fetching unreplied emails:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API: GET EMAIL BODY
// =====================================================

app.get('/api/emails/:emailId/body', async (req, res) => {
  try {
    const { data: email, error } = await supabase
      .from('emails')
      .select('*')
      .eq('id', req.params.emailId)
      .single();

    if (error || !email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const tokens = await getToken(email.account);
    if (!tokens) {
      return res.status(401).json({ error: 'No auth tokens' });
    }

    const client = createOAuthClient(tokens, email.account);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const { data: message } = await gmail.users.messages.get({
      userId: 'me',
      id: email.email_id,
      format: 'full'
    });

    const body = message.payload?.parts?.[0]?.body?.data || message.payload?.body?.data || '';
    const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

    res.json({ body: decodedBody });
  } catch (error) {
    console.error('[API] Error fetching email body:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API: UPDATE EMAIL STATUS
// =====================================================

app.patch('/api/emails/:emailId/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!['unreplied', 'replied', 'no_reply_needed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { error } = await supabase
      .from('emails')
      .update({
        status,
        updated_at: new Date().toISOString(),
        replied_at: status === 'replied' ? new Date().toISOString() : null
      })
      .eq('id', req.params.emailId);

    if (error) throw error;

    res.json({ success: true, status });
  } catch (error) {
    console.error('[API] Error updating email status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API: GET STATISTICS
// =====================================================

app.get('/api/stats', async (req, res) => {
  try {
    const { data: total } = await supabase
      .from('emails')
      .select('id', { count: 'exact' });

    const { data: unreplied } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'unreplied');

    const { data: replied } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'replied');

    const { data: noreply } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'no_reply_needed');

    res.json({
      total: total?.length || 0,
      unreplied: unreplied?.length || 0,
      replied: replied?.length || 0,
      no_reply_needed: noreply?.length || 0
    });
  } catch (error) {
    console.error('[API] Error getting stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API: GET USERS/AGENTS
// =====================================================

app.get('/api/agents', async (req, res) => {
  try {
    const { data: agents, error } = await supabase
      .from('users')
      .select('account_email, name, role');

    if (error) throw error;

    res.json(agents || []);
  } catch (error) {
    console.error('[API] Error fetching agents:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// DEBUG ENDPOINT
// =====================================================

app.get('/api/debug', async (req, res) => {
  try {
    const debug = {
      timestamp: new Date().toISOString(),
      server_status: 'running',
      tracked_senders: Array.from(TRACKED).length,
      issues: []
    };

    const { data: testQuery, error: testError } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .limit(1);

    if (testError) {
      debug.issues.push(`Supabase connection failed: ${testError.message}`);
      return res.json(debug);
    }

    debug.supabase = 'connected';

    const { data: usersWithTokens, error: usersError } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .not('gmail_token', 'is', null);

    if (usersError) {
      debug.issues.push(`Failed to fetch users: ${usersError.message}`);
      return res.json(debug);
    }

    debug.users_with_tokens = usersWithTokens?.length || 0;

    if (usersWithTokens && usersWithTokens.length > 0) {
      for (const user of usersWithTokens) {
        const tokens = await getToken(user.account_email);

        if (!tokens) {
          debug.issues.push(`❌ ${user.account_email}: Gmail token invalid or expired`);
        } else {
          debug.gmail_connected = user.account_email;
        }
      }
    } else {
      debug.issues.push('❌ No users with Gmail tokens in database');
    }

    const { data: emailCount, error: emailError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' });

    if (!emailError) {
      debug.emails_in_database = emailCount?.length || 0;
    }

    const { data: unrepliedCount, error: unrepliedError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'unreplied');

    if (!unrepliedError) {
      debug.unreplied_emails = unrepliedCount?.length || 0;
    }

    const { data: repliedCount, error: repliedError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'replied');

    if (!repliedError) {
      debug.replied_emails = repliedCount?.length || 0;
    }

    return res.json(debug);
  } catch (error) {
    console.error('[DEBUG] Error:', error.message);
    return res.status(500).json({
      error: error.message
    });
  }
});

// =====================================================
// MANUAL SYNC ROUTE
// =====================================================

app.get('/api/sync', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('account_email')
      .not('gmail_token', 'is', null);

    if (error) {
      throw error;
    }

    let totalSaved = 0;

    for (const user of users || []) {
      totalSaved += await fetchAllEmails(user.account_email);
    }

    return res.json({
      success: true,
      saved: totalSaved
    });
  } catch (error) {
    console.error('[API] Manual synchronization failed:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

// =====================================================
// CRON JOBS
// =====================================================

// Fetch emails every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log('[Cron] Starting 5-minute Gmail fetch for tracked senders');

    const { data: users, error } = await supabase
      .from('users')
      .select('account_email')
      .not('gmail_token', 'is', null);

    if (error) {
      throw error;
    }

    for (const user of users || []) {
      await fetchAllEmails(user.account_email);
    }
  } catch (error) {
    console.error('[Cron] Gmail fetch failed:', error.message);
  }
});

// Check replies every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('[Cron] Starting 15-minute reply check');

    const { data: users, error } = await supabase
      .from('users')
      .select('account_email')
      .not('gmail_token', 'is', null);

    if (error) {
      throw error;
    }

    for (const user of users || []) {
      await checkForReplies(user.account_email);
    }
  } catch (error) {
    console.error('[Cron] Reply check failed:', error.message);
  }
});

// Send reminder emails daily at 3:30 AM
cron.schedule('30 3 * * *', async () => {
  try {
    console.log('[Cron] Starting daily reminder email send');
    await sendReminderEmails();
  } catch (error) {
    console.error('[Cron] Reminder send failed:', error.message);
  }
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Health check: /health`);
  console.log(`[OAuth] Connect Gmail: /auth/google`);
  console.log(
    `[Tracker] Tracking only ${TRACKED.size} approved senders from the last 5 days`
  );
  console.log(`[Cron] Fetch emails: Every 5 minutes`);
  console.log(`[Cron] Check replies: Every 15 minutes`);
  console.log(`[Cron] Send reminders: Daily at 3:30 AM`);
});
