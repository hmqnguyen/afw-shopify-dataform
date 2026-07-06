# afw-shopify-dataform

Dataform transforms cho dữ liệu Shopify của AFW (và HAT khi onboard), pair với
service ingestion `afw-shopify-sync` (C#). Pattern giống AfwDataform (Amazon):

```
raw (afw_raw, payload-only, C# ghi) 
  -> staging (afw_shopify_staging: parse + dedupe trong 1 file)
  -> master (incremental merge — CHƯA VIẾT)
  -> fact (nhánh shopify vào fact_sku_pnl_daily — CHƯA VIẾT)
  -> mart (view cho dashboard/agent — CHƯA VIẾT)
```

## Staging (9 bảng — đã viết)

| File | Grain | Ghi chú |
|---|---|---|
| `stg_shopify_orders` | 1 order (bản mới nhất) | loại test order |
| `stg_shopify_order_line_items` | 1 line item | UNNEST từ payload orders — dedupe TRƯỚC unnest |
| `stg_shopify_refunds` | 1 refund hoặc 1 cancellation | kèm order_total_price cho cancellation impact |
| `stg_shopify_tender_transactions` | 1 transaction | loại is_test |
| `stg_shopify_customers` | 1 customer (mới nhất) | **email hash SHA256, không plaintext PII** |
| `stg_shopify_inventory_levels` | 1 (sku, location, snapshot) | full time-series + cờ `is_latest` |
| `stg_shopify_inventory_item_costs` | 1 sku (snapshot mới nhất) | validate vs Airtable COGS |
| `stg_shopify_abandoned_checkouts` | 1 checkout (mới nhất) | header đầy đủ giống orders: subtotal/discount/duties/tax, billing+shipping geo, is_recovered, email_hash |
| `stg_shopify_abandoned_checkout_line_items` | 1 line item | UNNEST từ payload checkouts — product-signal: SKU nào bị bỏ giỏ, đã recover chưa |

## Quy tắc đã áp dụng

- Parse + dedupe trong 1 file (pattern Amazon), dedupe bằng `QUALIFY ROW_NUMBER()`
  theo business key parse từ payload, order by watermark trong payload rồi `_ingested_at`.
- `SAFE_CAST` cho mọi numeric/bool — field NULL/rỗng không làm vỡ pipeline
  (bài học `SAFE.PARSE_DATE` từ Amazon settlement).
- PII: plaintext CHỈ ở raw. Staging trở lên chỉ có `email_hash`.
- Mọi bảng có `brand` + `channel='shopify'` — sẵn cho fact_sku_pnl_daily đa kênh đa brand.

## Việc tiếp theo (master/fact — phiên sau)

- `master_*`: incremental merge, nhớ `pre_operations { CREATE TABLE IF NOT EXISTS ${self()} }`
  (bug incremental self-join first-run đã ghi nhận).
- Nhánh shopify vào `fact_sku_pnl_daily`: line items (revenue) - refunds - tender fee
  allocation - COGS (Airtable ưu tiên, stg_shopify_inventory_item_costs fallback).
- DQ assertion: so `stg_shopify_inventory_levels` (is_latest) vs `raw_lecangs_inventory`.
