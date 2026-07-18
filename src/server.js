require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.static(__dirname));

// =====================================================
// BREVO EMAIL CONFIGURATION - VERIFIED SENDER ONLY
// =====================================================

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_NAME = 'Kishor Exports';
const BREVO_SENDER_EMAIL = 'kishorexports.ai@gmail.com'; // ✅ VERIFIED SENDER ONLY

console.log('[Brevo] Configuration:');
console.log('[Brevo] Sender Name:', BREVO_SENDER_NAME);
console.log('[Brevo] Sender Email:', BREVO_SENDER_EMAIL);
console.log('[Brevo] API Key Set:', BREVO_API_KEY ? '✅ YES' : '❌ NO');

// =====================================================
// IMPROVED BREVO EMAIL FUNCTION - USING FETCH API
// =====================================================

async function sendEmailViaBrevo(to, subject, htmlContent) {
  try {
    // Validation 1: Check API Key
    if (!BREVO_API_KEY) {
      console.error('[Brevo] ❌ BREVO_API_KEY is missing');
      return {
        success: false,
        statusCode: null,
        error: 'BREVO_API_KEY is not configured'
      };
    }

    // Validation 2: Check recipient email
    if (!to) {
      console.error('[Brevo] ❌ Recipient email is missing');
      return {
        success: false,
        statusCode: null,
        error: 'Recipient email is missing'
      };
    }

    console.log('[Brevo] ========================================');
    console.log('[Brevo] Sending email');
    console.log('[Brevo] To:', to);
    console.log('[Brevo] Subject:', subject);
    console.log('[Brevo] From:', BREVO_SENDER_EMAIL);
    console.log('[Brevo] ========================================');

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL
        },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });

    const data = await response.json();

    console.log('[Brevo] ========================================');
    console.log('[Brevo] BREVO RESPONSE');
    console.log('[Brevo] Status Code:', response.status);
    console.log('[Brevo] Response Body:', data);
    console.log('[Brevo] ========================================');

    if (!response.ok) {
      console.error('[Brevo] ❌ EMAIL REJECTED BY BREVO');
      console.error('[Brevo] Status:', response.status);
      console.error('[Brevo] Error:', data.message || data.code || 'Unknown error');

      return {
        success: false,
        statusCode: response.status,
        error: data.message || data.code || 'Brevo API returned an error',
        response: data
      };
    }

    console.log('[Brevo] ✅ EMAIL ACCEPTED BY BREVO SUCCESSFULLY');
    console.log('[Brevo] Message ID:', data.messageId || 'N/A');

    return {
      success: true,
      statusCode: response.status,
      messageId: data.messageId || null,
      response: data
    };
  } catch (error) {
    console.error('[Brevo] ❌ Request failed:', error.message);
    return {
      success: false,
      statusCode: null,
      error: error.message
    };
  }
}

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
// TRACKED SENDERS
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
// INTERNAL DOMAINS (✅ UPDATED: Added manager email)
// =====================================================

const INTERNAL_DOMAINS = new Set([
  'kishor.merchant06@gmail.com',
  'kishor.merchant24@gmail.com',
  'admin@kishorexports.com',
  'kishorexports@gmail.com',
  'noreply@kishorexports.com',
  'marketing.kishorexports1@gmail.com'  // ✅ Added manager email
].map(email => email.toLowerCase()));

// =====================================================
// EMAIL FILTERING - REMOVE AUTOMATIC REPLIES
// =====================================================

function isAutomaticReply(subject, fromHeader) {
  if (!subject) return false;

  const subjectLower = subject.toLowerCase();
  const fromLower = fromHeader.toLowerCase();

  const autoReplyKeywords = [
    'automatic reply',
    'autosvar',
    'out of office',
    'ooo',
    'away',
    'vacation',
    'sick leave',
    'maternity leave',
    'paternity leave',
    'auto-reply',
    'automated',
    'noreply',
    'no-reply',
    'do-not-reply',
    'donotreply',
    'auto generated',
    'system message',
    'undeliverable',
    'delivery status notification',
    'mail delivery failed',
    'failure notice',
    'postmaster',
    'mailer-daemon'
  ];

  for (const keyword of autoReplyKeywords) {
    if (subjectLower.includes(keyword) || fromLower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function getHeader(headers, name) {
  return (headers.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '');
}

function extractSenderEmail(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return fromHeader.trim().toLowerCase();
}

async function getToken(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const { data, error } = await supabase
    .from('users')
    .select('gmail_token')
    .eq('account_email', normalizedEmail)
    .maybeSingle();

  if (error || !data?.gmail_token) return null;

  try {
    return typeof data.gmail_token === 'string' ? JSON.parse(data.gmail_token) : data.gmail_token;
  } catch (error) {
    console.error('[Token] Invalid token for', normalizedEmail);
    return null;
  }
}

async function saveToken(email, tokens) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');

  const { data: existingUser, error: findError } = await supabase
    .from('users')
    .select('account_email')
    .eq('account_email', normalizedEmail)
    .maybeSingle();

  if (findError || !existingUser) throw new Error(`No user row for ${normalizedEmail}`);

  const { error: updateError } = await supabase
    .from('users')
    .update({ gmail_token: JSON.stringify(tokens) })
    .eq('account_email', normalizedEmail);

  if (updateError) throw updateError;
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
      const mergedTokens = { ...tokens, ...newTokens };
      await saveToken(email, mergedTokens);
    } catch (error) {
      console.error('[OAuth] Error saving token:', error.message);
    }
  });

  return client;
}

