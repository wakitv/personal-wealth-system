# Google Sheets schema

`setupDatabase()` creates every worksheet with its header row. It also freezes row 1 and formats text columns as plain text, so that IDs and ISO timestamps are never auto-converted into dates or numbers.

Columns are matched **by header name**: you can reorder columns, and re-running `setupDatabase()` appends any columns added in a later version. Sheets are protected with a *warning* so that manual edits prompt first. Edit through the app, which is the only path that validates and audits.

Conventions:
* **IDs** have a prefix (`ACC-`, `AST-`, `TX-`, `TRF-`, `LNK-`, `PRC-`, `FX-`, `GOAL-`, `AUD-`) followed by 20 random characters from `Utilities.getUuid()`.
* **Timestamps** are ISO 8601 in UTC (`2026-10-14T13:23:00.000Z`). They are displayed in the configured time zone (Asia/Manila) as `DD MMM YYYY`.
* **Dates** without a time are `YYYY-MM-DD` in the configured time zone.
* **Money** is rounded to the currency's decimals: PHP/USD 2, JPY 0, USDT/USDC 6, BTC/ETH 8. Base-currency figures are rounded to 2 decimals. Quantities are rounded to 8 decimals.
* **Text** that begins with `= + - @` is stored with a leading apostrophe, so Sheets never evaluates it as a formula. The app strips the apostrophe when reading.

## Settings
| Column | Description |
|---|---|
| key | Setting name (whitelisted; see below) |
| value | String value (JSON for structured values) |
| updated_at | Last change |

Keys: `base_currency` (PHP), `timezone` (Asia/Manila), `date_format`, `theme`, `default_period`, `performance_method` (TWR \| MODIFIED_DIETZ), `reconcile_default` (FLOW \| NON_FLOW), `stale_price_days`, `concentration_threshold`, `allocation_targets` (JSON, must total 100), `scenario_returns` (JSON), `inflation_rate`, `emergency_monthly_expenses`, `emergency_target_months`, `emergency_accounts` (JSON array, empty means all bank / e-wallet / cash accounts), `price_auto_refresh`, `coingecko_fx_ids` (JSON), `mask_references`.

## Accounts
| Column | Description |
|---|---|
| account_id | Stable unique ID |
| name | Display name (e.g. GCash, Binance) |
| type | EXCHANGE, WALLET, BANK, EWALLET, CASH, BROKERAGE, LIABILITY, OTHER |
| institution | Bank / exchange / provider |
| reference | Optional account reference, masked in normal views (stored as entered; never a password, PIN or key) |
| currency | Account currency (PHP, USD, USDT…). Cannot change once transactions exist |
| notes | Free text (text that looks like a seed phrase, private key or password is refused) |
| status | ACTIVE or ARCHIVED (archived accounts keep history and still count toward net worth) |
| created_at, updated_at | Timestamps; `updated_at` is also the optimistic-concurrency version |

There is deliberately **no balance column**. The recorded balance is always computed from the ledger.

## Assets
| Column | Description |
|---|---|
| asset_id | Stable unique ID |
| name | Coin / company / asset name |
| ticker | BTC, ALI… (blank for most other assets) |
| asset_class | CRYPTO, STOCK, OTHER |
| category | For OTHER: BUSINESS, PROPERTY, METALS, EQUIPMENT, PRIVATE, CUSTOM |
| exchange | Stock exchange (PSE, NASDAQ…) |
| network | Crypto network (optional) |
| currency | Currency the market price is quoted in |
| unit_label | What quantity means (shares, %, oz…) |
| price_source | MANUAL or COINGECKO |
| price_source_id | CoinGecko coin ID (e.g. `bitcoin`) |
| notes, status, created_at, updated_at | As for Accounts |

