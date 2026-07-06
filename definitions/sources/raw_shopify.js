// Khai báo 7 bảng raw (payload-only) do afw-shopify-sync (C#) ghi vào.
// Dataset raw đặt tên theo convention mỗi-kênh-một-dataset (khớp afw_amazon_raw của AfwAmazonSync).
const RAW_SCHEMA = "afw_shopify_raw";

[
  "raw_shopify_orders",
  "raw_shopify_refunds",
  "raw_shopify_tender_transactions",
  "raw_shopify_customers",
  "raw_shopify_inventory_levels",
  "raw_shopify_inventory_item_costs",
  "raw_shopify_abandoned_checkouts",
].forEach((name) => declare({ schema: RAW_SCHEMA, name }));
