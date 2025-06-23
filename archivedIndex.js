const axios = require('axios');
const cheerio = require('cheerio');

// Telegram bot credentials from environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '114562824';

// Track previous items
let seenItems = new Set();

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: 114562824,
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

async function scrapeAndNotify() {
  try {
    const res = await axios.get('https://unionly.io/o/wwtt/store/products');
    const $ = cheerio.load(res.data);
    const newItems = [];

    const productDivs = $('div.w-full.max-w-sm.mx-auto.rounded-md.shadow-md.overflow-hidden');

    productDivs.each((i, el) => {
      const text = $(el).text().trim().substring(0, 50);
      if (!seenItems.has(text)) {
        seenItems.add(text);
        newItems.push(text);
      }
    });

    if (newItems.length > 0) {
      const msgBody = `*New Unionly items:*\n${newItems.map(i => `- ${i}`).join('\n')}`;
      await sendTelegramMessage(msgBody);
    } else {
      console.log('No new items found.');
    }
  } catch (err) {
    console.error('Error during scraping or messaging:', err.message);
  }
}

// Run once when started (Render Cron runs this fresh each time)
scrapeAndNotify();