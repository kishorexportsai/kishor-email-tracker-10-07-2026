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
// EMAIL SETUP - BREVO API
// =====================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_URL = 'api.resend.com';

// Send email using Resend API (using HTTPS)
async function sendEmailViaResend(to, subject, htmlContent) {
  return new Promise((resolve) => {
    try {
      if (!RESEND_API_KEY) {
        console.error('[Email] RESEND_API_KEY not set');
        resolve(false);
        return;
      }

      const emailData = JSON.stringify({
        from: 'Kishor Exports <noreply@kishorexports.com>',
        to: to,
        subject: subject,
        html: htmlContent
      });

      const options = {
        hostname: RESEND_API_URL,
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
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
          if (res.statusCode === 200) {
            console.log(`[Email] ✅ Email sent to ${to} via Resend`);
            resolve(true);
          } else {
            console.error(`[Email] ❌ Resend error (${res.statusCode}):`, data);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[Email] ❌ Request error:`, error.message);
        resolve(false);
      });

      req.write(emailData);
      req.end();
    } catch (error) {
      console.error(`[Email] ❌ Error:`, error.message);
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
// TRACKED SENDERS - EXTERNAL ONLY
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
// INTERNAL EMAILS TO EXCLUDE (DO NOT TRACK)
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
// SEND REMINDER TO USER (kishor.merchant06@gmail.com)
// =====================================================

async function sendReminderToUser() {
  try {
    console.log('[UserReminder] Sending reminder to user about unreplied emails...');

    const { data: unrepliedEmails, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error || !unrepliedEmails || unrepliedEmails.length === 0) {
      console.log('[UserReminder] No unreplied emails in last 24 hours');
      return;
    }

    console.log(`[UserReminder] Found ${unrepliedEmails.length} unreplied emails`);

    let emailContent = `
<h2>📧 Please Reply to These Emails</h2>
<p>Hi Kishor,</p>
<p>You have <strong>${unrepliedEmails.length} unreplied emails</strong> waiting for responses from important clients.</p>
<p>Please reply to them as soon as possible:</p>
<ul>`;

    for (const email of unrepliedEmails) {
      const timeAgo = Math.floor((Date.now() - new Date(email.received_at).getTime()) / (60 * 1000));
      emailContent += `
<li>
  <strong>From:</strong> ${email.sender_name} (${email.sender_email})<br/>
  <strong>Subject:</strong> ${email.subject}<br/>
  <strong>Waiting for:</strong> ${timeAgo} minutes
</li>`;
    }

    emailContent += `</ul>
<p><strong>Action Required:</strong> Please reply to these emails as soon as possible.</p>
<p>Best regards,<br/>Email Tracker System</p>
`;

    const userSent = await sendEmailViaResend(
      'kishor.merchant06@gmail.com',
      `⚠️ Please Reply: ${unrepliedEmails.length} Unreplied Emails`,
      emailContent
    );

    if (userSent) {
      console.log(`[UserReminder] ✅ Reminder sent to user about ${unrepliedEmails.length} unreplied emails`);
      
      try {
        await supabase.from('reminder_logs').insert({
          reminder_type: 'user_reminder',
          sent_at: new Date().toISOString(),
          recipients: 'kishor.merchant06@gmail.com',
          email_count: unrepliedEmails.length
        });
      } catch (logError) {
        console.error('[UserReminder] Could not log email send:', logError.message);
      }
    } else {
      console.error('[UserReminder] Failed to send reminder to user');
    }
  } catch (error) {
    console.error('[UserReminder] Error:', error.message);
  }
}

// =====================================================
// CHECK IF USER REPLIED - THEN ALERT MANAGER
// =====================================================

async function checkUserReplyAndAlertManager() {
  try {
    console.log('[ManagerAlert] Checking if user replied to emails...');

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stillUnrepliedEmails, error } = await supabase
      .from('emails')
      .select('id, sender_email, sender_name, subject, received_at')
      .eq('status', 'unreplied')
      .lt('received_at', oneDayAgo);

    if (error || !stillUnrepliedEmails || stillUnrepliedEmails.length === 0) {
      console.log('[ManagerAlert] All emails have been replied! No alert needed.');
      return;
    }

    console.log(`[ManagerAlert] Found ${stillUnrepliedEmails.length} emails still unreplied after 24 hours`);

    let emailContent = `
<h2>🚨 URGENT: User Did Not Reply to Emails</h2>
<p>Hi Manager,</p>
<p>User (kishor.merchant06@gmail.com) was reminded about unreplied emails <strong>24 hours ago</strong>, but still has NOT replied to the following emails:</p>
<ul>`;

    for (const email of stillUnrepliedEmails) {
      const hoursWaiting = Math.floor((Date.now() - new Date(email.received_at).getTime()) / (60 * 60 * 1000));
      emailContent += `
<li>
  <strong>From:</strong> ${email.sender_name} (${email.sender_email})<br/>
  <strong>Subject:</strong> ${email.subject}<br/>
  <strong>Waiting for:</strong> ${hoursWaiting} hours
</li>`;
    }

    emailContent += `</ul>
<p><strong>Status:</strong> User was sent a reminder but has NOT replied yet.</p>
<p><strong>Action Required:</strong> Please follow up with the user immediately.</p>
<p>Best regards,<br/>Email Tracker System</p>
`;

    const managerSent = await sendEmailViaResend(
      'marketing.kishorexports1@gmail.com',
      `🚨 URGENT: User Did Not Reply - ${stillUnrepliedEmails.length} Unreplied Emails`,
      emailContent
    );

    if (managerSent) {
      console.log(`[ManagerAlert] ✅ Alert sent to manager about ${stillUnrepliedEmails.length} unreplied emails after 24 hours`);
      
      try {
        await supabase.from('reminder_logs').insert({
          reminder_type: 'manager_alert_24h',
          sent_at: new Date().toISOString(),
          recipients: 'marketing.kishorexports1@gmail.com',
          email_count: stillUnrepliedEmails.length
        });
      } catch (logError) {
        console.error('[ManagerAlert] Could not log email send:', logError.message);
      }
    } else {
      console.error('[ManagerAlert] Failed to send alert to manager');
    }
  } catch (error) {
    console.error('[ManagerAlert] Error:', error.message);
  }
}

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

    // Group by sender email
    const emailsBySender = {};
    for (const email of unrepliedEmails) {
      if (!emailsBySender[email.sender_email]) {
        emailsBySender[email.sender_email] = [];
      }
      emailsBySender[email.sender_email].push(email);
    }

    // Send reminder to each sender
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

        // Send email to sender via Brevo
        const reminderSent = await sendEmailViaResend(
          senderEmail,
          `⏰ Reminder: We're Waiting for Your Response`,
          emailContent
        );

        if (reminderSent) {
          console.log(`[Reminder] ✅ Reminder sent to ${senderEmail} for ${emails.length} email(s)`);
        } else {
          console.error(`[Reminder] Failed to send reminder to ${senderEmail}`);
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
// CHECK FOR REPLIES
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
    console.log(`[Gmail] Checking ${unrepliedEmails.length} unreplied emails`);

    let updated = 0;

    for (const emailRecord of unrepliedEmails) {
      if (!emailRecord.thread_id) {
        continue;
      }

      try {
        const { data: thread } = await gmail.users.threads.get({
          userId: 'me',
          id: emailRecord.thread_id,
          format: 'metadata'
        });

        if (!thread) {
          continue;
        }

        const messages = thread.messages || [];
        const receivedTime = new Date(emailRecord.received_at).getTime();

        console.log(`[Gmail] 🔍 CHECKING: "${emailRecord.subject}"`);
        console.log(`        From: ${emailRecord.sender_email}`);

        let foundReply = false;

        for (const message of messages) {
          const labels = message.labelIds || [];
          const isSentEmail = labels.includes('SENT');
          const messageTime = Number(message.internalDate || 0);

          if (isSentEmail && messageTime > receivedTime) {
            console.log(`        ✅ REPLY DETECTED at ${new Date(messageTime).toISOString()}`);
            foundReply = true;
            break;
          }
        }

        if (!foundReply) {
          console.log(`        ❌ NO REPLY found`);
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
          console.error(`[Supabase] Failed to update email:`, updateError.message);
          continue;
        }

        updated++;
        console.log(`        ✅ DATABASE UPDATED`);
      } catch (threadError) {
        console.error(`[Gmail] Error checking thread:`, threadError.message);
      }
    }

    console.log(`[Gmail] Updated: ${updated} emails marked as replied`);
    console.log(`[Gmail] ========================================`);
  } catch (error) {
    console.error(`[Gmail] Reply check error:`, error.message);
  }
}

// =====================================================
// FETCH ALL EMAILS
// =====================================================

async function fetchAllEmails(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const tokens = await getToken(normalizedEmail);

  if (!tokens) {
    console.log(`[Gmail] No token found for ${normalizedEmail}`);
    return 0;
  }

  const client = createOAuthClient(tokens, normalizedEmail);
  const gmail = google.gmail({ version: 'v1', auth: client });

  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const afterDate = fiveDaysAgo.toISOString().split('T')[0];

    const senderQuery = Array.from(TRACKED)
      .map(sender => `from:${sender}`)
      .join(' OR ');

    const query = `in:inbox after:${afterDate} (${senderQuery})`;

    console.log(`[Gmail] Fetching emails for ${normalizedEmail} from ${afterDate}`);

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

        // Skip if not a tracked sender
        if (!TRACKED.has(senderEmail)) continue;

        // Skip if internal Kishor Exports email
        if (INTERNAL_DOMAINS.has(senderEmail)) {
          console.log(`[Gmail] Skipped internal email from ${senderEmail}`);
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

        if (!insertError) {
          saved++;
        }
      } catch (messageError) {
        // Continue processing
      }
    }

    console.log(`[Gmail] Saved: ${saved} emails`);
    return saved;
  } catch (error) {
    console.error(`[Gmail] Fetch error:`, error.message);
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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    if (!code) return res.status(400).send('No authorization code provided');

    const { tokens } = await oauth2Client.getToken(code);
    await saveToken(account, tokens);

    console.log(`[OAuth] Successfully authenticated ${account}`);
    res.redirect(`/?google_login=success&email=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state: account } = req.query;
    if (!code) return res.status(400).send('No authorization code provided');

    const { tokens } = await oauth2Client.getToken(code);
    await saveToken(account, tokens);

    console.log(`[OAuth] Successfully authenticated ${account}`);
    res.redirect(`/?google_login=success&email=${encodeURIComponent(account)}`);
  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// =====================================================
// API ENDPOINTS
// =====================================================

app.get('/api/stats', async (req, res) => {
  try {
    const { data: emails, error } = await supabase
      .from('emails')
      .select('status, received_at');

    if (error) throw error;

    const records = emails || [];
    const today = new Date().toISOString().split('T')[0];

    const total = records.length;
    const unreplied = records.filter(e => e.status === 'unreplied').length;
    const replied = records.filter(e => e.status === 'replied').length;
    const todayCount = records.filter(e => e.received_at.startsWith(today)).length;

    res.json({ total, unreplied, replied, today: todayCount });
  } catch (error) {
    console.error('[API] Error loading stats:', error.message);
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
    console.error('[API] Error fetching emails:', error.message);
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
    console.error('[API] Error fetching unreplied emails:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to convert HTML to plain text
function htmlToPlainText(html) {
  if (!html) return '';
  
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // Replace common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&#39;/g, "'");
  
  // Replace <br> and <br/> with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|blockquote|table)>/gi, '\n');
  text = text.replace(/<tr>/gi, '\n');
  text = text.replace(/<td>/gi, '  ');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  const textarea = require('util').TextEncoder ? null : null;
  const div = { innerHTML: text };
  text = div.textContent || div.innerText || text;
  
  // Clean up extra whitespace
  text = text.replace(/\n\s*\n/g, '\n');
  text = text.trim();
  
  return text;
}

app.get('/api/emails/:emailId/body', async (req, res) => {
  try {
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('email_id', req.params.emailId)
      .maybeSingle();

    if (emailError || !email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const tokens = await getToken(email.account);
    if (!tokens) {
      return res.status(401).json({ error: 'No Gmail token' });
    }

    const client = createOAuthClient(tokens, email.account);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const { data: fullMessage } = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.emailId,
      format: 'full'
    });

    const payload = fullMessage.payload || {};
    let body = '';

    function findMessagePart(parts, targetMimeType) {
      for (const part of parts || []) {
        if (part.mimeType === targetMimeType && part.body?.data) {
          return part;
        }
        if (part.parts?.length) {
          const nestedPart = findMessagePart(part.parts, targetMimeType);
          if (nestedPart) return nestedPart;
        }
      }
      return null;
    }

    // PRIORITY: Try to get plain text first, then HTML
    if (payload.parts?.length) {
      const textPart = findMessagePart(payload.parts, 'text/plain');
      const htmlPart = findMessagePart(payload.parts, 'text/html');

      if (textPart) {
        // Prefer plain text
        body = Buffer.from(textPart.body.data, 'base64url').toString('utf8');
      } else if (htmlPart) {
        // If no plain text, convert HTML to text
        const rawHtml = Buffer.from(htmlPart.body.data, 'base64url').toString('utf8');
        body = htmlToPlainText(rawHtml);
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }

    res.json({ body: body || 'No content available' });
  } catch (error) {
    console.error('[API] Error loading email body:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/emails/:emailId/status', async (req, res) => {
  try {
    const emailId = req.params.emailId;
    const { status } = req.body;

    console.log(`[API] Updating email ${emailId} to status: ${status}`);

    if (!emailId) {
      return res.status(400).json({ error: 'Email ID is required' });
    }

    if (!['unreplied', 'replied', 'no_reply_needed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Update by primary key 'id'
    const { error } = await supabase
      .from('emails')
      .update({
        status,
        updated_at: new Date().toISOString(),
        replied_at: status === 'replied' ? new Date().toISOString() : null
      })
      .eq('id', emailId);

    if (error) {
      console.error('[API] Supabase error:', error.message);
      throw error;
    }

    console.log(`[API] ✅ Email ${emailId} updated to status: ${status}`);
    res.json({ success: true, status });
  } catch (error) {
    console.error('[API] Error updating status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// CRON JOBS
// =====================================================

// Fetch emails every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log('[Cron] Starting 5-minute email fetch');
    const { data: users, error } = await supabase
      .from('users')
      .select('account_email')
      .not('gmail_token', 'is', null);

    if (!error && users) {
      for (const user of users) {
        await fetchAllEmails(user.account_email);
      }
    }
  } catch (error) {
    console.error('[Cron] Fetch failed:', error.message);
  }
});

// Check replies every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log('[Cron] Starting 5-minute reply check');
    const { data: users, error } = await supabase
      .from('users')
      .select('account_email')
      .not('gmail_token', 'is', null);

    if (!error && users) {
      for (const user of users) {
        await checkForReplies(user.account_email);
      }
    }
  } catch (error) {
    console.error('[Cron] Reply check failed:', error.message);
  }
});

// Send reminder to user every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('[Cron] Sending hourly reminder to user (kishor.merchant06@gmail.com)');
    await sendReminderToUser();
  } catch (error) {
    console.error('[Cron] User reminder failed:', error.message);
  }
});

// Check if user replied, if not alert manager (every 24 hours at 3:30 AM)
cron.schedule('30 3 * * *', async () => {
  try {
    console.log('[Cron] Checking if user replied, if not alerting manager');
    await checkUserReplyAndAlertManager();
  } catch (error) {
    console.error('[Cron] Manager alert check failed:', error.message);
  }
});

// =====================================================
// TEST ENDPOINTS - FOR TESTING EMAIL FUNCTIONALITY
// =====================================================

app.get('/api/test/send-user-reminder', async (req, res) => {
  try {
    console.log('[TEST] Testing reminder email to user...');
    await sendReminderToUser();
    res.json({ success: true, message: '✅ Reminder email sent to kishor.merchant06@gmail.com' });
  } catch (error) {
    console.error('[TEST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test/check-user-reply-alert-manager', async (req, res) => {
  try {
    console.log('[TEST] Testing check user reply and alert manager...');
    await checkUserReplyAndAlertManager();
    res.json({ success: true, message: '✅ Manager alert check completed' });
  } catch (error) {
    console.error('[TEST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get email sending history
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Tracker] Tracking ${TRACKED.size} approved senders`);
  console.log(`[Cron] Email fetch: Every 5 minutes`);
  console.log(`[Cron] Reply check: Every 5 minutes`);
  console.log(`[Cron] Manager notifications: Every hour`);
  console.log(`[Cron] Sender reminders: Every 6 hours`);
  console.log(`[Email] Manager email: marketing.kishorexports1@gmail.com`);
});
