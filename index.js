const axios = require('axios');
const cheerio = require('cheerio');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_ID = '21539a315a95814d617a76c3e80f2622';
const GIST_FILENAME = 'seenItems.json';

function escapeMarkdown(text) {
  return text.replace(/([_\-\*\[\]\(\)~`>#+=|{}.!])/g, '\\$1');
}

async function resetGistFile() {
  const resetContent = JSON.stringify([[], []], null, 2);
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: { [GIST_FILENAME]: { content: resetContent } }
    }, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
    console.warn('Gist reset to clean nested array.');
  } catch (err) {
    console.error('Reset failed:', err.message);
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
    const parsed = JSON.parse(res.data.files[GIST_FILENAME].content);
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('Invalid JSON structure');

    return {
      unionly: new Set(parsed[0]),
      theatrical: new Set(parsed[1])
    };
  } catch (err) {
    console.error('Fetch failed or invalid Gist. Resetting...');
    await resetGistFile();
    return { unionly: new Set(), theatrical: new Set() };
  }
}

async function updateSeenItems(unionlySet, theatricalSet) {
  try {
    const safeArray = [Array.from(unionlySet), Array.from(theatricalSet)];
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: { [GIST_FILENAME]: { content: JSON.stringify(safeArray, null, 2) } }
    }, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
    console.log('Gist updated successfully.');
  } catch (err) {
    console.error('Failed to update Gist:', err.message);
  }
}

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  };

  try {
    await axios.post(url, payload);
    console.log('Telegram message sent.');
  } catch (err) {
    console.error('Telegram error:', err.message);
    if (err.response?.data) {
      console.error('Telegram API response:', err.response.data);
    }
  }
}

function cleanText(text) {
  return text.replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function scrapeUnionly(seenSet, newItems) {
  try {
    const res = await axios.get('https://unionly.io/o/wwtt/store/products');
    const $ = cheerio.load(res.data);
    const products = $('div.w-full.max-w-sm.mx-auto.rounded-md.shadow-md.overflow-hidden');

    products.each((_, el) => {
      const text = cleanText($(el).text());
      const href = $(el).find('a').attr('href');
      if (!href) return;

      const link = `https://unionly.io${href}`;
      const entry = `[${escapeMarkdown(text)}](${link})`;

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
    const headers = $('a.ee-event-header-lnk');

    headers.each((_, el) => {
      const text = cleanText($(el).text());
      const href = $(el).attr('href');
      if (!href) return;

      const link = `${href}`;
      const entry = `[${escapeMarkdown(text)}](${link})`;

      if (!seenSet.has(entry)) {
        seenSet.add(entry);
        newItems.push(entry);
      }
    });
  } catch (err) {
    console.error('Error scraping TheatricalTraining:', err.message);
  }
}

async function scrapeAndNotify() {
  const seenItems = await fetchSeenItems();
  const { unionly, theatrical } = seenItems;
  const newUnionly = [];
  const newTheatrical = [];

  await scrapeUnionly(unionly, newUnionly);
  await scrapeTheatricalTraining(theatrical, newTheatrical);

  if (newUnionly.length || newTheatrical.length) {
    const msg = `*Unionly Items:*\n${newUnionly.map(i => `- ${i}`).join('\n') || 'None'}\n\n*TheatricalTraining.org Items:*\n${newTheatrical.map(i => `- ${i}`).join('\n') || 'None'}`;
    await sendTelegramMessage(msg);
    await updateSeenItems(unionly, theatrical);
  } else {
    console.log('No new items found.');
  }
}

scrapeAndNotify();
