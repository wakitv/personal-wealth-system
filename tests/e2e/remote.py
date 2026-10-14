"""
Remote-mode browser test: the real frontend talking to the real service over HTTP, with
Google sign-in replaced by a fake GIS script that issues test tokens.

    npm run serve                         # :5173
    node tests/e2e/mock-backend.js        # :5174
    python3 tests/e2e/remote.py

Verifies: connect screen validation, health check, sign-in, authenticated bootstrap,
a write with requestId, rejection of a non-allow-listed account, and expired-session handling.
"""
import base64, json, re, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = 'http://localhost:5173/'
API = 'https://script.google.com/macros/s/E2E_TEST_DEPLOYMENT/exec'
CLIENT = 'e2e-client.apps.googleusercontent.com'
errors = []

def jwt(email, exp_offset=3600):
    b = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    return b({'alg': 'none'}) + '.' + b({'aud': CLIENT, 'iss': 'https://accounts.google.com', 'email': email, 'email_verified': True, 'exp': int(time.time()) + exp_offset}) + '.sig'

def fake_gis(email):
    tok = jwt(email)
    return f"""window.google = {{ accounts: {{ id: {{
      initialize(c) {{ this.cb = c.callback; }},
      renderButton(el) {{ const b = document.createElement('button'); b.id = 'fake-google'; b.textContent = 'Sign in (test)'; b.onclick = () => this.cb({{ credential: '{tok}' }}); el.appendChild(b); }},
      prompt(n) {{ n && n({{ isNotDisplayed: () => true, isSkippedMoment: () => false }}); }},
      disableAutoSelect() {{}}
    }} }} }};"""

PW = sync_playwright().start()

def run(email):
    if True:
        b = PW.chromium.launch()
        ctx = b.new_context()
        ctx.route(re.compile(r'^https://fonts\.'), lambda r: r.abort())
        ctx.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, content_type='text/javascript', body=fake_gis(email)))
        def api(route):
            req = route.request
            resp = route.fetch(url='http://localhost:5174/', method=req.method, headers={'content-type': req.headers.get('content-type', '')}, post_data=req.post_data)
            route.fulfill(response=resp)
        ctx.route(API, api)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.fill('[name=apiUrl]', 'https://example.com/not-apps-script')
        page.fill('[name=clientId]', CLIENT)
        page.click('#connect [type=submit]')
        expect(page.locator('#connect .form-error')).to_contain_text('script.google.com')
        page.fill('[name=apiUrl]', API)
        page.click('#connect [type=submit]')
        page.wait_for_selector('#fake-google')
        page.click('#fake-google')
        return b, page

# 1) allow-listed owner can sign in, read and write
b, page = run('owner@example.com')
page.wait_for_selector('text=Welcome to your Wealth OS')
page.locator('.empty [data-q="account"]').click()
page.fill('.modal [name=name]', 'Remote Bank')
page.fill('.modal [name=opening_balance]', '2500')
page.click('.modal [type=submit]')
expect(page.locator('.hero-value')).to_contain_text('₱2,500.00', timeout=15000)
page.goto(BASE + '#/settings')
expect(page.locator('.kv')).to_contain_text('owner@example.com')
# token expiry: drop the session token → next call must return to sign-in, not show data
page.evaluate("() => sessionStorage.removeItem('pwos.idtoken')")
page.click('#reload')
page.wait_for_selector('#fake-google', timeout=8000)
b.close()

# 2) a different Google account is refused by the server
b, page = run('intruder@example.com')
page.wait_for_selector('.auth-card .banner', timeout=8000)
expect(page.locator('.auth-card .banner')).to_contain_text('not authorised')
assert page.locator('.hero-value').count() == 0
b.close()

PW.stop()
if errors:
    sys.exit('page errors: ' + '; '.join(errors))
print('E2E remote: all checks passed')
