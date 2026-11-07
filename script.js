// ---------------------------------------------------------------------------
// Basic (rule-based) scanner. Used automatically when the AI model or the
// server proxy is unavailable, so the site always gives some kind of answer.
// It is simpler and less accurate than the AI check.
// ---------------------------------------------------------------------------
function basicScan(message) {
  const text = message.trim();
  const flags = [];
  let score = 0;
  const add = (points, label) => { score += points; flags.push(label); };

  const urlRe = /(https?:\/\/|www\.)[^\s]+/gi;
  const urls = text.match(urlRe) || [];
  const hasLink = urls.length > 0;

  // A normal-looking OTP message: has a code, says "do not share", and has no link.
  const looksLikeOtp =
    /\botp\b|one[- ]time (password|code)/i.test(text) &&
    /\b\d{4,8}\b/.test(text) &&
    /(do not|don't|never)\s+share/i.test(text) &&
    !hasLink;
  if (looksLikeOtp) {
    return {
      verdict: 'safe',
      scam_score: 5,
      confidence: 'medium',
      why: 'This reads like a standard OTP message that warns you not to share the code, and it contains no links.',
      red_flags: [],
      recommended_action: 'Use the code only if you started the action. Otherwise contact your bank using the number on your card.',
      basic: true
    };
  }

  // Urgency and threats
  if (/\b(urgent(ly)?|immediately|act now|right away|last warning|final notice|within \d+\s*(hours?|hrs?|mins?|minutes?)|today only|expires?\s+(today|soon)|will be (blocked|suspended|closed|deactivated|terminated)|blocked|suspended|deactivated|permanent(ly)?)\b/i.test(text)) {
    add(2, 'urgent threat or tight deadline');
  }

  // Requests for credentials, OTPs or KYC updates
  if (/\b(otp|pin|cvv|password|passcode|net ?banking|kyc|verify your|confirm your|update your (kyc|details|account|pan|aadhaar))\b/i.test(text)) {
    add(2, 'asks for sensitive details or an account update');
  }

  // Links
  if (hasLink) {
    const hosts = urls.map(u => u.replace(/^(https?:\/\/)?(www\.)?/i, '').split(/[\/?#]/)[0].toLowerCase());
    if (hosts.some(h => /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|ow\.ly|tiny\.cc|shorturl\.at)$/.test(h))) {
      add(2, 'shortened link hides the real destination');
    }
    if (hosts.some(h => /\.(xyz|top|click|live|icu|buzz|rest|gq|tk|ml|cf|ga|work|loan|monster|cyou|sbs)$/.test(h))) {
      add(2, 'link uses an unusual domain ending');
    }
    if (hosts.some(h => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(h))) {
      add(2, 'link points to a raw IP address');
    }
    if (hosts.some(h => /(verify|kyc|secure|login|update|account|bank|refund|claim)/.test(h) && /-/.test(h))) {
      add(2, 'link name imitates a bank or service');
    }
    if (flags.every(f => !/link/.test(f))) {
      add(1, 'contains a link');
    }
  }

  // Bait
  if (/\b(you (have )?won|winner|prize|lottery|reward points?|gift card|cashback|congratulations|claim (your|now))\b/i.test(text)) {
    add(2, 'prize or reward bait');
  }
  if (/\b(investment|crypto|bitcoin|guaranteed returns?|double your|work from home|part[- ]time job|earn (rs\.?|inr|\u20b9|\$)?\s*\d+)\b/i.test(text)) {
    add(2, 'investment or job offer that sounds too good to be true');
  }

  // Payment or fee requests
  if (/\b(pay|send|transfer|deposit)\b[^.]{0,40}\b(fee|charges?|amount|rs\.?|inr|\u20b9|\$)/i.test(text)) {
    add(2, 'asks for a payment or fee');
  }

  // Impersonation + generic greeting + call-this-number
  if (/^\s*dear (customer|user|sir|madam|account holder|valued)/i.test(text)) {
    add(1, 'generic greeting instead of your name');
  }
  if (/\b(call|whatsapp|contact)\b[^.]{0,25}[+\d][\d\sXx*\-]{8,}/i.test(text)) {
    add(1, 'asks you to call or message a number');
  }
  const brand = /\b(bank|sbi|hdfc|icici|axis|paytm|phonepe|upi|amazon|flipkart|fedex|dhl|india post|courier|parcel|package|delivery|income tax|aadhaar|customs|irctc|rbi|police)\b/i.test(text);
  if (brand && score >= 2) {
    add(1, 'claims to be from a bank, courier or government body');
  }
  if ((text.match(/\b[A-Z]{5,}\b/g) || []).length >= 2) {
    add(1, 'shouting in capital letters');
  }

  let verdict, confidence, why, action;
  if (score >= 5) {
    verdict = 'scam';
    confidence = score >= 8 ? 'high' : 'medium';
    why = 'This message shows several classic scam warning signs, listed below.';
    action = 'Do not click any link or call any number in the message. Contact the company directly using an official number or website.';
  } else if (score >= 2) {
    verdict = 'suspicious';
    confidence = score >= 4 ? 'medium' : 'low';
    why = 'This message has some warning signs, but it is not clear-cut.';
    action = 'Be careful. Avoid links and do not share personal details until you have checked with the company directly.';
  } else {
    verdict = 'safe';
    confidence = 'low';
    why = 'No common scam warning signs were found, but this quick check is limited and can miss things.';
    action = 'If anything still feels off, contact the sender through an official channel before acting on the message.';
  }

  // Turn the rule points into a 0-100 meter reading (about 10 points per rule point).
  const scam_score = Math.min(100, score * 10);

  return { verdict, scam_score, confidence, why, red_flags: flags, recommended_action: action, basic: true };
}

const smsInput = document.getElementById('smsInput');
const charCount = document.getElementById('charCount');
const scanBtn = document.getElementById('scanBtn');
const scanBtnText = document.getElementById('scanBtnText');
const scanSpinner = document.getElementById('scanSpinner');
const errorMsg = document.getElementById('errorMsg');

const resultCard = document.getElementById('resultCard');
const verdictBadge = document.getElementById('verdictBadge');
const confidenceBadge = document.getElementById('confidenceBadge');
const resultWhy = document.getElementById('resultWhy');
const resultFlags = document.getElementById('resultFlags');
const resultAction = document.getElementById('resultAction');
const basicNote = document.getElementById('basicNote');
const scamMeter = document.getElementById('scamMeter');
const meterNeedle = document.getElementById('meterNeedle');
const meterScore = document.getElementById('meterScore');
const meterLabel = document.getElementById('meterLabel');

// ---------------------------------------------------------------------------
// Scam meter: a 0-100 gauge. The score is kept inside the band that matches
// the verdict (safe 0-29, suspicious 30-69, scam 70-100) so the needle and the
// verdict badge never disagree. If no score comes back, a typical value for
// the verdict is used.
// ---------------------------------------------------------------------------
const SCORE_BANDS = {
  safe:       { min: 0,  max: 29,  fallback: 10, label: 'Low risk' },
  suspicious: { min: 30, max: 69,  fallback: 50, label: 'Medium risk' },
  scam:       { min: 70, max: 100, fallback: 90, label: 'High risk' }
};

function normalizeScore(raw, verdict) {
  const band = SCORE_BANDS[verdict] || SCORE_BANDS.suspicious;
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !isFinite(n)) return band.fallback;
  const clamped = Math.max(0, Math.min(100, Math.round(n)));
  return Math.max(band.min, Math.min(band.max, clamped));
}

let meterTimer = null;
function renderMeter(score, verdict) {
  const band = SCORE_BANDS[verdict] || SCORE_BANDS.suspicious;
  const key = SCORE_BANDS[verdict] ? verdict : 'suspicious';

  scamMeter.className = 'meter ' + key;
  scamMeter.setAttribute('aria-label', 'Scam meter: ' + score + ' out of 100, ' + band.label.toLowerCase());
  meterLabel.textContent = band.label;

  // Reset to zero, then sweep to the score on the next frame.
  meterNeedle.style.transform = 'rotate(-90deg)';
  meterScore.textContent = '0';
  clearInterval(meterTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    meterNeedle.style.transform = 'rotate(' + (score * 1.8 - 90) + 'deg)';
  }));

  // Count the number up alongside the needle.
  const start = performance.now();
  const duration = 900;
  meterTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / duration);
    meterScore.textContent = Math.round(score * (1 - Math.pow(1 - t, 3)));
    if (t >= 1) clearInterval(meterTimer);
  }, 30);
}

