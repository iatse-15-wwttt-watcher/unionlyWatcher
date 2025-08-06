const axios = require('axios');
const cheerio = require('cheerio');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_ID = '21539a315a95814d617a76c3e80f2622';
const GIST_FILENAME = 'seenItems.json';
let newUnionlyItems = [];
let newTheatricalTrainingItems = [];

async function fetchSeenItems() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });
    const content = res.data.files[GIST_FILENAME].content;
    return new Set(JSON.parse(content));
  } catch (err) {
    console.error('Failed to fetch seen items from Gist:', err.message);
    return new Set();
  }
}

async function updateSeenItems(seenItemsSet) {
  try {
    const updatedContent = JSON.stringify([...seenItemsSet], null, 2);
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
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  };

  try {
    await axios.post(url, payload);
    console.log('Telegram message sent');
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

async function scrapeUnionly(seenItems, newUnionlyItems) {
  try {
    const res = await axios.get('https://unionly.io/o/wwtt/store/products');
    const $ = cheerio.load(res.data);
    const productDivs = $('div.w-full.max-w-sm.mx-auto.rounded-md.shadow-md.overflow-hidden');

    productDivs.each((i, el) => {
      const text = $(el).text().trim().substring(0, 50);
      if (!seenItems.has(text)) {
        seenItems.add(text);
        newUnionlyItems.push(`Unionly: ${text}`);
      }
    });
  } catch (err) {
    console.error('Error scraping Unionly:', err.message);
  }
}

async function scrapeTheatricalTraining(seenItems, newTheatricalTrainingItems) {
  try {
    const res = await axios.get('https://theatricaltraining.com/#thecalendar');
    const $ = cheerio.load(res.data);
    const articles = $('div.fl-module-content.fl-node-content .ee-event-header-lnk');

    articles.each((i, el) => {
      const text = $(el).text().trim().substring(0, 50);
      if (!seenItems.has(text)) {
        seenItems.add(text);
        newTheatricalTrainingItems.push(`TheatricalTraining: ${text}`);
      }
    });
  } catch (err) {
    console.error('Error scraping Theatrical Training:', err.message);
  }
}

async function scrapeAndNotify() {
  const seenItems = await fetchSeenItems();
  const newItems = {Unionly:newUnionlyItems, `Theatrical Training Trust`:newTheatricalTrainingItems};

  await scrapeUnionly(seenItems, newUnionlyItems);
  await scrapeTheatricalTraining(seenItems, newTheatricalTrainingItems);

  if (newItems.length > 0) {
    const msgBody = `*New Items Found:*\n${newItems.map(i => `- ${i}`).join('\n')}`;
    await sendTelegramMessage(msgBody);
    await updateSeenItems(seenItems);
  } else {
    console.log('No new items found.');
  }
}

scrapeAndNotify();
