# Tầng Assertion — afw-shopify-dataform

Bổ sung theo chuẩn pipeline Amazon (`afw_amazon_*`): ngoài `uniqueKey`, mỗi model có
`nonNull` + `rowConditions`, cộng thêm bộ **custom SQL assertion** bắt lỗi cấu trúc & vận hành.
Assertion FAIL (trả về ≥1 dòng) ⇒ Dataform dừng pipeline, không để mart tính trên data hỏng.

## 1. Inline assertions (trong config từng model)

Đã thêm vào **9 staging + 8 master**:
- `nonNull`: khóa nghiệp vụ + `brand`/`channel` bắt buộc. *Cố ý KHÔNG ép `sku` non-null ở
  `inventory_levels` / `inventory_item_costs` / `master_inventory*`* — vì 50% variant NULL sku
  (F5), sku là thuộc tính không phải khóa ở tầng đó.
- `rowConditions`: định dạng ID (`gid://shopify/...`), `channel='shopify'`, tiền ≥ 0 (dạng
  `x IS NULL OR x >= 0` để không phạt giá trị chưa có), `email_hash` đúng 64 ký tự, enum
  (`refund_type IN (...)`), tỷ trọng phân bổ trong `[0,1]`.
- Đã verify trên data thật 2026-07-13: **0 vi phạm** ⇒ không false-fire.

## 2. Custom SQL assertions (`type: "assertion"` → dataset `afw_shopify_assertions`)

| File | Bắt lỗi | Trên snapshot hiện tại |
|---|---|---|
| `assert_shopify_order_line_referential` | order_line mồ côi (order mất ở master) | ✅ pass (0) |
| `assert_shopify_discount_allocation_conserved` | Σ discount_alloc ≠ order discount (>1¢) | ✅ pass (0) |
| `assert_shopify_net_line_revenue_sane` | gross_share ∉ [0,1] hoặc net âm | ✅ pass (0) |
| `assert_shopify_sku_master_covers_sales` | SKU đã bán thiếu trong master_sku (→ COGS NULL) | 🔴 FIRE 2 SKU — F3/F5 |
| `assert_shopify_inventory_levels_present` | raw có variant nhưng staging levels = 0 | 🔴 FIRE — F2 (sync chưa lấy levels) |
| `assert_shopify_data_freshness` *(ops)* | bảng theo thời gian đứng yên quá ngưỡng | 🔴 FIRE (backfill 1 lần, cũ) |
| `assert_shopify_no_date_gaps` *(ops)* | thủng ngày trong chuỗi snapshot tồn kho | ⏸ chờ deploy master_snapshot |

**Các assertion FIRE là ĐÚNG THIẾT KẾ** — chúng phản ánh chính xác F2/F3 trong báo cáo
`docs/AFW_Shopify_DataQuality_Review_2026-07-13.md`. Sửa xong nguồn (InventorySync lấy levels,
bổ sung cost/SKU master) thì tự hết.

## 3. Quy ước tag

- `["shopify","assertion"]` — cấu trúc/toàn vẹn, **chạy trong build chuẩn** `--tags shopify`.
- `["shopify","assertion-ops"]` — freshness / date-gap, **CHỈ chạy ở môi trường có sync định kỳ**
  (loại khỏi build dev một-lần để tránh nhiễu). Chạy riêng: `dataform run --tags assertion-ops`.
- `["shopify","assertion","cost-coverage"]` — có thể tách chạy để theo dõi độ phủ cost.

## 4. Chạy

```bash
dataform run --tags shopify                 # gồm inline + custom assertion cấu trúc
dataform run --tags assertion-ops           # freshness + date gaps (môi trường prod/định kỳ)
dataform run --tags cost-coverage           # chỉ kiểm phủ COGS
```

## 5. Còn thiếu so với Amazon (roadmap)

- ~~Tách dataset master/fact/mart riêng~~ ✅ **ĐÃ LÀM**: master → `afw_shopify_master`,
  fact → `afw_shopify_fact`, mart → `afw_shopify_mart` (giống Amazon). Xem
  `docs/DEPLOY_split_and_fixes.md` để deploy.
- Master kiểu incremental upsert (Amazon) — Shopify vẫn `type: table` (volume nhỏ, cố ý).
- ⚠️ `stg_shopify_tender_transactions` mô tả "test đã bị loại tại đây" — cần rà đúng nguyên tắc 1
  (giữ `is_test` làm cột, lọc ở fact) như đã sửa cho orders.
