"""
Browser smoke test of the real frontend in sandbox mode (no Google account needed).

    npm run serve            # in one terminal (http://localhost:5173)
    python3 tests/e2e/smoke.py [--shots DIR]

Requires: pip install playwright && python -m playwright install chromium
Walks through: sandbox → accounts → deposit → withdrawal → transfer → USDT account with FX →
crypto buy → price update → snapshot → integrity check → every page on desktop and mobile,
failing on any uncaught JS error or wrong figure.
"""
import re
import sys
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('PWOS_URL', 'http://localhost:5173/')
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
errors = []


def fill_modal(page, values):
    m = page.locator('.modal')
    for name, val in values.items():
        el = m.locator(f'[name="{name}"]')
        tag = el.evaluate('e => e.tagName')
        if tag == 'SELECT':
            if isinstance(val, str) and val.startswith('label:'):
                v = el.evaluate('(e, t) => [...e.options].find(o => o.text.includes(t))?.value', val[6:])
                assert v is not None, 'no option containing ' + val[6:]
                el.select_option(v)
            else:
                el.select_option(val)
        elif el.get_attribute('type') == 'checkbox':
            el.set_checked(bool(val))
        else:
            el.fill(str(val))
            el.dispatch_event('input')


def submit_modal(page, expect_close=True):
    page.locator('.modal [type=submit]').click()
    if expect_close:
        try:
            expect(page.locator('.modal-wrap')).to_have_count(0, timeout=8000)
        except AssertionError:
            err = page.locator('.modal .form-error')
            raise AssertionError('modal did not close: ' + (err.inner_text() if err.count() else '?'))


def shot(page, name):
    if SHOTS:
        page.wait_for_timeout(450)  # let the page fade-in finish
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)


