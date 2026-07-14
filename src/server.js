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
// FETCH EMAILS
// ONLY FROM 15 TRACKED SENDERS
// ONLY FROM LAST 5 DAYS
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
            body_preview: fullMessage.snippet || '',
            email_link: `https://mail.google.com/mail/u/0/#inbox/${message.id}`
          });

        if (insertError) {
          console.error(
            `[Supabase] Failed to save email ${message.id}:`,
            insertError.message
          );
          continue;
        }

        saved++;
        console.log(`[Gmail] Saved email from ${senderEmail}`);
      } catch (messageError) {
        console.error(
          `[Gmail] Failed processing message ${message.id}:`,
          messageError.message
        );
      }
    }

    console.log(
      `[Gmail] Account ${normalizedEmail} — Saved: ${saved}, Skipped: ${skipped}`
    );

    return saved;
  } catch (error) {
    console.error(
      `[Gmail] Fetch error for ${normalizedEmail}:`,
      error.message
    );

    return 0;
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
      .select('id, thread_id, received_at, account')
      .eq('status', 'unreplied')
      .eq('account', normalizedEmail);

    if (fetchError) {
      throw fetchError;
    }

    if (!unrepliedEmails?.length) {
      console.log(`[Gmail] No unreplied emails for ${normalizedEmail}`);
      return;
    }

    console.log(
      `[Gmail] Checking ${unrepliedEmails.length} unreplied emails for ${normalizedEmail}`
    );

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

        const messages = thread.messages || [];
        const receivedTime = new Date(emailRecord.received_at).getTime();

        const hasReply = messages.some(message => {
          const labels = message.labelIds || [];
          const isSentEmail = labels.includes('SENT');
          const messageTime = Number(message.internalDate || 0);

          return isSentEmail && messageTime > receivedTime;
        });

        if (!hasReply) {
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
          console.error(
            `[Supabase] Failed to update reply status:`,
            updateError.message
          );
          continue;
        }

        updated++;
        console.log(`[Gmail] Email marked as replied`);
      } catch (threadError) {
        console.error(
          `[Gmail] Failed checking thread ${emailRecord.thread_id}:`,
          threadError.message
        );
      }
    }

    console.log(
      `[Gmail] Reply check completed for ${normalizedEmail}. Updated: ${updated}`
    );
  } catch (error) {
    console.error(
      `[Gmail] Reply check error for ${normalizedEmail}:`,
      error.message
    );
  }
}

// =====================================================
// GOOGLE AUTH ROUTES
// =====================================================

