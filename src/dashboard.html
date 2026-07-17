require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.static(__dirname));

// =====================================================
// EMAIL SETUP - BREVO API (FIXED)
// =====================================================

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Kishor Exports';
// ✅ FIXED: Use verified sender email
const BREVO_SENDER_EMAIL = (process.env.BREVO_SENDER_EMAIL || 'kishorexports.ai@gmail.com').trim().toLowerCase();

console.log('[Email] Sender:', BREVO_SENDER_EMAIL);

// ✅ FIXED: Send email with proper response logging
async function sendEmailViaBrevo(to, subject, htmlContent) {
  return new Promise((resolve) => {
    try {
      if (!BREVO_API_KEY) {
        console.error('[Email] ❌ BREVO_API_KEY not set');
        resolve(false);
        return;
      }

      const emailData = JSON.stringify({
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent,
        sender: { 
          name: BREVO_SENDER_NAME, 
          email: BREVO_SENDER_EMAIL
        }
      });

      const options = {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(emailData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log('[Email] ==============================');
          console.log('[Email] BREVO RESPONSE');
          console.log('[Email] Status:', res.statusCode);
          console.log('[Email] Body:', data);
          console.log('[Email] ==============================');

          if (res.statusCode === 201) {
            console.log(`[Email] ✅ SUCCESS to ${to}`);
            resolve(true);
          } else {
            console.error('[Email] ❌ Failed -', res.statusCode);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error('[Email] ❌ Error:', error.message);
        resolve(false);
      });

      req.write(emailData);
      req.end();

    } catch (error) {
      console.error('[Email] ❌ Exception:', error.message);
      resolve(false);
    }
  });
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
// INTERNAL DOMAINS
// =====================================================

const INTERNAL_DOMAINS = new Set([
  'kishor.merchant06@gmail.com',
  'kishor.merchant24@gmail.com',
  'admin@kishorexports.com',
  'kishorexports@gmail.com',
  'noreply@kishorexports.com'
].map(email => email.toLowerCase()));

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
    console.log('[Reminder] Sending reminder...');

    const { data: unrepliedEmails, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error || !unrepliedEmails || unrepliedEmails.length === 0) {
      console.log('[Reminder] No unreplied emails');
      return true;
    }

    console.log(`[Reminder] Found ${unrepliedEmails.length} unreplied emails`);

    let emailContent = `<h2>📧 Please Reply to These Emails</h2><p>Hi Kishor,</p><p>You have <strong>${unrepliedEmails.length} unreplied emails</strong>.</p><ul>`;

    for (const email of unrepliedEmails) {
      emailContent += `<li><strong>${email.sender_name}</strong> - ${email.subject}</li>`;
    }

    emailContent += `</ul><p>Please reply as soon as possible.</p>`;

    const sent = await sendEmailViaBrevo(
      'kishor.merchant06@gmail.com',
      `⚠️ Please Reply: ${unrepliedEmails.length} Unreplied Emails`,
      emailContent
    );

    return sent;
  } catch (error) {
    console.error('[Reminder] Error:', error.message);
    return false;
  }
}

// =====================================================
// CHECK USER REPLY AND ALERT MANAGER
// =====================================================

async function checkUserReplyAndAlertManager() {
  try {
    console.log('[Manager] Checking user reply...');

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stillUnreplied, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .lt('received_at', oneDayAgo);

    if (error || !stillUnreplied || stillUnreplied.length === 0) {
      console.log('[Manager] All emails replied');
      return true;
    }

    console.log(`[Manager] Found ${stillUnreplied.length} emails still unreplied`);

    let emailContent = `<h2>🚨 URGENT: User Did Not Reply</h2><p>User still has NOT replied to ${stillUnreplied.length} emails after 24 hours.</p><ul>`;

    for (const email of stillUnreplied) {
      emailContent += `<li><strong>${email.sender_name}</strong> - ${email.subject}</li>`;
    }

    emailContent += `</ul>`;

    const sent = await sendEmailViaBrevo(
      'marketing.kishorexports1@gmail.com',
      `🚨 URGENT: ${stillUnreplied.length} Unreplied Emails After 24 Hours`,
      emailContent
    );

    return sent;
  } catch (error) {
    console.error('[Manager] Error:', error.message);
    return false;
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

    console.log(`[Gmail] Updated ${updated} emails`);
  } catch (error) {
    console.error('[Gmail] Error:', error.message);
  }
}

// =====================================================
// FETCH ALL EMAILS
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

    console.log(`[Gmail] Saved ${saved} emails`);
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
// EMAIL HISTORY ENDPOINT
// =====================================================