## Transactions (the ledger, the source of truth)
| Column | Description |
|---|---|
| tx_id | Unique transaction ID |
| seq | Monotonic posting sequence (orders same-timestamp rows) |
| request_id | Client request ID that created the row (idempotency) |
| type | OPENING_BALANCE, DEPOSIT, WITHDRAWAL, FEE, INCOME, RECONCILE, BUY, SELL, ADD_POSITION, REDUCE_POSITION, TRANSFER_OUT, TRANSFER_IN, ASSET_TRANSFER_OUT, ASSET_TRANSFER_IN, REVERSAL |
| occurred_at | When it happened (ISO UTC) |
| account_id | Account affected |
| counter_account_id | Other side of a transfer |
| asset_id | Asset, when relevant |
| quantity | Units (in-kind income, trades, positions, asset transfers) |
| unit_price | Price per unit in the account currency (trades). ADD/REDUCE_POSITION: optional market price used to value the flow |
| gross_amount | Amount in account currency (cost basis for ADD_POSITION; **signed** for RECONCILE) |
| fee | Fee in account currency (ASSET_TRANSFER_OUT: network fee in units) |
| net_amount | Cash effect magnitude (e.g. deposit gross − fee, buy qty·price + fee) |
| currency | Account currency |
| fx_rate | Base currency per 1 unit of `currency` at transaction time (1 for PHP) |
| base_amount | gross_amount × fx_rate (PHP equivalent) |
| link_id | Shared ID linking both legs of a transfer (`TRF-…`) or a purchase and its funding deposit (`LNK-…`) |
| category | INCOME kind (DIVIDEND, INTEREST, STAKING, REWARD, RENT, OTHER) · FEE kind · RECONCILE FLOW/NON_FLOW · REDUCE_POSITION WITHDRAWN/LOSS |
| reference_no | Optional bank/exchange reference |
| attachment | Optional receipt link or file name |
| remarks | Free text |
| status | POSTED or REVERSED |
| reversal_of | On a REVERSAL row: the reversed tx_id |
| reversed_by | On a reversed row: the REVERSAL tx_id |
| replaces | On a corrected row: the original tx_id it replaces |
| created_at, updated_at, created_by | Audit fields (created_by = verified Google email) |

The original spec's separate `AssetTransactions` worksheet is merged into this ledger. Holding cash and asset events in one ordered sequence removes the risk of two tables disagreeing, and makes "buy → cash out, coins in" a single atomic row.

## PriceHistory
| Column | Description |
|---|---|
| price_id | ID |
| asset_id | Asset |
| price | Price per unit |
| currency | Must equal the asset's currency |
| as_of | Price timestamp |
| source | MANUAL, VALUATION (other-asset estimate) or COINGECKO |
| is_estimate | TRUE for manual valuations / estimates |
| notes | Source detail (exchange close, appraisal…) |
| created_at | When recorded |

## FXRates
| Column | Description |
|---|---|
| fx_id | ID |
| currency | e.g. USDT |
| rate | Base currency per 1 unit |
| as_of | Rate timestamp |
| source | MANUAL, BSP, COINGECKO:tether… |
| created_at | When recorded |

## DailySnapshots
| Column | Description |
|---|---|
| snapshot_date | YYYY-MM-DD (time-zone local), unique |
| net_worth, total_assets, total_liabilities | Totals at end of day |
| cash_value, crypto_value, stock_value, other_value, investment_value | Category values |
| cost_basis, unrealized_pl | Positions at end of day |
| realized_pl_cum, income_cum, fees_cum | Cumulative to end of day |
| net_flow_day, net_flows_cum | External flows that day / cumulative |
| base_currency | e.g. PHP |
| fx_json | FX rates used (JSON) |
| quality_json | Counts of missing prices, stale prices, missing FX, estimates; oldest price timestamp |
| tx_count | Ledger events included |
| computed_at | When the snapshot was (re)computed |

## Goals
| Column | Description |
|---|---|
| goal_id | ID |
| name | Goal name |
| target_amount | Target in base currency |
| basis | NET_WORTH, INVESTMENTS, LIQUID, CASH (what counts toward the goal) |
| starting_amount, start_date | Baseline for "since start" |
| target_date | Target date (YYYY-MM-DD) |
| monthly_contribution | Planned contribution |
| expected_return | Hypothetical annual return assumption, % |
| priority | 1 = highest |
| status | ACTIVE, ACHIEVED, ARCHIVED |
| notes, created_at, updated_at | — |

## AuditLog
| Column | Description |
|---|---|
| audit_id | ID |
| at | Timestamp |
| actor | Verified email, or `system:daily` for the trigger |
| action | CREATE, UPDATE, POST, REVERSE, SNAPSHOT, REBUILD, REFRESH, EXPORT, RESTORE |
| entity, entity_id | What changed |
| request_id | Originating request |
| before_json, after_json | Row before / after |

## Requests (idempotency)
| Column | Description |
|---|---|
| request_id | Client-generated ID (8–80 chars `[A-Za-z0-9_-]`) |
| action | Action name; reusing an ID for a different action is rejected |
| actor | Verified email |
| at | Timestamp |
| result_json | Stored response, returned verbatim on retry |
