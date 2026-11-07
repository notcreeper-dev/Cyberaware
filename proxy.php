<?php
/**
 * CyberAware proxy
 * Forwards the pasted SMS text to OpenRouter (NVIDIA Nemotron 3 Ultra),
 * keeping the API key on the server. Mirrors the proxy.php pattern used
 * for the earlier Groq-based version of this project.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // tighten to your own domain in production
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Server not configured: copy config.example.php to config.php and add your OpenRouter key.']);
    exit;
}
$config = require $configPath;

$apiKey = $config['OPENROUTER_API_KEY'] ?? '';
$model  = $config['MODEL'] ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';
$debug  = !empty($config['DEBUG']);

if (!$apiKey || strpos($apiKey, 'your-key-here') !== false) {
    http_response_code(500);
    echo json_encode(['error' => 'Missing OpenRouter API key in config.php.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? '');

if ($message === '') {
    http_response_code(400);
    echo json_encode(['error' => 'No message provided.']);
    exit;
}
if (mb_strlen($message) > 2000) {
    $message = mb_substr($message, 0, 2000);
}

$systemPrompt = <<<SYS
You are CyberAware, a fraud/smishing (SMS phishing) detector. You will be given
the raw text of an SMS message. Analyze it for scam/phishing indicators: urgency
or threats, requests for OTPs/passwords/payment, suspicious or shortened links,
impersonation of banks/delivery/government, spoofed sender claims, too-good-to-be-true
offers, odd grammar typical of scam campaigns, etc.

Respond with ONLY a single JSON object, no markdown fences, no commentary, in
exactly this shape:
{
  "verdict": "scam" | "suspicious" | "safe",
  "scam_score": <integer 0-100>,
  "confidence": "low" | "medium" | "high",
  "why": "<1-2 sentence plain-English explanation>",
  "red_flags": ["<short flag>", "<short flag>", ...],
  "recommended_action": "<1 sentence of what the recipient should do>"
}

scam_score is the likelihood that the message is a scam, from 0 (certainly
legitimate) to 100 (certainly a scam). Keep it consistent with the verdict:
"safe" = 0-29, "suspicious" = 30-69, "scam" = 70-100.

Use "scam" when you are confident it's fraudulent, "suspicious" when there are
some warning signs but it's not clear-cut, and "safe" when it reads like a normal,
legitimate message. red_flags can be an empty array if none are found.
SYS;

$payload = [
    'model' => $model,
    'messages' => [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $message],
    ],
    'temperature' => 0.2,
    'max_tokens' => 1500,
];

$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
        // Optional but recommended by OpenRouter for attribution:
        'HTTP-Referer: https://cyberaware.example',
        'X-Title: CyberAware',
    ],
    CURLOPT_TIMEOUT => 30,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Could not reach OpenRouter: ' . $curlErr]);
    exit;
}

if ($httpCode < 200 || $httpCode >= 300) {
    http_response_code(502);
    echo json_encode(['error' => 'OpenRouter error (HTTP ' . $httpCode . ').']);
    exit;
}

$data = json_decode($response, true);
$choice = $data['choices'][0] ?? [];
$content = trim((string)($choice['message']['content'] ?? ''));

// Some reasoning models leave "content" empty and put their text in "reasoning".
if ($content === '') {
    $content = trim((string)($choice['message']['reasoning'] ?? ''));
}

/**
 * Find the JSON verdict object inside the model's text, even if it is wrapped
 * in markdown fences, extra commentary or reasoning. Returns the last valid
 * object that has a "verdict" key, or null.
 */
function extract_verdict_json($text) {
    $found = null;
    $len = strlen($text);
    for ($i = 0; $i < $len; $i++) {
        if ($text[$i] !== '{') {
            continue;
        }
        $depth = 0;
        $inStr = false;
        $esc = false;
        for ($j = $i; $j < $len; $j++) {
            $ch = $text[$j];
            if ($inStr) {
                if ($esc) {
                    $esc = false;
                } elseif ($ch === '\\') {
                    $esc = true;
                } elseif ($ch === '"') {
                    $inStr = false;
                }
                continue;
            }
            if ($ch === '"') {
                $inStr = true;
            } elseif ($ch === '{') {
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    $cand = json_decode(substr($text, $i, $j - $i + 1), true);
                    if (is_array($cand) && isset($cand['verdict'])) {
                        $found = $cand;
                        $i = $j;
                    }
                    break;
                }
            }
        }
    }
    return $found;
}

$parsed = extract_verdict_json($content);
$verdict = is_array($parsed) ? strtolower((string)($parsed['verdict'] ?? '')) : '';

if (!in_array($verdict, ['scam', 'suspicious', 'safe'], true)) {
    http_response_code(502);
    $err = ['error' => 'Could not parse model response.'];
    if ($debug) {
        $err['finish_reason'] = $choice['finish_reason'] ?? null;
        $err['raw_start'] = mb_substr($content, 0, 400);
    }
    echo json_encode($err);
    exit;
}

$parsed['verdict'] = $verdict;

// Keep scam_score a clean integer between 0 and 100 (the page also re-checks it).
if (isset($parsed['scam_score']) && is_numeric($parsed['scam_score'])) {
    $parsed['scam_score'] = max(0, min(100, (int) round((float) $parsed['scam_score'])));
} else {
    unset($parsed['scam_score']);
}
echo json_encode($parsed);
