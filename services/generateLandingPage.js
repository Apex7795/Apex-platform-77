// services/generateLandingPage.js
// Generates structured landing page content (not raw HTML) so the
// frontend can render it into any theme later.
const OpenAI = require('openai');
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `You are a marketing copywriter for local service businesses.
Generate landing page content for a lead-generation site. Respond ONLY with
valid JSON matching this exact schema, no markdown fences, no preamble:
{
  "headline": string,
  "subheadline": string,
  "hero_cta_text": string,
  "services": [{ "title": string, "description": string }],
  "trust_points": [string], // 3-4 short trust/credibility bullets
  "service_area_text": string,
  "final_cta_headline": string,
  "final_cta_text": string
}
Tone: direct, trustworthy, local. Avoid generic filler. Keep descriptions
under 25 words each. Do not invent specific credentials, certifications,
awards, or years-in-business numbers the business didn't provide.`;

async function generateLandingPage({ businessName, serviceType, serviceArea, servicesOffered }) {
  const userPrompt = `Business name: ${businessName}
Service type: ${serviceType}
Service area: ${serviceArea}
Specific services offered: ${servicesOffered.join(', ')}
Generate the landing page JSON now.`;

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });

  const content = JSON.parse(response.choices[0].message.content);

  // Basic validation before it ever touches the DB
  const requiredKeys = [
    'headline', 'subheadline', 'hero_cta_text', 'services',
    'trust_points', 'service_area_text', 'final_cta_headline', 'final_cta_text',
  ];
  for (const key of requiredKeys) {
    if (!(key in content)) {
      throw new Error(`AI response missing required field: ${key}`);
    }
  }

  return content;
}

module.exports = { generateLandingPage };

// --- Usage in your signup route ---
// const { generateLandingPage } = require('./services/generateLandingPage');
//
// const content = await generateLandingPage({
//   businessName: 'Rapid Haul Junk Removal',
//   serviceType: 'junk_removal',
//   serviceArea: 'Sacramento, CA',
//   servicesOffered: ['furniture removal', 'appliance removal', 'yard debris'],
// });
//
// await pool.query(
//   `INSERT INTO landing_pages (tenant_id, headline, content_json) VALUES ($1, $2, $3)`,
//   [tenantId, content.headline, JSON.stringify(content)]
// );
