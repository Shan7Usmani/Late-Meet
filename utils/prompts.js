// AI Prompt Templates for Meeting Copilot

export const SYSTEM_PROMPT = `You are an AI Meeting Copilot. You analyze meeting transcripts in real-time.
You MUST respond in valid JSON only. No markdown, no explanation, just JSON.
You can understand and process text in ANY language — English, Hindi, Urdu, Spanish, French, Arabic, Chinese, etc.
Always respond in English regardless of input language.`;

export const SUMMARY_PROMPT = (transcript, previousSummary) => `
Analyze this meeting transcript chunk and generate an updated summary.

${previousSummary ? `Previous summary context:\n${previousSummary}\n` : ''}

New transcript chunk:
"""
${transcript}
"""

Respond in this exact JSON format:
{
  "summary": "2-3 sentence rolling summary of everything discussed so far",
  "topics": [
    { "name": "topic name", "startTime": "timestamp or null", "status": "active|completed", "duration": "estimated duration" }
  ],
  "decisions": [
    { "text": "what was decided", "timestamp": "when", "by": "who said it or null" }
  ],
  "actionItems": [
    { "task": "what needs to be done", "owner": "assigned person or null", "deadline": "when or null" }
  ],
  "currentTopic": "what is currently being discussed",
  "sentiment": "positive|neutral|negative|mixed",
  "keyInsights": ["insight 1", "insight 2"],
  "questionsRaised": ["question 1"]
}`;

export const LATE_JOINER_BRIEF_PROMPT = (summary, topics, decisions, actionItems, currentTopic, joinerName) => `
A participant named "${joinerName}" just joined the meeting late.
Generate a friendly, concise briefing so they can quickly catch up.

Meeting context so far:
- Summary: ${summary}
- Topics discussed: ${JSON.stringify(topics)}
- Decisions made: ${JSON.stringify(decisions)}
- Action items: ${JSON.stringify(actionItems)}
- Currently discussing: ${currentTopic}

Respond in this exact JSON format:
{
  "greeting": "Hey ${joinerName} 👋",
  "briefing": "Here's what you missed:",
  "topicsSummary": ["bullet point 1", "bullet point 2"],
  "keyDecisions": ["decision 1"],
  "currentDiscussion": "what's being talked about right now",
  "actionItemsForThem": ["any action items relevant to them or empty array"],
  "fullBrief": "A single paragraph combining everything above naturally"
}`;

export const SPEAKER_ANALYSIS_PROMPT = (transcript) => `
Analyze speaker patterns in this transcript:
"""
${transcript}
"""

Respond in JSON:
{
  "speakers": [
    { "name": "speaker name", "wordCount": 0, "speakingTimePercent": 0, "sentiment": "positive|neutral|negative" }
  ]
}`;
