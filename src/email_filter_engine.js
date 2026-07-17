/**
 * Email Tracker - Automated Email Filter
 * Filters out auto-replies and system emails to show only genuine buyer responses
 */

class EmailFilter {
  constructor() {
    // Define filter patterns
    this.filters = {
      autoReply: {
        name: "Auto-reply",
        keywords: [
          "autoreply", "auto reply", "automatic reply", "automated reply",
          "auto-response", "autoresponder", "vacation responder",
          "out of office", "out-of-office", "ooo", "away from office",
          "currently away", "currently unavailable", "on leave",
          "annual leave", "holiday", "vacation", "sick leave",
          "parental leave", "business trip", "traveling", "travelling"
        ]
      },
      delivery: {
        name: "Delivery notification",
        keywords: [
          "mailer-daemon", "mail daemon", "postmaster", "no-reply",
          "noreply", "do-not-reply", "donotreply", "bounce",
          "delivery failure", "delivery status notification", "dsn",
          "returned mail", "undeliverable", "message blocked",
          "message rejected", "recipient not found", "mailbox unavailable",
          "spam notification", "quarantine", "email security",
          "proofpoint", "mimecast", "barracuda", "messagelabs"
        ]
      },
      acknowledgement: {
        name: "Automatic acknowledgement",
        keywords: [
          "thank you for your email", "thank you for contacting",
          "thanks for your email", "we have received your email",
          "your message has been received", "your request has been received",
          "case created", "ticket created", "support ticket",
          "reference number", "case number", "request id",
          "tracking id", "incident id", "customer support",
          "helpdesk", "service desk", "zendesk", "freshdesk",
          "jira service management", "servicenow"
        ]
      },
      marketing: {
        name: "Marketing/Newsletter",
        keywords: [
          "newsletter", "unsubscribe", "manage preferences",
          "view in browser", "marketing email", "promotional",
          "campaign", "mailchimp", "constant contact", "hubspot",
          "brevo", "sendgrid", "mailerlite", "activecampaign", "klaviyo"
        ]
      },
      calendar: {
        name: "Calendar notification",
        keywords: [
          "meeting invitation", "calendar invitation", "accepted",
          "declined", "tentative", "google calendar",
          "microsoft teams", "zoom", "outlook calendar",
          "event updated", "event cancelled"
        ]
      },
      security: {
        name: "Security alert",
        keywords: [
          "verification code", "one time password", "otp",
          "login alert", "security alert", "password reset",
          "account verification", "two-factor authentication", "2fa"
        ]
      },
      systemSender: {
        name: "System sender",
        patterns: [
          /no-reply@/i, /noreply@/i, /donotreply@/i,
          /mailer-daemon@/i, /postmaster@/i, /notifications?@/i,
          /support@/i, /help@/i, /helpdesk@/i, /system@/i,
          /alerts?@/i, /security@/i, /admin@/i,
          /automailer@/i, /mailer@/i, /bounce@/i
        ]
      }
    };
  }

  /**
   * Check if email is automated/system-generated
   * @param {Object} email - Email object with from, subject, body properties
   * @returns {Object} { isAutomated: boolean, filterType: string, reason: string }
   */
  classifyEmail(email) {
    const emailText = `${email.from || ''} ${email.subject || ''} ${email.body || ''}`.toLowerCase();
    const fromAddress = (email.from || '').toLowerCase();

    // Check system sender patterns first (fast check)
    for (let pattern of this.filters.systemSender.patterns) {
      if (pattern.test(fromAddress)) {
        return {
          isAutomated: true,
          filterType: 'systemSender',
          reason: this.filters.systemSender.name
        };
      }
    }

    // Check keyword-based filters
    for (let [filterKey, filterConfig] of Object.entries(this.filters)) {
      if (filterKey === 'systemSender') continue;

      if (filterConfig.keywords) {
        for (let keyword of filterConfig.keywords) {
          if (emailText.includes(keyword.toLowerCase())) {
            return {
              isAutomated: true,
              filterType: filterKey,
              reason: filterConfig.name
            };
          }
        }
      }
    }

    // Email appears to be genuine
    return {
      isAutomated: false,
      filterType: null,
      reason: null
    };
  }