app.get('/auth/google', (req, res) => {
  try {
    const accountEmail = String(
      req.query.email || getDefaultGmailAccount()
    )
      .trim()
      .toLowerCase();

    if (!accountEmail) {
      return res.status(400).send(`
        <h2>Gmail account missing</h2>
        <p>Add GMAIL_ACCOUNTS in Render.</p>
        <p>Or open:</p>
        <code>/auth/google?email=your@gmail.com</code>
      `);
    }

    const state = Buffer.from(accountEmail).toString('base64url');

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state
    });

    return res.redirect(authorizationUrl);
  } catch (error) {
    console.error(
      '[OAuth] Failed to create Google authorization URL:',
      error
    );

    return res
      .status(500)
      .send(`Could not start Google authentication: ${error.message}`);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');

    if (!code) {
      return res.status(400).send('Google authorization code is missing.');
    }

    if (!state) {
      return res.status(400).send('OAuth account state is missing.');
    }

    let accountEmail;

    try {
      accountEmail = Buffer.from(state, 'base64url')
        .toString('utf8')
        .trim()
        .toLowerCase();
    } catch (error) {
      return res.status(400).send('Invalid OAuth account state.');
    }

    if (!accountEmail) {
      return res.status(400).send('Gmail account email could not be determined.');
    }

    const { tokens } = await oauth2Client.getToken(code);

    await saveToken(accountEmail, tokens);

    oauth2Client.setCredentials(tokens);

    console.log(`[OAuth] Gmail successfully connected: ${accountEmail}`);

    // Redirect to dashboard with success
    const redirectUrl = `/?google_login=success&email=${encodeURIComponent(accountEmail)}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('[OAuth] Google callback failed:', error);

    return res.status(500).send(`
      <h2>Google authentication failed</h2>
      <p>${error.message}</p>
    `);
  }
});

// =====================================================
// LOGIN & AUTH API
// =====================================================

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Simple hardcoded auth for admin
    if (email === 'admin@kishorexports.com' && password === 'Kishor@123') {
      const token = 'admin-token-' + Date.now();
      const user = {
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@kishorexports.com',
        account_email: 'kishor.merchant06@gmail.com',
        role: 'senior_manager'
      };
      
      return res.json({ token, user });
    }
    
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    
    // Return default user
    res.json({
      id: 'admin-1',
      name: 'Admin',
      email: 'admin@kishorexports.com',
      account_email: 'kishor.merchant06@gmail.com',
      role: 'senior_manager'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/gmail/status', async (req, res) => {
  try {
    const email = req.query.email || '';
    const { data: user, error } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .eq('account_email', email)
      .maybeSingle();
    
    if (error || !user) {
      return res.json({ connected: false });
    }
    
    res.json({
      connected: !!user.gmail_token,
      account: email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// MAIN ROUTES
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Email Tracker Running',
    trackedSenders: TRACKED.size,
    emailHistoryDays: 5
  });
});

// =====================================================
// EMAIL API
// =====================================================

app.get('/api/emails', async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      500
    );

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const status = req.query.status;
    const account = req.query.account;

    let query = supabase
      .from('emails')
      .select('*', {
        count: 'exact'
      })
      .order('received_at', {
        ascending: false
      });

    if (status) {
      query = query.eq('status', status);
    }

    if (account) {
      query = query.eq('account', account);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    return res.json({
      emails: data || [],
      total: count || 0,
      limit,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('[API] Failed to load emails:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/emails/unreplied', async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      500
    );

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const account = req.query.account;

    let query = supabase
      .from('emails')
      .select('*', {
        count: 'exact'
      })
      .eq('status', 'unreplied')
      .order('received_at', {
        ascending: false
      });

    if (account) {
      query = query.eq('account', account);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    return res.json({
      emails: data || [],
      total: count || 0,
      limit,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('[API] Failed to load unreplied emails:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/emails/internal', async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      500
    );

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .or('sender_email.ilike.%@kishorexports.com,sender_email.ilike.%@kishor.ai')
      .order('received_at', { ascending: false });

    if (req.query.account) query = query.eq('account', req.query.account);
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    return res.json({
      emails: data || [],
      total: count || 0,
      limit,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('[API] Failed to load internal emails:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/emails/:emailId/body', async (req, res) => {
  try {
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('email_id', req.params.emailId)
      .maybeSingle();

    if (emailError) {
      throw emailError;
    }

    if (!email) {
      return res.status(404).json({
        error: 'Email not found'
      });
    }

    const tokens = await getToken(email.account);

    if (!tokens) {
      return res.status(401).json({
        error: 'No Gmail token found for this account'
      });
    }

    const client = createOAuthClient(tokens, email.account);

    const gmail = google.gmail({
      version: 'v1',
      auth: client
    });

    const { data: fullMessage } = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.emailId,
      format: 'full'
    });

    const payload = fullMessage.payload || {};

    let body = '';
    let mimeType = 'text/plain';

    function findMessagePart(parts, targetMimeType) {
      for (const part of parts || []) {
        if (part.mimeType === targetMimeType && part.body?.data) {
          return part;
        }

        if (part.parts?.length) {
          const nestedPart = findMessagePart(
            part.parts,
            targetMimeType
          );

          if (nestedPart) {
            return nestedPart;
          }
        }
      }

      return null;
    }

    if (payload.parts?.length) {
      const htmlPart = findMessagePart(payload.parts, 'text/html');
      const textPart = findMessagePart(payload.parts, 'text/plain');

      if (htmlPart) {
        mimeType = 'text/html';

        body = Buffer.from(
          htmlPart.body.data,
          'base64url'
        ).toString('utf8');
      } else if (textPart) {
        body = Buffer.from(
          textPart.body.data,
          'base64url'
        ).toString('utf8');
      }
    } else if (payload.body?.data) {
      mimeType = payload.mimeType || 'text/plain';

      body = Buffer.from(
        payload.body.data,
        'base64url'
      ).toString('utf8');
    }

    return res.json({
      body,
      mimeType
    });
  } catch (error) {
    console.error('[API] Failed to load email body:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.patch('/api/emails/:emailId/status', async (req, res) => {
  try {
    const allowedStatuses = [
      'unreplied',
      'replied',
      'no_reply_needed'
    ];

    const status = String(req.body.status || '').trim();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid email status'
      });
    }

    const { error } = await supabase
      .from('emails')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('email_id', req.params.emailId);

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('[API] Failed to update email status:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

// =====================================================
// AGENTS AND DASHBOARD STATS
// =====================================================

app.get('/api/agents', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('account_email, name, role')
      .order('account_email', {
        ascending: true
      });

    if (error) {
      throw error;
    }

    return res.json(users || []);
  } catch (error) {
    console.error('[API] Failed to load agents:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { data: emails, error } = await supabase
      .from('emails')
      .select('status, received_at');

    if (error) {
      throw error;
    }

    const records = emails || [];
    const today = new Date().toISOString().split('T')[0];

    const total = records.length;
    const unreplied = records.filter(email => email.status === 'unreplied').length;
    const replied = records.filter(email => email.status === 'replied').length;
    const noReplyNeeded = records.filter(email => email.status === 'no_reply_needed').length;
    const todayCount = records.filter(email => email.received_at.startsWith(today)).length;
    const internal = records.filter(email => 
      email.sender_email?.includes('@kishorexports.com') || 
      email.sender_email?.includes('@kishor.ai')
    ).length;

    return res.json({
      total,
      unreplied,
      replied,
      noReplyNeeded,
      today: todayCount,
      internal
    });
  } catch (error) {
    console.error('[API] Failed to load statistics:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/report/weekly/:email', async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: emails, error } = await supabase
      .from('emails')
      .select('status, received_at, sender_email, sender_name, subject')
      .eq('account', req.params.email)
      .gte('received_at', sevenDaysAgo.toISOString());

    if (error) throw error;

    const daily = {};
    (emails || []).forEach(e => {
      const day = e.received_at.split('T')[0];
      if (!daily[day]) daily[day] = { received: 0, replied: 0 };
      daily[day].received++;
      if (e.status === 'replied') daily[day].replied++;
    });

    const unrepliedEmails = emails.filter(e => e.status === 'unreplied');

    return res.json({
      total: emails.length,
      replied: emails.filter(e => e.status === 'replied').length,
      unreplied: unrepliedEmails.length,
      daily,
      unrepliedEmails
    });
  } catch (error) {
    console.error('[API] Failed to load weekly report:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/report/monthly/:email', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: emails, error } = await supabase
      .from('emails')
      .select('status, received_at, sender_email, sender_name, subject')
      .eq('account', req.params.email)
      .gte('received_at', thirtyDaysAgo.toISOString());

    if (error) throw error;

    const weekly = {};
    (emails || []).forEach(e => {
      const d = new Date(e.received_at);
      const week = `Week ${Math.ceil(d.getDate() / 7)}`;
      if (!weekly[week]) weekly[week] = { received: 0, replied: 0 };
      weekly[week].received++;
      if (e.status === 'replied') weekly[week].replied++;
    });

    const unrepliedEmails = emails.filter(e => e.status === 'unreplied');

    return res.json({
      total: emails.length,
      replied: emails.filter(e => e.status === 'replied').length,
      unreplied: unrepliedEmails.length,
      weekly,
      unrepliedEmails
    });
  } catch (error) {
    console.error('[API] Failed to load monthly report:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// =====================================================
// ADMIN ROUTES
// =====================================================

app.get('/api/admin/users', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('account_email', { ascending: true });

    if (error) throw error;
    res.json(users || []);
  } catch (error) {
    console.error('[API] Failed to load admin users:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/users/:userId', async (req, res) => {
  try {
    const { role, is_active } = req.body;
    const updates = {};
    if (role) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Failed to update user:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/reminder-logs', async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('reminder_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(logs || []);
  } catch (error) {
    console.error('[API] Failed to load reminder logs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// DEBUG ENDPOINT - DIAGNOSE ISSUES
// =====================================================

app.get('/api/debug', async (req, res) => {
  try {
    const debug = {
      timestamp: new Date().toISOString(),
      server_status: 'running',
      tracked_senders: Array.from(TRACKED).length,
      issues: []
    };

    // Check Supabase connection
    const { data: usersWithTokens, error: usersError } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .not('gmail_token', 'is', null);

    if (usersError) {
      debug.issues.push(`Supabase error: ${usersError.message}`);
      return res.json(debug);
    }

    debug.users_with_tokens = usersWithTokens?.length || 0;

    // Check each user's Gmail token
    for (const user of usersWithTokens || []) {
      const tokens = await getToken(user.account_email);
      if (!tokens) {
        debug.issues.push(`❌ ${user.account_email}: Gmail token expired or invalid`);
      } else {
        debug.gmail_connected = user.account_email;
      }
    }

    // Check database stats
    const { count: emailCount, error: emailCountError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' });

    if (!emailCountError) {
      debug.emails_in_database = emailCount || 0;
    }

    const { count: unrepliedCount, error: unrepliedCountError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'unreplied');

    if (!unrepliedCountError) {
      debug.unreplied_emails = unrepliedCount || 0;
    }

    const { count: repliedCount, error: repliedCountError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'replied');

    if (!repliedCountError) {
      debug.replied_emails = repliedCount || 0;
    }

    return res.json(debug);
  } catch (error) {
    console.error('[DEBUG] Error:', error.message);
    return res.status(500).json({
      error: error.message,
      stack: error.stack
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
// DEBUG ENDPOINT - DIAGNOSE ISSUES
// =====================================================

app.get('/api/debug', async (req, res) => {
  try {
    const debug = {
      timestamp: new Date().toISOString(),
      server_status: 'running',
      tracked_senders: Array.from(TRACKED).length,
      issues: []
    };

    // Check Supabase connection
    const { data: testQuery, error: testError } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .limit(1);

    if (testError) {
      debug.issues.push(`Supabase connection failed: ${testError.message}`);
      return res.json(debug);
    }

    debug.supabase = 'connected';

    // Check users with Gmail tokens
    const { data: usersWithTokens, error: usersError } = await supabase
      .from('users')
      .select('account_email, gmail_token')
      .not('gmail_token', 'is', null);

    if (usersError) {
      debug.issues.push(`Failed to fetch users: ${usersError.message}`);
      return res.json(debug);
    }

    debug.users_with_tokens = usersWithTokens?.length || 0;

    // For each user, check Gmail token validity
    if (usersWithTokens && usersWithTokens.length > 0) {
      for (const user of usersWithTokens) {
        const tokens = await getToken(user.account_email);
        
        if (!tokens) {
          debug.issues.push(`❌ ${user.account_email}: Gmail token invalid or expired`);
        } else {
          debug.gmail_connected = user.account_email;
          
          // Try to fetch emails
          const client = createOAuthClient(tokens, user.account_email);
          const gmail = google.gmail({ version: 'v1', auth: client });
          
          try {
            const fiveDaysAgo = new Date();
            fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
            const afterDate = fiveDaysAgo.toISOString().split('T')[0];
            
            const senderQuery = Array.from(TRACKED)
              .map(sender => `from:${sender}`)
              .join(' OR ');
            
            const query = `in:inbox after:${afterDate} (${senderQuery})`;
            
            const { data: messageResult } = await gmail.users.messages.list({
              userId: 'me',
              q: query,
              maxResults: 100
            });
            
            const messageCount = messageResult?.messages?.length || 0;
            debug.emails_found_in_gmail = messageCount;
            
            if (messageCount === 0) {
              debug.issues.push(`⚠️  No emails from tracked senders in last 5 days`);
            }
          } catch (gmailError) {
            debug.issues.push(`❌ Gmail API error: ${gmailError.message}`);
          }
        }
      }
    } else {
      debug.issues.push('❌ No users with Gmail tokens in database');
    }

    // Check emails in database
    const { data: emailCount, error: emailError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' });

    if (!emailError) {
      debug.emails_in_database = emailCount?.length || 0;
    }

    // Check unreplied emails
    const { data: unrepliedCount, error: unrepliedError } = await supabase
      .from('emails')
      .select('id', { count: 'exact' })
      .eq('status', 'unreplied');

    if (!unrepliedError) {
      debug.unreplied_emails = unrepliedCount?.length || 0;
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
// CRON JOBS
// =====================================================

// Fetch emails every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log(
      '[Cron] Starting 5-minute Gmail fetch for tracked senders'
    );

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
});
