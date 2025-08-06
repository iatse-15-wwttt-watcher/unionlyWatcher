const axios = require('axios');
const cheerio = require('cheerio');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_ID = '21539a315a95814d617a76c3e80f2622';
const GIST_FILENAME = 'seenItems.json';

async function resetGistFile() {
  const resetContent = JSON.stringify({ unionly: [], theatrical: [] }, null, 2);
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: {
        [GIST_FILENAME]: { content: resetContent }
      }
    }, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
    console.warn('Gist file reset to default structure.');
  } catch (err) {
    console.error('Failed to reset Gist file:', err.message);
  }
}

async function fetchSeenItems() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
    const content = res.data.files[GIST_FILENAME].content;
    let parsed;
    try {
      parsed = JSON.parse(content);
      console.log('Raw parsed Gist content:', parsed);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        !Array.isArray(parsed.unionly) ||
        !Array.isArray(parsed.theatrical)
      ) {
        throw new Error('Parsed content is not a valid object structure');
      }
    } catch (parseErr) {
      console.warn('Gist content is invalid or malformed. Attempting to reset.');
      await resetGistFile();
      parsed = { unionly: [], theatrical: [] };
    }
    return {
      unionly: new Set(parsed.unionly),
      theatrical: new Set(parsed.theatrical)
    };
  } catch (err) {
    console.error('Failed to fetch seen items from Gist:', err.message);
    await resetGistFile();
    return { unionly: new Set(), theatrical: new Set() };
  }
}

async function updateSeenItems(unionlySet, theatricalSet) {
  if (!unionlySet || !theatricalSet) return;
  try {
    const updatedContent = JSON.stringify({
      unionly: [...unionlySet],
      theatrical: [...theatricalSet]
    }, null, 2);
    console.log('Updating Gist with:', updatedContent);
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: {
        [GIST_FILENAME]: { content: updatedContent }
      }
    }, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
  } catch (err) {
    console.error('Failed to update seen items Gist:', err.message);
  }
}

function escapeMarkdown(text) {
  return text.replace(/([_\-*\[\]()~`>#+=|{}.!])/g, '\\$1');
}

async function sendTelegramMessage(message) {
  if (!message || !TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) {
    console.error('Missing message content or Telegram credentials. Skipping Telegram message.');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  };

  try {
    await axios.post(url, payload);
    console.log('Telegram message sent');
  } catch (err) {
    console.error('Telegram error:', err.message);
    if (err.response?.data) {
      console.error('Telegram response:', JSON.stringify(err.response.data));
      console.error('Message that caused the error:', message);
    }
  }
}

async function scrapeUnionly(seenSet, newItems) {
  try {
    const res = await axios.get('https://unionly.io/o/wwtt/store/products');
    const $ = cheerio.load(res.data);
    const productDivs = $('div.w-full.max-w-sm.mx-auto.rounded-md.shadow-md.overflow-hidden');

    console.log(`Found ${productDivs.length} items on Unionly:`);

    productDivs.each((i, el) => {
      const rawText = $(el).text();
      const cleaned = rawText.replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const href = $(el).find('a').attr('href');
      const link = href ? `https://unionly.io${href}` : '';
      const entry = link ? `[${escapeMarkdown(cleaned)}](${link})` : escapeMarkdown(cleaned);
      console.log(`- ${entry}`);
      if (!seenSet.has(entry)) {
        seenSet.add(entry);
        newItems.push(entry);
      }
    });
  } catch (err) {
    console.error('Error scraping Unionly:', err.message);
  }
}

async function scrapeTheatricalTraining(seenSet, newItems) {
  try {
    const res = await axios.get('https://theatricaltraining.com/#thecalendar');
    const $ = cheerio.load(res.data);
    const headers = $('div.ee-event-header-lnk');

    console.log(`Found ${headers.length} items on TheatricalTraining.org:`);

    headers.each((i, el) => {
      const rawText = $(el).text();
      const cleaned = rawText.replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const href = $(el).find('a').attr('href');
      const link = href ? `https://theatricaltraining.com${href}` : '';
      const entry = link ? `[${escapeMarkdown(cleaned)}](${link})` : escapeMarkdown(cleaned);
      console.log(`- ${entry}`);
      if (!seenSet.has(entry)) {
        seenSet.add(entry);
        newItems.push(entry);
      }
    });
  } catch (err) {
    console.error('Error scraping Theatrical Training:', err.message);
  }
}

async function scrapeAndNotify() {
  const { unionly, theatrical } = await fetchSeenItems();
  const newUnionly = [];
  const newTheatrical = [];

  await scrapeUnionly(unionly, newUnionly);
  await scrapeTheatricalTraining(theatrical, newTheatrical);

  if (newUnionly.length > 0 || newTheatrical.length > 0) {
    const msgBody = `*Unionly Items:*\n${newUnionly.map(i => `- ${i}`).join('\n') || 'None'}\n\n*TheatricalTraining.org Items:*\n${newTheatrical.map(i => `- ${i}`).join('\n') || 'None'}`;
    await sendTelegramMessage(msgBody);
    await updateSeenItems(unionly, theatrical);
  } else {
    console.log('No new items found.');
  }
}

scrapeAndNotify();
