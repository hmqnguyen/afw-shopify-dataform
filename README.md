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

## Tầng master → fact → mart (afw_shopify_fact)

Toàn bộ 3 tầng nằm chung dataset `afw_shopify_fact` (giữ 4 dataset, phân biệt bằng prefix tên bảng),
tất cả là `type: table` (rebuild mỗi lần chạy — Shopify ~5% doanh số nên volume nhỏ, rebuild vừa đúng
vừa đơn giản, tránh bug incremental self-join; nếu volume lớn lên thì đổi sang `incremental` + thêm
`pre_operations { CREATE TABLE IF NOT EXISTS ${self()} }`).

**MASTER** (thực thể current-state, dedupe/conform):
- `master_shopify_order` — 1 dòng/đơn + refund tổng hợp + cờ trạng thái
- `master_shopify_order_line` — 1 dòng/line item + context đơn + **discount/refund đã phân bổ xuống dòng** (gross_share, discount_alloc, refund_alloc, net_line_revenue). NỀN SKU-level tái dùng cho mọi fact/phân tích tới SKU.
- `master_shopify_customer` — 1 dòng/khách + phân khúc + bucket LTV
- `master_shopify_sku` — 1 dòng/SKU: cost + giá + tên variant/product + tồn available hiện tại
- `master_shopify_inventory` — 1 dòng/SKU×location (snapshot is_latest)
- `master_shopify_abandoned_checkout_line` — 1 dòng/line item giỏ bỏ quên + context checkout. Nền phân tích SKU bị bỏ giỏ.

**FACT** (grain sự kiện):
- `fact_sku_pnl_daily` — P&L SKU×ngày. Build TRÊN `master_shopify_order_line` (allocation đã làm ở master)
  + `master_shopify_sku` (COGS). gateway_fee = NULL. Bảng RIÊNG Shopify; union cross-channel ở BI sau.
- `fact_inventory_daily` — tồn SKU×ngày (snapshot mới nhất/ngày, sum theo location)
- `fact_abandoned_checkout` — 1 dòng/giỏ bỏ quên + giá trị treo + thời gian recover

**MART** (report-ready, map 7 báo cáo wireframe):
- `mart_shopify_channel_overview` (SHOP-01) · `mart_shopify_sales_performance` (02)
- `mart_shopify_conversion_funnel` (03) · `mart_shopify_customer_360` (04)
- `mart_shopify_promo_discount` (05) · `mart_shopify_sku_pnl` (06) · `mart_shopify_inventory` (07)

Chưa dựng lần này: SHOP-08 (sales target — cần Airtable), cột đối soát Lecangs trong SHOP-07
(cần dataset Lecangs, cross-source — để NULL sẵn).

### Chạy theo tầng (tag)

```bash
dataform run --tags shopify              # toàn bộ
dataform run --tags staging              # chỉ staging
dataform run --tags master               # chỉ master
dataform run --tags fact                 # chỉ fact
dataform run --tags mart                 # chỉ mart
```

DAG: raw → staging → master → fact → mart (Dataform tự resolve thứ tự qua `ref()`).
