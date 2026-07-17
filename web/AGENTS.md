# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product requirements

- The ERP is multilingual by design. All new user-facing copy must be added through `src/i18n.jsx`; do not hardcode new UI strings in business components.
- Initial supported locales are Simplified Chinese (`zh-CN`), English (`en`), and Hungarian (`hu`). Missing keys intentionally fall back to Simplified Chinese.
- Overselling is a system requirement. Inventory may be negative; frontend sales flows must not block orders or stock-deduction actions because available stock is insufficient.
- The supported business currencies are fixed to HUF, EUR, and USD. Every product has an independent sales price in each currency, and sales flows must preserve the selected currency.
- Sales settlement is ledger-based: every cash or bank-transfer receipt is stored as an immutable payment record. Paid and due amounts and the unpaid/partial/paid status are derived from those records; they must never be manually toggled.
- Every saved scan-sale can carry a delivery contact phone, vehicle plate, delivery address, delivery date and notes. These fields must persist with the sale and remain available for an A4 delivery note and later reprints from the sales list.
- Main navigation uses browser-style page tabs. Opening a menu item preserves existing pages, tabs retain their local UI state while inactive, each business tab can be closed independently, and the dashboard tab remains fixed.
- Product images are stored as files in the persistent uploads volume while PostgreSQL stores only randomized image URLs. Keep image uploads limited to JPG, PNG and WebP up to 5 MB, and never embed image binaries in the database.
- Sales staff and administrators can open an existing order for editing from the sales-list action column; editing must reuse the scan-sale screen and update the original order rather than create a duplicate.
- The product list has user-selectable columns persisted in the browser. Selection only controls visibility; column order is always fixed as image, SKU, barcode, name, name 2, category, box size, HUF/EUR/USD prices, inbound quantity, net sales quantity, supplier, cost, current inventory, creation time and unit. The default view stays intentionally compact.
- The product-list toolbar uses a real category selector populated from existing product categories. Category and keyword filters can be combined; the generic placeholder selector must not appear on the product page.
- Product categories are managed on a dedicated two-level tree page. A category has a primary name, a secondary-language name, an optional parent main category and an optional persistent image; category renames must keep product category assignments in sync.
