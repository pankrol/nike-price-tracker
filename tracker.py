import os
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

from urllib.parse import quote

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

# ---------------------------------------------------------------------------
# Konfiguracja
# ---------------------------------------------------------------------------
PRODUCT_QUERY    = "Nike Revolution 8 HJ9198"
CENEO_SEARCH_URL = f"https://www.ceneo.pl/szukaj-q-{quote(PRODUCT_QUERY)}"
RECIPIENT_EMAIL  = os.getenv("RECIPIENT_EMAIL", "panrobertkrol@gmail.com")
GMAIL_USER       = os.getenv("GMAIL_USER")
GMAIL_APP_PASS   = os.getenv("GMAIL_APP_PASSWORD")

# ---------------------------------------------------------------------------
# Scraper Ceneo.pl (Playwright — prawdziwy headless Chromium)
# ---------------------------------------------------------------------------
def fetch_prices() -> list[dict]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="pl-PL",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        page.goto(CENEO_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
        try:
            page.wait_for_selector("div.cat-prod-row, li.cat-prod-row", timeout=10000)
        except Exception:
            pass
        html = page.content()
        browser.close()

    soup = BeautifulSoup(html, "html.parser")
    offers = []

    for el in soup.select("div.cat-prod-row, li.cat-prod-row"):
        name_el  = el.select_one("strong.cat-prod-row__name, .cat-prod-row__name a")
        price_el = el.select_one("span.price, .price-box span.value")
        link_el  = el.select_one("a.cat-prod-row__name, a[href]")
        shop_el  = el.select_one(".cat-prod-row__shop-name, .shop-name")

        if not name_el or not price_el:
            continue

        name  = name_el.get_text(strip=True)
        shop  = shop_el.get_text(strip=True) if shop_el else "—"
        href  = link_el["href"] if link_el else ""
        if href and not href.startswith("http"):
            href = "https://www.ceneo.pl" + href

        price_str = price_el.get_text(strip=True).replace("\xa0", "").replace(" ", "").replace(",", ".")
        # usuń jednostkę "zł" jeśli jest
        price_str = "".join(c for c in price_str if c.isdigit() or c == ".")
        try:
            price = float(price_str)
        except ValueError:
            continue

        offers.append({"name": name, "shop": shop, "price": price, "url": href})

    offers.sort(key=lambda o: o["price"])
    return offers[:3]

# ---------------------------------------------------------------------------
# E-mail
# ---------------------------------------------------------------------------
def build_html(offers: list[dict]) -> str:
    rows = ""
    for i, o in enumerate(offers):
        bg = "#f9f9f9" if i % 2 == 0 else "#ffffff"
        rows += f"""
        <tr style="background:{bg}">
          <td style="padding:10px;font-weight:bold;color:#1a73e8">#{i+1}</td>
          <td style="padding:10px">{o['name']}</td>
          <td style="padding:10px">{o['shop']}</td>
          <td style="padding:10px;font-weight:bold;color:#d93025">{o['price']:.2f} zł</td>
          <td style="padding:10px"><a href="{o['url']}" style="color:#1a73e8">Zobacz ofertę →</a></td>
        </tr>"""

    date_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
      <h2 style="color:#202124">🏃 Nike Revolution 8 HJ9198 — 3 najtańsze oferty</h2>
      <p style="color:#5f6368">Raport z dnia {date_str}</p>
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
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#5f6368;font-size:12px;margin-top:20px">
        Źródło: <a href="{CENEO_SEARCH_URL}">Ceneo.pl</a> · nike-price-tracker
      </p>
    </body></html>"""


def send_email(offers: list[dict]) -> None:
    if not offers:
        print("[mail] Brak ofert do wysłania.")
        return

    msg = MIMEMultipart("alternative")
    msg["From"]    = f"Nike Price Tracker <{GMAIL_USER}>"
    msg["To"]      = RECIPIENT_EMAIL
    msg["Subject"] = (
        f"Nike Revolution 8 HJ9198 — od {offers[0]['price']:.2f} zł "
        f"({datetime.now().strftime('%d.%m.%Y')})"
    )
    msg.attach(MIMEText(build_html(offers), "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASS)
        server.sendmail(GMAIL_USER, RECIPIENT_EMAIL, msg.as_string())
    print(f"[mail] Wysłano do {RECIPIENT_EMAIL}")

# ---------------------------------------------------------------------------
# Główna funkcja
# ---------------------------------------------------------------------------
def main() -> None:
    print(f"[{datetime.now().strftime('%d.%m.%Y %H:%M:%S')}] Szukam ofert...")
    offers = fetch_prices()

    if not offers:
        print("[scraper] Nie znaleziono ofert. Sprawdź selektory HTML Ceneo.")
        sys.exit(1)

    print(f"[scraper] Znaleziono {len(offers)} ofert. Najtańsza: {offers[0]['price']:.2f} zł")
    for i, o in enumerate(offers):
        print(f"  #{i+1} {o['price']:.2f} zł  {o['url']}")

    send_email(offers)


if __name__ == "__main__":
    main()
