<?php
// Copy this file to config.php and fill in your own key.
// Get a free key at https://openrouter.ai/keys
return [
    'OPENROUTER_API_KEY' => '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',

    // Free tier by default. If you hit rate limits, switch to the paid
    // (non-:free) slug: 'nvidia/nemotron-3-ultra-550b-a55b'
    'MODEL' => 'nvidia/nemotron-3-ultra-550b-a55b:free',

    // Set to true to see why a model reply couldn't be read (shown in the
    // proxy's error response). Leave false on the live site.
    'DEBUG' => false,
];