  /**
   * Check if email contains genuine business content indicators
   * @param {Object} email - Email object
   * @returns {Object} { isGenuine: boolean, indicators: array }
   */
  findBusinessIndicators(email) {
    const emailText = (email.subject + ' ' + (email.body || '')).toLowerCase();

    const indicators = [
      { keyword: 'product inquiry', category: 'Product' },
      { keyword: 'price request', category: 'Price' },
      { keyword: 'moq', category: 'MOQ' },
      { keyword: 'sample', category: 'Sample' },
      { keyword: 'meeting request', category: 'Meeting' },
      { keyword: 'negotiat', category: 'Negotiation' },
      { keyword: 'follow-up', category: 'Follow-up' },
      { keyword: 'follow up', category: 'Follow-up' },
      { keyword: 'interest', category: 'Interest' },
      { keyword: 'collaboration', category: 'Collaboration' },
      { keyword: 'technical question', category: 'Technical' },
      { keyword: 'shipping', category: 'Shipping' },
      { keyword: 'production', category: 'Production' },
      { keyword: 'order', category: 'Order' },
      { keyword: 'inquiry', category: 'Inquiry' }
    ];

    const found = [];
    for (let indicator of indicators) {
      if (emailText.includes(indicator.keyword)) {
        found.push(indicator.category);
      }
    }

    return {
      isGenuine: found.length > 0,
      indicators: [...new Set(found)]
    };
  }

  /**
   * Validate if email should be tracked as a real reply
   * @param {Object} email - Email object
   * @returns {Object} { shouldTrack: boolean, classification: object, score: number }
   */
  validateReply(email) {
    const classification = this.classifyEmail(email);

    if (classification.isAutomated) {
      return {
        shouldTrack: false,
        classification: classification,
        score: 0,
        reason: `Filtered: ${classification.reason}`
      };
    }

    const businessCheck = this.findBusinessIndicators(email);

    return {
      shouldTrack: businessCheck.isGenuine,
      classification: classification,
      businessIndicators: businessCheck.indicators,
      score: businessCheck.isGenuine ? 1 : 0.5,
      reason: businessCheck.isGenuine
        ? `Genuine reply - ${businessCheck.indicators.join(', ')}`
        : 'No business indicators detected - manual review needed'
    };
  }

  /**
   * Filter email list and return categorized results
   * @param {Array} emails - Array of email objects
   * @returns {Object} { realReplies: array, filtered: array, metrics: object }
   */
  processEmails(emails) {
    const realReplies = [];
    const filtered = [];
    const filterStats = {};

    emails.forEach(email => {
      const validation = this.validateReply(email);

      if (validation.shouldTrack) {
        realReplies.push({
          ...email,
          validated: true,
          indicators: validation.businessIndicators
        });
      } else {
        filtered.push({
          ...email,
          reason: validation.reason,
          filterType: validation.classification.filterType
        });

        const filterType = validation.classification.filterType || 'unknown';
        filterStats[filterType] = (filterStats[filterType] || 0) + 1;
      }
    });

    return {
      realReplies,
      filtered,
      metrics: {
        totalEmails: emails.length,
        realReplies: realReplies.length,
        filtered: filtered.length,
        filterRate: emails.length > 0 ? ((filtered.length / emails.length) * 100).toFixed(1) : 0,
        filterBreakdown: filterStats
      }
    };
  }

  /**
   * Get configuration for integration/settings
   * @returns {Object} Filter configuration
   */
  getConfiguration() {
    return {
      version: '1.0',
      autoReplyKeywords: this.filters.autoReply.keywords,
      deliveryKeywords: this.filters.delivery.keywords,
      acknowledgementKeywords: this.filters.acknowledgement.keywords,
      marketingKeywords: this.filters.marketing.keywords,
      calendarKeywords: this.filters.calendar.keywords,
      securityKeywords: this.filters.security.keywords,
      systemSenderPatterns: this.filters.systemSender.patterns.map(p => p.source)
    };
  }
}

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmailFilter;
}