app.get('/api/email-history', async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('reminder_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    res.json({ 
      success: true, 
      total: logs ? logs.length : 0,
      logs: logs || [] 
    });
  } catch (error) {
    console.error('[API] Error fetching email history:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// EMAIL DIAGNOSTICS ENDPOINT
// =====================================================

app.get('/api/test/email-diagnostics', async (req, res) => {
  console.log('[TEST] Running email diagnostics...');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    checks: {},
    recommendation: '',
    nextSteps: []
  };

  diagnostics.checks.api_key = {
    status: BREVO_API_KEY ? 'PASS' : 'FAIL',
    description: BREVO_API_KEY ? 'BREVO_API_KEY is set' : 'BREVO_API_KEY is MISSING'
  };

  diagnostics.checks.sender_email = {
    status: BREVO_SENDER_EMAIL && !BREVO_SENDER_EMAIL.includes('not-set') ? 'PASS' : 'FAIL',
    value: BREVO_SENDER_EMAIL,
    description: BREVO_SENDER_EMAIL ? `Sender: ${BREVO_SENDER_EMAIL}` : 'BREVO_SENDER_EMAIL is MISSING'
  };

  diagnostics.checks.sender_name = {
    status: BREVO_SENDER_NAME ? 'PASS' : 'FAIL',
    value: BREVO_SENDER_NAME,
    description: `Sender name: ${BREVO_SENDER_NAME}`
  };

  const supabaseOk = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  diagnostics.checks.supabase = {
    status: supabaseOk ? 'PASS' : 'FAIL',
    description: supabaseOk ? 'Supabase configured' : 'Supabase not configured'
  };

  const failedChecks = Object.values(diagnostics.checks).filter(c => c.status === 'FAIL').length;
  
  if (failedChecks === 0) {
    diagnostics.status = 'ALL_CHECKS_PASSED';
    diagnostics.recommendation = 'All configuration looks good. Email sending should work.';
    diagnostics.nextSteps = [
      'Try sending a test email with /api/test/send-email-test',
      'Check Render logs for detailed error messages',
      'If email still fails, check Brevo dashboard for blocked senders'
    ];
  } else if (failedChecks <= 2) {
    diagnostics.status = 'SOME_CHECKS_FAILED';
    diagnostics.recommendation = 'Fix the failed configuration items below.';
    diagnostics.nextSteps = [];
    
    if (diagnostics.checks.api_key.status === 'FAIL') {
      diagnostics.nextSteps.push('CRITICAL: Set BREVO_API_KEY in Render environment variables');
    }
    if (diagnostics.checks.sender_email.status === 'FAIL') {
      diagnostics.nextSteps.push('CRITICAL: Set BREVO_SENDER_EMAIL in Render environment variables');
      diagnostics.nextSteps.push('Make sure the sender email is verified in Brevo dashboard');
    }
  } else {
    diagnostics.status = 'CRITICAL_FAILURE';
    diagnostics.recommendation = 'Multiple configuration issues. Email sending cannot work.';
    diagnostics.nextSteps = [
      'Go to Render → Settings → Environment',
      'Add all missing environment variables',
      'Redeploy the application',
      'Check Brevo dashboard for sender verification'
    ];
  }

  res.json(diagnostics);
});

// =====================================================
// DIRECT EMAIL TEST ENDPOINT
// =====================================================

app.get('/api/test/send-direct-email', async (req, res) => {
  console.log('[TEST] ========================================');
  console.log('[TEST] DIRECT EMAIL TEST - FULL DIAGNOSTIC');
  console.log('[TEST] ========================================');
  console.log('[TEST] Configuration:');
  console.log('[TEST]   API Key Present:', BREVO_API_KEY ? 'YES ✅' : 'NO ❌');
  console.log('[TEST]   Sender Email:', BREVO_SENDER_EMAIL);
  console.log('[TEST]   Sender Name:', BREVO_SENDER_NAME);
  console.log('[TEST] ========================================');
  
  const testEmail = 'kishor.merchant06@gmail.com';
  const testSubject = '🧪 Direct Email Test from Kishor Tracker';
  const testContent = `
<h2>Email Configuration Test</h2>
<p>This is a direct test email from your Kishor Email Tracker.</p>
<p><strong>If you received this, email sending is WORKING!</strong></p>
<p style="color: #888; font-size: 12px;">
  Sent at: ${new Date().toISOString()}<br>
  From: ${BREVO_SENDER_EMAIL}<br>
  To: ${testEmail}
</p>
`;

  console.log('[TEST] Attempting to send test email...');
  const result = await sendEmailViaBrevo(testEmail, testSubject, testContent);
  
  console.log('[TEST] Result:', result ? 'SUCCESS ✅' : 'FAILED ❌');
  console.log('[TEST] ========================================');

  res.json({
    success: result,
    message: result 
      ? '✅ Test email sent! Check your inbox for: kishor.merchant06@gmail.com'
      : '❌ Email send failed. Check Render logs above for error details.',
    details: {
      recipient: testEmail,
      sender: BREVO_SENDER_EMAIL,
      timestamp: new Date().toISOString()
    }
  });
});

// =====================================================
// API ENDPOINTS
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
// SEND SENDER REMINDER EMAIL
// =====================================================

async function sendSenderReminder() {
  try {
    console.log('[Reminder] Sending reminders to email senders...');

    const { data: unrepliedEmails, error } = await supabase
      .from('emails')
      .select('sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error || !unrepliedEmails || unrepliedEmails.length === 0) {
      console.log('[Reminder] No unreplied emails to remind about');
      return;
    }

    const emailsBySender = {};
    for (const email of unrepliedEmails) {
      if (!emailsBySender[email.sender_email]) {
        emailsBySender[email.sender_email] = [];
      }
      emailsBySender[email.sender_email].push(email);
    }

    for (const [senderEmail, emails] of Object.entries(emailsBySender)) {
      try {
        const senderName = emails[0].sender_name || senderEmail.split('@')[0];
        const oldestEmail = emails.reduce((oldest, current) => {
          return new Date(current.received_at) < new Date(oldest.received_at) ? current : oldest;
        });

        const waitingTime = Math.floor((Date.now() - new Date(oldestEmail.received_at).getTime()) / (60 * 60 * 1000));

        let emailContent = `
<h2>📧 We're Waiting for Your Response</h2>
<p>Hi ${senderName},</p>
<p>We noticed that your email(s) to us have not been replied to. Here's a summary:</p>
<ul>`;

        for (const email of emails) {
          emailContent += `<li><strong>${email.subject}</strong> (sent ${Math.floor((Date.now() - new Date(email.received_at).getTime()) / (60 * 1000))} minutes ago)</li>`;
        }

        emailContent += `</ul>
<p>We're committed to excellent customer service and would love to hear from you.</p>
<p>Please reply to any of your previous emails or reach out if you need further assistance.</p>
<p>Best regards,<br/>Kishor Exports Team</p>
`;

        const reminderSent = await sendEmailViaBrevo(
          senderEmail,
          `⏰ Reminder: We're Waiting for Your Response`,
          emailContent
        );

        if (reminderSent) {
          console.log(`[Reminder] ✅ Reminder sent to ${senderEmail} for ${emails.length} email(s)`);
        } else {
          console.error(`[Reminder] ❌ Failed to send reminder to ${senderEmail}`);
        }
      } catch (emailError) {
        console.error(`[Reminder] Error sending to ${senderEmail}:`, emailError.message);
      }
    }
  } catch (error) {
    console.error('[Reminder] Error:', error.message);
  }
}

// =====================================================
// HTML TO PLAIN TEXT HELPER
// =====================================================

function htmlToPlainText(html) {
  if (!html) return '';
  
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|blockquote|table)>/gi, '\n');
  text = text.replace(/<tr>/gi, '\n');
  text = text.replace(/<td>/gi, '  ');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/\n\s*\n/g, '\n');
  text = text.trim();
  
  return text;
}

