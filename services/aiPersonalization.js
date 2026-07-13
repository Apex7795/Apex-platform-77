// services/aiPersonalization.js
// Generates a one-line "icebreaker" opener for outreach emails, given
// whatever firmographic/intent context is actually available. Since
// services/waterfallEnrichment.js currently returns null for both of
// those (no provider configured yet), this has to degrade gracefully to
// a generic-but-not-fake opener rather than inventing specifics.
const OpenAI = require('openai');
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const ICEBREAKER_SYSTEM_PROMPT = `You write a single-sentence opening line for a
cold outreach email to a local service business owner. Under 25 words. No
greeting ("Hi" / "Hello"), no sign-off — just the opening line itself.
Reference only facts explicitly given to you. If no specific facts are
given, write a generic-but-relevant opener about their industry rather
than inventing details about their specific company — do not claim to
know something about them that wasn't provided.`;

async function generateIcebreaker(companyName, industry, intentSignals) {
  const facts = [];
  if (industry) facts.push(`Industry: ${industry}`);
  if (intentSignals && Object.keys(intentSignals).length > 0) {
    facts.push(`Signals: ${JSON.stringify(intentSignals)}`);
  }

  const userPrompt =
    facts.length > 0
      ? `Company: ${companyName}\n${facts.join('\n')}\nWrite the opening line.`
      : `Company: ${companyName}\nNo additional facts available — write a generic ` +
        `but industry-relevant opener that doesn't pretend to know specifics about them.`;

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: ICEBREAKER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 60,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

module.exports = { generateIcebreaker };