def text_of(page, sel):
    return page.locator(sel).first.inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1440, 'height': 950}, timezone_id='Asia/Manila', locale='en-PH')
    # External resources (fonts, Google sign-in) are not needed in sandbox mode.
    ctx.route(re.compile(r'^https://(fonts\.|accounts\.google)'), lambda r: r.abort())
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'net::ERR' not in m.text and 'Failed to load resource' not in m.text else None)

    page.goto(BASE)
    page.get_by_text('Explore in sandbox').click()
    page.wait_for_selector('text=Welcome to your Wealth OS')
    shot(page, '01-empty')

    # Account 1: bank with opening balance
    page.locator('.empty [data-q="account"]').click()
    fill_modal(page, {'name': 'BPI Savings', 'type': 'BANK', 'institution': 'BPI', 'currency': 'PHP', 'opening_balance': '100000', 'reference': '1234567890'})
    submit_modal(page)
    page.wait_for_selector('.hero-value')
    assert '₱100,000.00' in text_of(page, '.hero-value'), text_of(page, '.hero-value')

    # Test A: deposit
    page.locator('.qa[data-q="deposit"]').click()
    fill_modal(page, {'account_id': 'label:BPI', 'gross_amount': '10000', 'remarks': 'Salary'})
    submit_modal(page)
    assert '₱110,000.00' in text_of(page, '.hero-value')

    # Test B: withdrawal (+ insufficient-funds guard)
    page.locator('.qa[data-q="withdrawal"]').click()
    fill_modal(page, {'account_id': 'label:BPI', 'gross_amount': '999999'})
    submit_modal(page, expect_close=False)
    expect(page.locator('.modal .form-error')).to_contain_text('Insufficient funds')
    fill_modal(page, {'gross_amount': '5000'})
    submit_modal(page)
    assert '₱105,000.00' in text_of(page, '.hero-value')

    # Account 2 + Test C: internal transfer leaves net worth unchanged
    page.goto(BASE + '#/accounts')
    page.locator('[data-a="add"]').first.click()
    fill_modal(page, {'name': 'GCash', 'type': 'EWALLET', 'currency': 'PHP'})
    submit_modal(page)
    page.locator('[data-a="transfer"]').first.click()
    fill_modal(page, {'from_account_id': 'label:BPI', 'to_account_id': 'label:GCash', 'amount': '10000'})
    submit_modal(page)
    page.goto(BASE + '#/dashboard')
    assert '₱105,000.00' in text_of(page, '.hero-value'), 'transfer changed net worth'

    # Test J: USDT exchange account at FX 58
    page.goto(BASE + '#/accounts')
    page.locator('[data-a="add"]').first.click()
    fill_modal(page, {'name': 'Binance', 'type': 'EXCHANGE', 'currency': 'USDT', 'opening_balance': '1000'})
    page.locator('.modal [name="currency"]').dispatch_event('input')
    fill_modal(page, {'opening_fx_rate': '58'})
    submit_modal(page)
    expect(page.locator('a.acct', has_text='Binance')).to_contain_text('₱58,000.00')
    page.goto(BASE + '#/dashboard')
    assert '₱163,000.00' in text_of(page, '.hero-value'), text_of(page, '.hero-value')

    # Test D: buy BTC then mark to 3.3M
    page.goto(BASE + '#/crypto')
    page.locator('[data-x="add"]').first.click()
    fill_modal(page, {'name': 'Bitcoin', 'ticker': 'BTC', 'currency': 'PHP'})
    submit_modal(page, expect_close=False)  # the purchase form opens next
    page.wait_for_selector('.modal >> text=Record purchase')
    fill_modal(page, {'account_id': 'label:BPI', 'quantity': '0.02', 'unit_price': '3000000', 'fee': '0'})
    submit_modal(page)
    page.locator('[data-price]').first.click()
    fill_modal(page, {'price': '3300000'})
    submit_modal(page)
    row = page.locator('.table tbody tr', has_text='BTC')
    expect(row).to_contain_text('₱66,000.00')
    expect(row).to_contain_text('+₱6,000.00')
    shot(page, '05-crypto')

    # Automatic prices from the browser: Binance BTCUSDT × CoinGecko USDT→PHP (both mocked)
    ctx.route(re.compile(r'^https://data-api\.binance\.vision/'), lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='[{"symbol":"ETHUSDT","price":"2500.00"},{"symbol":"BTCUSDT","price":"60000.00"}]'))
    ctx.route(re.compile(r'^https://api\.coingecko\.com/'), lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"tether":{"php":58,"usd":1}}'))
    page.locator('tr', has_text='BTC').locator('a').first.click()
    page.locator('[data-x="edit"]').click()
    fill_modal(page, {'price_source': 'BINANCE'})
    page.locator('.modal [name="price_source"]').dispatch_event('change')
    fill_modal(page, {'price_source_id': 'BINANCE:BTCUSDT'})
    submit_modal(page)
    page.goto(BASE + '#/crypto')
    page.locator('#refresh').click()
    page.wait_for_selector('.toast >> text=Updated 1 price')
    brow = page.locator('.table tbody tr', has_text='BTC')
    expect(brow).to_contain_text('₱3,480,000.00')   # 60,000 USDT × 58
    expect(brow).to_contain_text('Binance')
    expect(brow).to_contain_text('₱69,600.00')      # 0.02 BTC
    # a coin you don't hold yet still shows its fetched price
    page.locator('[data-x="add"]').first.click()
    fill_modal(page, {'name': 'Ether', 'ticker': 'ETH', 'currency': 'PHP', 'price_source': 'BINANCE'})
    page.locator('.modal [name="price_source"]').dispatch_event('change')
    fill_modal(page, {'price_source_id': 'ETHUSDT'})
    submit_modal(page, expect_close=False)
    page.wait_for_selector('.modal >> text=Record purchase')
    page.locator('.modal [data-close]').first.click()
    expect(page.locator('.modal-wrap')).to_have_count(0)
    page.locator('#refresh').click()
    page.wait_for_selector('.toast >> text=Updated 2 prices')
    erow = page.locator('.table tbody tr', has_text='ETH')
    expect(erow).to_contain_text('₱145,000.00')   # 2,500 USDT × 58, quantity 0
    expect(erow).to_contain_text('Binance')
    # a wrong symbol is explained, not silently ignored
    page.locator('tr', has_text='BTC').locator('a').first.click()
    page.locator('[data-x="edit"]').click()
    fill_modal(page, {'price_source_id': 'BTCUSDX'})
    submit_modal(page)
    page.goto(BASE + '#/crypto')
    page.locator('#refresh').click()
    expect(page.locator('.toast.error').last).to_contain_text('Binance has no pair "BTCUSDX"')
    page.locator('tr', has_text='BTC').locator('a').first.click()
    page.locator('[data-x="edit"]').click()
    fill_modal(page, {'price_source_id': 'BTCUSDT'})
    submit_modal(page)

    # Test E: stock partial sale
    page.goto(BASE + '#/stocks')
    page.locator('[data-x="add"]').first.click()
    fill_modal(page, {'name': 'Example Corp', 'ticker': 'EXMP', 'exchange': 'PSE', 'currency': 'PHP'})
    submit_modal(page, expect_close=False)
    page.wait_for_selector('.modal >> text=Record purchase')
    fill_modal(page, {'account_id': 'label:BPI', 'quantity': '10', 'unit_price': '100'})
    submit_modal(page)
    page.locator('[data-sell]').first.click()
    fill_modal(page, {'account_id': 'label:BPI', 'quantity': '4', 'unit_price': '120'})
    submit_modal(page)
    srow = page.locator('.table tbody tr', has_text='EXMP')
    expect(srow).to_contain_text('₱600.00')   # remaining cost basis
    expect(srow).to_contain_text('+₱80.00')   # realized

    # Snapshot + integrity
    page.goto(BASE + '#/settings')
    page.locator('[data-a="snap"]').click()
    page.wait_for_selector('.toast >> text=Snapshot saved')
    page.locator('[data-a="integrity"]').click()
    expect(page.locator('#integrity')).to_contain_text('Ledger reconciles')
    shot(page, '08-settings')

    # Reverse + audit trail
    page.goto(BASE + '#/transactions')
    page.locator('tr', has_text='Salary').locator('[data-reverse]').click()
    fill_modal(page, {'reason': 'smoke test reversal'})
    submit_modal(page)
    page.goto(BASE + '#/dashboard')
    nw = text_of(page, '.hero-value')
    assert nw.startswith('₱') and '₱' in nw

    # Planning starter goals
    page.goto(BASE + '#/planning')
    page.locator('[data-g="starter"]').click()
    expect(page.locator('.goal')).to_have_count(3, timeout=8000)
    shot(page, '09-planning')

    # Remove asset: stock with history → confirm → reversed and gone, ledger still reconciles
    page.goto(BASE + '#/stocks')
    page.locator('tr', has_text='EXMP').locator('[data-remove]').click()
    expect(page.locator('.modal')).to_contain_text('2 transactions')
    fill_modal(page, {'reason': 'smoke test removal'})
    submit_modal(page, expect_close=False)
    expect(page.locator('.modal .form-error')).to_contain_text('confirmation')
    fill_modal(page, {'confirm': True})
    submit_modal(page)
    expect(page.locator('.table tbody tr', has_text='EXMP')).to_have_count(0)
    page.goto(BASE + '#/settings')
    page.locator('[data-a="integrity"]').click()
    expect(page.locator('#integrity')).to_contain_text('Ledger reconciles')

    # Every page renders (desktop)
    for route in ['dashboard', 'accounts', 'transactions', 'portfolio', 'crypto', 'stocks', 'other', 'reports', 'planning', 'settings']:
        page.goto(BASE + '#/' + route)
        page.wait_for_selector('.page-head h1')
        assert page.locator('.empty.error').count() == 0, 'error state on ' + route
        shot(page, 'desk-' + route)

    # Reports: each report type renders
    page.goto(BASE + '#/reports')
    for opt in page.locator('#r-type option').all():
        v = opt.get_attribute('value')
        page.select_option('#r-type', v)
        page.wait_for_selector('#report h3')
    shot(page, 'report')

    # Mobile layout
    m = browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Manila', is_mobile=True, has_touch=True)
    m.route(re.compile(r'^https://(fonts\.|accounts\.google)'), lambda r: r.abort())
    mp = m.new_page()
    mp.on('pageerror', lambda e: errors.append('mobile pageerror: ' + str(e)))
    # carry sandbox data into the mobile context
    storage = page.evaluate('() => JSON.stringify(Object.assign({}, localStorage))')
    mp.goto(BASE)
    mp.evaluate('(s) => { const o = JSON.parse(s); for (const k in o) localStorage.setItem(k, o[k]); }', storage)
    for route in ['dashboard', 'accounts', 'transactions', 'crypto', 'stocks', 'portfolio', 'reports', 'planning', 'settings']:
        mp.goto(BASE + '#/' + route)
        mp.reload()
        mp.wait_for_selector('.page-head h1')
        mp.wait_for_timeout(700)
        overflow = mp.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
        assert overflow <= 1, f'horizontal overflow {overflow}px on mobile {route}'
        shot(mp, 'mobile-' + route)
    mp.locator('#menu').click()
    expect(mp.locator('#sidebar')).to_have_class(re.compile('open'))
    shot(mp, 'mobile-nav')

    browser.close()

if errors:
    print('\n'.join(errors))
    sys.exit('FAILED: browser errors')
print('E2E smoke: all checks passed')
