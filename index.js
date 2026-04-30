require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const PRODUCT_QUERY = 'Nike Revolution 8 HJ9198';
const CENEO_SEARCH_URL = `https://www.ceneo.pl/szukaj-q-${encodeURIComponent(PRODUCT_QUERY)}`;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'panrobertkrol@gmail.com';

// Włącz/wyłącz raporty — ustaw REPORTS_ENABLED=false w .env żeby wstrzymać
const REPORTS_ENABLED = process.env.REPORTS_ENABLED !== 'false';

// ---------------------------------------------------------------------------
// Scraper Ceneo.pl
// ---------------------------------------------------------------------------
async function fetchCeneoPrices() {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pl-PL,pl;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const response = await axios.get(CENEO_SEARCH_URL, { headers, timeout: 15000 });
  const $ = cheerio.load(response.data);
  const offers = [];

  // Ceneo wyniki wyszukiwania — karty produktów
  $('div.cat-prod-row, li.cat-prod-row').each((_, el) => {
    const nameEl = $(el).find('strong.cat-prod-row__name, .cat-prod-row__name a').first();
    const priceEl = $(el).find('span.price, .price-box span.value').first();
    const linkEl  = $(el).find('a.cat-prod-row__name, a[href*="/"]').first();
    const shopEl  = $(el).find('.cat-prod-row__shop-name, .shop-name').first();

    const name  = nameEl.text().trim();
    const shop  = shopEl.text().trim();
    let   href  = linkEl.attr('href') || '';
    const priceText = priceEl.text().trim().replace(/\s/g, '').replace(',', '.');
    const price = parseFloat(priceText);

    if (!name || isNaN(price)) return;

    if (!href.startsWith('http')) {
      href = 'https://www.ceneo.pl' + href;
    }

    offers.push({ name, price, shop, url: href });
  });

  // Fallback: próbuj alternatywnych selektorów (Ceneo zmienia HTML)
  if (offers.length === 0) {
    $('div[data-productid], div.product-item').each((_, el) => {
      const nameEl  = $(el).find('[class*="name"]').first();
      const priceEl = $(el).find('[class*="price"]').first();
      const linkEl  = $(el).find('a').first();

      const name  = nameEl.text().trim();
      const priceText = priceEl.text().trim().replace(/\s/g, '').replace(',', '.');
      const price = parseFloat(priceText);
      let   href  = linkEl.attr('href') || '';

      if (!name || isNaN(price)) return;
      if (!href.startsWith('http')) href = 'https://www.ceneo.pl' + href;

      offers.push({ name, price, shop: '', url: href });
    });
  }

  // Sortuj rosnąco po cenie, zwróć 3 najtańsze
  offers.sort((a, b) => a.price - b.price);
  return offers.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Wysyłka e-mail przez Gmail
// ---------------------------------------------------------------------------
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD, // Hasło aplikacji Google (nie hasło konta!)
    },
  });
}

function buildEmailHtml(offers) {
  const rows = offers
    .map(
      (o, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
        <td style="padding:10px;font-weight:bold;color:#1a73e8">#${i + 1}</td>
        <td style="padding:10px">${o.name || PRODUCT_QUERY}</td>
        <td style="padding:10px">${o.shop || '—'}</td>
        <td style="padding:10px;font-weight:bold;color:#d93025">${o.price.toFixed(2)} zł</td>
        <td style="padding:10px"><a href="${o.url}" style="color:#1a73e8">Zobacz ofertę →</a></td>
      </tr>`
    )
    .join('');

  return `
    <html>
    <body style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
      <h2 style="color:#202124">🏃 Nike Revolution 8 HJ9198 — 3 najtańsze oferty</h2>
      <p style="color:#5f6368">Raport z dnia ${new Date().toLocaleDateString('pl-PL')}, godz. 20:00</p>
      <table width="100%" border="0" cellspacing="0" cellpadding="0"
             style="border-collapse:collapse;border:1px solid #e0e0e0">
        <thead>
          <tr style="background:#1a73e8;color:#fff">
            <th style="padding:10px">#</th>
            <th style="padding:10px">Produkt</th>
            <th style="padding:10px">Sklep</th>
            <th style="padding:10px">Cena</th>
            <th style="padding:10px">Link</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#5f6368;font-size:12px;margin-top:20px">
        Źródło: <a href="${CENEO_SEARCH_URL}">Ceneo.pl</a> · 
        Aplikacja nike-price-tracker
      </p>
    </body>
    </html>`;
}

async function sendEmail(offers) {
  if (offers.length === 0) {
    console.log('[mail] Brak ofert do wysłania.');
    return;
  }

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"Nike Price Tracker" <${process.env.GMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject: `Nike Revolution 8 HJ9198 — od ${offers[0].price.toFixed(2)} zł (${new Date().toLocaleDateString('pl-PL')})`,
    html: buildEmailHtml(offers),
  });

  console.log(`[mail] Wysłano: ${info.messageId}`);
}

// ---------------------------------------------------------------------------
// Główna funkcja
// ---------------------------------------------------------------------------
async function run() {
  console.log(`[${new Date().toLocaleString('pl-PL')}] Szukam ofert...`);
  try {
    const offers = await fetchCeneoPrices();
    if (offers.length === 0) {
      console.warn('[scraper] Nie znaleziono ofert. Sprawdź selektory HTML Ceneo.');
      return;
    }
    console.log(`[scraper] Znaleziono ${offers.length} ofert. Najtańsza: ${offers[0].price.toFixed(2)} zł`);
    offers.forEach((o, i) => console.log(`  #${i + 1} ${o.price.toFixed(2)} zł  ${o.url}`));
    await sendEmail(offers);
  } catch (err) {
    console.error('[błąd]', err.message);
  }
}

// ---------------------------------------------------------------------------
// Uruchomienie
// ---------------------------------------------------------------------------
const isTest = process.argv.includes('--test');

if (isTest) {
  // Tryb testowy: uruchom od razu, bez schedulera
  if (!REPORTS_ENABLED) {
    console.log('Tryb testowy — uruchamiam mimo REPORTS_ENABLED=false...');
  }
  run();
} else {
  if (!REPORTS_ENABLED) {
    console.log('Nike Price Tracker uruchomiony, ale REPORTS_ENABLED=false — raporty wstrzymane.');
  } else {
    console.log('Nike Price Tracker uruchomiony. Wysyłka o 8:00 i 20:00 (Europe/Warsaw).');
  }

  // Codziennie o 8:00
  cron.schedule('0 8 * * *', () => {
    if (REPORTS_ENABLED) run();
    else console.log('[scheduler] Raporty wstrzymane (REPORTS_ENABLED=false).');
  }, { timezone: 'Europe/Warsaw' });

  // Codziennie o 20:00
  cron.schedule('0 20 * * *', () => {
    if (REPORTS_ENABLED) run();
    else console.log('[scheduler] Raporty wstrzymane (REPORTS_ENABLED=false).');
  }, { timezone: 'Europe/Warsaw' });
}