smsInput.addEventListener('input', () => {
  charCount.textContent = smsInput.value.length;
});

scanBtn.addEventListener('click', scanMessage);
smsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    scanMessage();
  }
});

async function scanMessage() {
  const message = smsInput.value.trim();
  hideError();

  if (!message) {
    showError('Paste a message first.');
    return;
  }

  setLoading(true);
  resultCard.classList.add('hidden');

  try {
    let data;
    let blockedByHost = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('proxy.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal
      });
      const raw = await response.text();

      // Some free hosts answer with an HTML "browser check" page instead of JSON.
      if (/^\s*</.test(raw)) {
        blockedByHost = true;
        throw new Error('The host returned a web page instead of JSON.');
      }

      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { /* handled below */ }
      if (!response.ok || !parsed || parsed.error || !parsed.verdict) {
        throw new Error((parsed && parsed.error) || 'Server error (' + response.status + ').');
      }
      data = parsed;
    } catch (modelErr) {
      console.warn('AI check unavailable:', modelErr);
      // Host check page: reload once to get a fresh cookie, then retry automatically.
      if (blockedByHost && retryAfterReload(message)) {
        return;
      }
      // Otherwise fall back to the built-in basic check.
      data = basicScan(message);
    } finally {
      clearTimeout(timer);
    }

    clearRetryFlag();
    renderResult(data);
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

