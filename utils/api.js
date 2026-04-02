// OpenAI API wrapper for Meeting Copilot

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Get the stored OpenAI API key
 */
export async function getApiKey() {
  const result = await chrome.storage.local.get('openai_api_key');
  return result.openai_api_key || null;
}

/**
 * Call OpenAI Chat Completions API
 */
export async function chatCompletion(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  try {
    return JSON.parse(content);
  } catch {
    console.error('Failed to parse OpenAI response:', content);
    return null;
  }
}

/**
 * Transcribe audio using OpenAI Whisper API (multilingual)
 */
export async function whisperTranscribe(audioBlob, apiKey) {
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  // No language param → Whisper auto-detects language

  const response = await fetch(OPENAI_WHISPER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return {
    text: data.text,
    language: data.language,
    segments: data.segments || [],
    duration: data.duration
  };
}