// =====================================================
// API ENDPOINTS - PATCH
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
// TEST ENDPOINTS
// =====================================================

app.get('/api/test/send-email-test', async (req, res) => {
  try {
    console.log('[TEST] Testing email send...');
    const result = await sendEmailViaBrevo(
      'kishor.merchant06@gmail.com',
      '✅ Test Email from Kishor Tracker',
      '<h2>Test Email</h2><p>If you received this, email sending works!</p>'
    );
    res.json({ 
      success: result, 
      message: result ? '✅ Test email sent!' : '❌ Test email failed'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test/send-user-reminder', async (req, res) => {
  try {
    console.log('[TEST] Testing user reminder...');
    const sent = await sendReminderToUser();
    res.json({ 
      success: sent, 
      message: sent ? '✅ Reminder sent!' : '❌ Reminder failed'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test/check-user-reply-alert-manager', async (req, res) => {
  try {
    console.log('[TEST] Testing manager alert...');
    const sent = await checkUserReplyAndAlertManager();
    res.json({ 
      success: sent, 
      message: sent ? '✅ Manager alert sent!' : '❌ Manager alert failed'
    });
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
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Tracker] Tracking ${TRACKED.size} senders`);
  console.log(`[Cron] Email fetch: Every 5 minutes`);
  console.log(`[Cron] Reply check: Every 5 minutes`);
  console.log(`[Cron] User reminder: Every hour`);
  console.log(`[Cron] Manager alert: Daily at 3:30 AM`);
  console.log(`[Email] Sender: ${BREVO_SENDER_EMAIL}`);
  console.log('✅ Server started!');
});