// =====================================================
// SEND REMINDER TO USER
// =====================================================

async function sendReminderToUser() {
  try {
    console.log('[Reminder] Sending reminder to user...');

    const { data: unrepliedEmails, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error || !unrepliedEmails || unrepliedEmails.length === 0) {
      console.log('[Reminder] No unreplied emails to remind about');
      return { success: true, message: 'No unreplied emails' };
    }

    console.log(`[Reminder] Found ${unrepliedEmails.length} unreplied emails`);

    let emailContent = `<h2>📧 Please Reply to These Emails</h2><p>Hi Kishor,</p><p>You have <strong>${unrepliedEmails.length} unreplied emails</strong>.</p><ul>`;

    for (const email of unrepliedEmails) {
      emailContent += `<li><strong>${email.sender_name}</strong> - ${email.subject}</li>`;
    }

    emailContent += `</ul><p>Please reply as soon as possible.</p>`;

    const result = await sendEmailViaBrevo(
      'kishor.merchant06@gmail.com',
      `⚠️ Please Reply: ${unrepliedEmails.length} Unreplied Emails`,
      emailContent
    );

    if (result.success) {
      console.log('[Reminder] ✅ Reminder accepted by Brevo');
      return { success: true, statusCode: result.statusCode };
    } else {
      console.error('[Reminder] ❌ Reminder failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('[Reminder] Error:', error.message);
    return { success: false, error: error.message };
  }
}

// =====================================================
// CHECK USER REPLY AND ALERT MANAGER (✅ FIXED: NO DUPLICATES)
// =====================================================

async function checkUserReplyAndAlertManager() {
  try {
    console.log('[Manager] Checking if user replied...');

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // ✅ FIXED: Only get emails that:
    // 1. Are unreplied
    // 2. Were received more than 24 hours ago
    // 3. HAVEN'T had manager alert sent yet
    const { data: stillUnreplied, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .lt('received_at', oneDayAgo)
      .is('manager_alert_sent_at', null);  // ✅ Only if NOT already alerted

    if (error || !stillUnreplied || stillUnreplied.length === 0) {
      console.log('[Manager] All emails have been replied to or already alerted');
      return { success: true, message: 'All emails replied or already alerted' };
    }

    console.log(`[Manager] Found ${stillUnreplied.length} emails still unreplied after 24 hours (and not yet alerted)`);

    let emailContent = `<h2>🚨 URGENT: User Did Not Reply</h2><p>User still has NOT replied to ${stillUnreplied.length} emails after 24 hours.</p><ul>`;

    for (const email of stillUnreplied) {
      emailContent += `<li><strong>${email.sender_name}</strong> - ${email.subject}</li>`;
    }

    emailContent += `</ul>`;

    const result = await sendEmailViaBrevo(
      'marketing.kishorexports1@gmail.com',
      `🚨 URGENT: ${stillUnreplied.length} Unreplied Emails After 24 Hours`,
      emailContent
    );

    if (result.success) {
      console.log('[Manager] ✅ Manager alert accepted by Brevo');
      
      // ✅ FIXED: Mark these emails as alerted so they don't trigger duplicate alerts
      for (const email of stillUnreplied) {
        await supabase
          .from('emails')
          .update({ manager_alert_sent_at: new Date().toISOString() })
          .eq('id', email.id);
      }
      
      console.log(`[Manager] ✅ Marked ${stillUnreplied.length} emails as alerted`);
      return { success: true, statusCode: result.statusCode };
    } else {
      console.error('[Manager] ❌ Manager alert failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('[Manager] Error:', error.message);
    return { success: false, error: error.message };
  }
}

// =====================================================
// CHECK FOR REPLIES
// =====================================================

async function checkForReplies(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const tokens = await getToken(normalizedEmail);

  if (!tokens) {
    console.log(`[Gmail] No token for ${normalizedEmail}`);
    return;
  }

  const client = createOAuthClient(tokens, normalizedEmail);
  const gmail = google.gmail({ version: 'v1', auth: client });

  try {
    const { data: unrepliedEmails, error } = await supabase
      .from('emails')
      .select('id, thread_id, received_at, account, sender_email, subject')
      .eq('status', 'unreplied')
      .eq('account', normalizedEmail);

    if (error || !unrepliedEmails || unrepliedEmails.length === 0) return;

    console.log(`[Gmail] Checking ${unrepliedEmails.length} emails for replies`);

    let updated = 0;

    for (const emailRecord of unrepliedEmails) {
      if (!emailRecord.thread_id) continue;

      try {
        const { data: thread } = await gmail.users.threads.get({
          userId: 'me',
          id: emailRecord.thread_id,
          format: 'metadata'
        });

        if (!thread) continue;

        const messages = thread.messages || [];
        const receivedTime = new Date(emailRecord.received_at).getTime();

        let foundReply = false;

        for (const message of messages) {
          const labels = message.labelIds || [];
          const isSentEmail = labels.includes('SENT');
          const messageTime = Number(message.internalDate || 0);

          if (isSentEmail && messageTime > receivedTime) {
            foundReply = true;
            break;
          }
        }

        if (!foundReply) continue;

        await supabase
          .from('emails')
          .update({
            status: 'replied',
            replied_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', emailRecord.id);

        updated++;
      } catch (threadError) {
        console.error('[Gmail] Error checking thread:', threadError.message);
      }
    }

    console.log(`[Gmail] Updated ${updated} emails to replied status`);
  } catch (error) {
    console.error('[Gmail] Error:', error.message);
  }
}

// =====================================================
// FETCH ALL EMAILS (WITH FILTERING)
// =====================================================

async function fetchAllEmails(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const tokens = await getToken(normalizedEmail);

  if (!tokens) {
    console.log(`[Gmail] No token for ${normalizedEmail}`);
    return 0;
  }

  const client = createOAuthClient(tokens, normalizedEmail);
  const gmail = google.gmail({ version: 'v1', auth: client });

  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const afterDate = fiveDaysAgo.toISOString().split('T')[0];

    const senderQuery = Array.from(TRACKED).map(sender => `from:${sender}`).join(' OR ');
    const query = `in:inbox after:${afterDate} (${senderQuery})`;

    console.log(`[Gmail] Fetching emails from ${afterDate}`);

    const { data: messageResult } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500
    });

    const messages = messageResult?.messages || [];
    if (!messages.length) {
      console.log(`[Gmail] No tracked emails found`);
      return 0;
    }

    let saved = 0;
    let filtered = 0;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    for (const message of messages) {
      try {
        const { data: existingEmail } = await supabase
          .from('emails')
          .select('id')
          .eq('email_id', message.id)
          .maybeSingle();

        if (existingEmail) continue;

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

        if (!TRACKED.has(senderEmail) || INTERNAL_DOMAINS.has(senderEmail)) continue;

        // ✅ FILTER: Skip automatic replies
        if (isAutomaticReply(subject, fromHeader)) {
          console.log(`[Gmail] ⊘ Filtering automatic reply: "${subject}"`);
          filtered++;
          continue;
        }

        const receivedDate = new Date(receivedAtRaw || Date.now());
        if (Number.isNaN(receivedDate.getTime())) continue;

        const receivedAt = receivedDate.toISOString();
        const emailAge = Date.now() - receivedDate.getTime();

        if (emailAge > fiveDaysMs) continue;

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

        if (!insertError) saved++;
      } catch (messageError) {
        // Continue processing
      }
    }

    console.log(`[Gmail] Saved ${saved} new emails (Filtered: ${filtered} automatic replies)`);
    return saved;
  } catch (error) {
    console.error(`[Gmail] Error:`, error.message);
    return 0;
  }
}

// =====================================================
// ROUTES
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
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

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state: account } = req.query;
    if (!code) return res.status(400).send('No code');

    const { tokens } = await oauth2Client.getToken(code);
    await saveToken(account, tokens);

    console.log(`[OAuth] Auth success for ${account}`);
    res.redirect(`/?google_login=success&email=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state: account } = req.query;
    if (!code) return res.status(400).send('No code');

    const { tokens } = await oauth2Client.getToken(code);
    await saveToken(account, tokens);

    console.log(`[OAuth] Auth success for ${account}`);
    res.redirect(`/?google_login=success&email=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

// =====================================================
// API ENDPOINTS - STATISTICS
// =====================================================

app.get('/api/stats', async (req, res) => {
  try {
    const { data: emails, error } = await supabase.from('emails').select('status, received_at');

    if (error) throw error;

    const records = emails || [];
    const today = new Date().toISOString().split('T')[0];

    const total = records.length;
    const unreplied = records.filter(e => e.status === 'unreplied').length;
    const replied = records.filter(e => e.status === 'replied').length;
    const todayCount = records.filter(e => e.received_at.startsWith(today)).length;

    res.json({ total, unreplied, replied, today: todayCount });
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API ENDPOINTS - EMAIL RETRIEVAL
// =====================================================

app.get('/api/emails', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      data: data || [],
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/emails/unreplied', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .eq('status', 'unreplied')
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      data: data || [],
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/emails/:emailId/body', async (req, res) => {
  try {
    const requestedEmailId = req.params.emailId;

    let { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('id', requestedEmailId)
      .maybeSingle();

    if (!email && !emailError) {
      const result = await supabase.from('emails').select('*').eq('email_id', requestedEmailId).maybeSingle();
      email = result.data;
      emailError = result.error;
    }

    if (emailError || !email) return res.status(404).json({ error: 'Not found' });

    const tokens = await getToken(email.account);
    if (!tokens) return res.status(401).json({ error: 'No token' });

    const client = createOAuthClient(tokens, email.account);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const { data: fullMessage } = await gmail.users.messages.get({
      userId: 'me',
      id: email.email_id,
      format: 'full'
    });

    const payload = fullMessage.payload || {};
    let body = '';

    function findMessagePart(parts, targetMimeType) {
      for (const part of parts || []) {
        if (part.mimeType === targetMimeType && part.body?.data) return part;
        if (part.parts?.length) {
          const nestedPart = findMessagePart(part.parts, targetMimeType);
          if (nestedPart) return nestedPart;
        }
      }
      return null;
    }

    if (payload.parts?.length) {
      const textPart = findMessagePart(payload.parts, 'text/plain');
      const htmlPart = findMessagePart(payload.parts, 'text/html');

      if (textPart) {
        body = Buffer.from(textPart.body.data, 'base64url').toString('utf8');
      } else if (htmlPart) {
        body = Buffer.from(htmlPart.body.data, 'base64url').toString('utf8');
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }

    res.json({ body: body || 'No content' });
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API ENDPOINTS - EMAIL STATUS UPDATE
// =====================================================

app.patch('/api/emails/:emailId/status', async (req, res) => {
  try {
    const { emailId } = req.params;
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
      .eq('id', emailId);

    if (error) throw error;

    res.json({ success: true, status });
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// EMAIL DIAGNOSTICS ENDPOINT
// =====================================================

app.get('/api/test/email-diagnostics', async (req, res) => {
  console.log('[Diagnostics] Running email configuration check...');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    configuration: {},
    status: 'UNKNOWN'
  };

  diagnostics.configuration.brevo_api_key = {
    status: BREVO_API_KEY ? 'PASS' : 'FAIL',
    configured: BREVO_API_KEY ? true : false
  };

  diagnostics.configuration.sender_email = {
    status: BREVO_SENDER_EMAIL ? 'PASS' : 'FAIL',
    value: BREVO_SENDER_EMAIL
  };

  diagnostics.configuration.sender_name = {
    status: BREVO_SENDER_NAME ? 'PASS' : 'FAIL',
    value: BREVO_SENDER_NAME
  };

  diagnostics.configuration.brevo_endpoint = {
    status: 'PASS',
    value: 'https://api.brevo.com/v3/smtp/email'
  };

  const supabaseOk = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  diagnostics.configuration.supabase = {
    status: supabaseOk ? 'PASS' : 'FAIL',
    configured: supabaseOk ? true : false
  };

  const failedChecks = Object.values(diagnostics.configuration)
    .filter(c => c.status === 'FAIL').length;

  if (failedChecks === 0) {
    diagnostics.status = 'ALL_CHECKS_PASSED';
    diagnostics.message = 'Configuration looks good. Email sending should work.';
  } else {
    diagnostics.status = 'CONFIGURATION_INCOMPLETE';
    diagnostics.message = `${failedChecks} configuration checks failed.`;
  }

  res.json(diagnostics);
});

// =====================================================
// DIRECT EMAIL TEST ENDPOINT
// =====================================================

app.get('/api/test/send-direct-email', async (req, res) => {
  console.log('[Test] ========================================');
  console.log('[Test] DIRECT EMAIL TEST - FULL DIAGNOSTIC');
  console.log('[Test] ========================================');
  console.log('[Test] Configuration:');
  console.log('[Test]   Brevo API Key:', BREVO_API_KEY ? '✅ Set' : '❌ NOT SET');
  console.log('[Test]   Sender Email:', BREVO_SENDER_EMAIL);
  console.log('[Test]   Sender Name:', BREVO_SENDER_NAME);
  console.log('[Test] ========================================');
  
  const testEmail = 'kishor.merchant06@gmail.com';
  const testSubject = '🧪 Brevo Direct Test Email';
  const testContent = `
<h2>Brevo Test</h2>
<p>This is a direct test email from the Kishor Exports Email Tracker.</p>
<p><strong>If you receive this email, Brevo API sending is working correctly.</strong></p>
<p style="color: #888; font-size: 12px;">
  Sent at: ${new Date().toISOString()}<br>
  From: ${BREVO_SENDER_EMAIL}<br>
  To: ${testEmail}
</p>
`;

  console.log('[Test] Attempting to send test email...');
  const result = await sendEmailViaBrevo(testEmail, testSubject, testContent);
  
  console.log('[Test] Result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log('[Test] ========================================');

  if (result.success) {
    res.json({
      success: true,
      message: 'Email accepted by Brevo',
      statusCode: result.statusCode,
      messageId: result.messageId
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Email was not accepted by Brevo',
      statusCode: result.statusCode,
      error: result.error
    });
  }
});

// =====================================================
// TEST REMINDER ENDPOINT
// =====================================================

app.get('/api/test/send-user-reminder', async (req, res) => {
  try {
    console.log('[Test] Testing user reminder...');
    const result = await sendReminderToUser();
    
    if (result.success) {
      res.json({
        success: true,
        message: '✅ Reminder accepted by Brevo',
        statusCode: result.statusCode
      });
    } else {
      res.status(400).json({
        success: false,
        message: '❌ Reminder failed',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// TEST MANAGER ALERT ENDPOINT
// =====================================================

app.get('/api/test/check-user-reply-alert-manager', async (req, res) => {
  try {
    console.log('[Test] Testing manager alert...');
    const result = await checkUserReplyAndAlertManager();
    
    if (result.success) {
      res.json({
        success: true,
        message: '✅ Manager alert accepted by Brevo',
        statusCode: result.statusCode
      });
    } else {
      res.status(400).json({
        success: false,
        message: '❌ Manager alert failed',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// CRON JOBS
// =====================================================

cron.schedule('*/5 * * * *', async () => {
  try {
    const { data: users } = await supabase.from('users').select('account_email').not('gmail_token', 'is', null);
    if (users) {
      for (const user of users) {
        await fetchAllEmails(user.account_email);
      }
    }
  } catch (error) {
    console.error('[Cron] Fetch error:', error.message);
  }
});

cron.schedule('*/5 * * * *', async () => {
  try {
    const { data: users } = await supabase.from('users').select('account_email').not('gmail_token', 'is', null);
    if (users) {
      for (const user of users) {
        await checkForReplies(user.account_email);
      }
    }
  } catch (error) {
    console.error('[Cron] Reply check error:', error.message);
  }
});

cron.schedule('0 * * * *', async () => {
  try {
    await sendReminderToUser();
  } catch (error) {
    console.error('[Cron] Reminder error:', error.message);
  }
});

cron.schedule('30 3 * * *', async () => {
  try {
    await checkUserReplyAndAlertManager();
  } catch (error) {
    console.error('[Cron] Manager alert error:', error.message);
  }
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('[Server] ========================================');
  console.log('[Server] KISHOR EMAIL TRACKER STARTED');
  console.log('[Server] ========================================');
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Tracking ${TRACKED.size} senders`);
  console.log(`[Server] Brevo sender: ${BREVO_SENDER_EMAIL}`);
  console.log('[Server] ========================================');
  console.log('[Cron] Email fetch: Every 5 minutes');
  console.log('[Cron] Reply check: Every 5 minutes');
  console.log('[Cron] User reminder: Every hour (0:00)');
  console.log('[Cron] Manager alert: Daily at 3:30 AM UTC');
  console.log('[Server] ========================================');
  console.log('✅ Server is ready!');
});
