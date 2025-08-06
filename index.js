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
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        !Array.isArray(parsed.unionly) ||
        !Array.isArray(parsed.theatrical)
      ) {
        throw new Error('Invalid Gist structure');
      }
    } catch {
      console.warn('Malformed Gist content. Resetting...');
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
  if (!(unionlySet instanceof Set) || !(theatricalSet instanceof Set)) {
    console.error('Invalid sets passed to updateSeenItems. Aborting.');
    return;
  }
  try {
    const updatedContent = JSON.stringify({
      unionly: [...unionlySet],
      theatrical: [...theatricalSet]
    }, null, 2);
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

async function sendTelegramMessage(message) {
  if (!message || !TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) {
    console.error('Missing Telegram configuration or message.');
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
      console.error('Message content:', message);
    }
  }
}

async function scrapeUnionly(seenSet, newItems) {
  try {
    const res = await axios.get('https://unionly.io/o/wwtt/store/products');
    const $ = cheerio.load(res.data);
    const productDivs = $('div.w-full.max-w-sm.mx-auto.rounded-md.shadow-md.overflow-hidden');

    productDivs.each((i, el) => {
      const text = $(el).text().replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const href = $(el).find('a').attr('href');
      const link = href ? `https://unionly.io${href}` : '';
      const entry = link ? `[${escapeMarkdown(text)}](${link})` : escapeMarkdown(text);

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

    headers.each((i, el) => {
      const text = $(el).text().replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const href = $(el).attr('href');
      const link = href ? `https://theatricaltraining.com${href}` : '';
      const entry = link ? `[${escapeMarkdown(text)}](${link})` : escapeMarkdown(text);

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
  const unionlySet = seenItems.unionly;
  const theatricalSet = seenItems.theatrical;
  const newUnionly = [];
  const newTheatrical = [];

  await scrapeUnionly(unionlySet, newUnionly);
  await scrapeTheatricalTraining(theatricalSet, newTheatrical);

  if (newUnionly.length > 0 || newTheatrical.length > 0) {
    const msg = `*Unionly Items:*\n${newUnionly.map(i => `- ${i}`).join('\n') || 'None'}\n\n*TheatricalTraining.org Items:*\n${newTheatrical.map(i => `- ${i}`).join('\n') || 'None'}`;
    await sendTelegramMessage(msg);
    await updateSeenItems(unionlySet, theatricalSet);
  } else {
    console.log('No new items found.');
  }
}

scrapeAndNotify();