function renderResult(data) {
  const verdict = (data.verdict || 'unknown').toLowerCase();

  verdictBadge.textContent =
    verdict === 'scam' ? '🚨 Likely scam' :
    verdict === 'suspicious' ? '⚠️ Suspicious' :
    verdict === 'safe' ? '✅ Looks safe' :
    'Unknown';

  verdictBadge.className = 'verdict-badge ' +
    (verdict === 'scam' ? 'scam' : verdict === 'suspicious' ? 'suspicious' : 'safe');

  confidenceBadge.textContent = data.confidence ? `Confidence: ${data.confidence}` : '';

  resultWhy.textContent = data.why || 'No explanation returned.';

  resultFlags.innerHTML = '';
  const flags = Array.isArray(data.red_flags) ? data.red_flags : [];
  if (flags.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'None identified.';
    resultFlags.appendChild(li);
  } else {
    flags.forEach(flag => {
      const li = document.createElement('li');
      li.textContent = flag;
      resultFlags.appendChild(li);
    });
  }

  resultAction.textContent = data.recommended_action || 'Use your own judgment.';

  basicNote.classList.toggle('hidden', !data.basic);
  resultCard.classList.remove('hidden');

  const meterVerdict = SCORE_BANDS[verdict] ? verdict : 'suspicious';
  renderMeter(normalizeScore(data.scam_score, meterVerdict), meterVerdict);
}

function setLoading(isLoading) {
  scanBtn.disabled = isLoading;
  scanSpinner.classList.toggle('hidden', !isLoading);
  scanBtnText.textContent = isLoading ? 'Scanning…' : 'Scan message';
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
  errorMsg.textContent = '';
}

// ---------------------------------------------------------------------------
// Free hosts (e.g. InfinityFree) sometimes block a request with an HTML
// "browser check" page when the check cookie is missing or has expired.
// Reloading the page gives a fresh cookie. We do this once, keep the user's
// message, and scan again automatically.
// ---------------------------------------------------------------------------
function retryAfterReload(message) {
  try {
    if (sessionStorage.getItem('ca_retry')) return false; // already retried once
    sessionStorage.setItem('ca_retry', '1');
    sessionStorage.setItem('ca_pending', message);
    location.reload();
    return true;
  } catch (e) {
    return false;
  }
}

function clearRetryFlag() {
  try { sessionStorage.removeItem('ca_retry'); } catch (e) { /* ignore */ }
}

// After a reload, put the message back and scan again.
(function resumeAfterReload() {
  try {
    const pending = sessionStorage.getItem('ca_pending');
    if (pending) {
      sessionStorage.removeItem('ca_pending');
      smsInput.value = pending;
      charCount.textContent = pending.length;
      scanMessage();
    } else {
      sessionStorage.removeItem('ca_retry');
    }
  } catch (e) { /* ignore */ }
})();
