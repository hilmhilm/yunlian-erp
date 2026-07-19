# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product requirements

- Every completed code update must increment the visible `uiVersion` in `src/App.jsx`. The handoff must explicitly state which containers need rebuilding (`web`, `api`, or both) and whether an automatic database migration is included.
- The ERP is multilingual by design. All new user-facing copy must be added through `src/i18n.jsx`; do not hardcode new UI strings in business components.
- Initial supported locales are Simplified Chinese (`zh-CN`), English (`en`), and Hungarian (`hu`). Missing keys intentionally fall back to Simplified Chinese.
- Overselling is controlled by the administrator's basic-information setting and defaults to enabled. When enabled inventory may be negative; when disabled the backend must prevent every sales action that would reduce stock below zero.
- The left navigation must not contain the obsolete “Control” group. Basic information settings are real persisted business configuration covering company details, HUF exchange rates, default sales currency, overselling, low-stock threshold, default warehouse and sales/purchase document prefixes.
- The obsolete “App / Store” navigation group and its child pages must not appear in the left navigation.
- The Sales menu includes a warehouse picking-list page for administrators and warehouse staff. It is strictly read-only, uses a restricted API, supports date filtering, order detail and printing, and must never expose current stock, currency, prices, totals, payments, sales statuses or editing controls.
- Delivery-note printing has a browser-persisted field selector for SKU, barcode, product name, product name 2, current stock, quantity, unit price and line total. Picking-list printing may reuse it but must always exclude current stock and all financial fields.
- The supported business currencies are fixed to HUF, EUR, and USD. Every product has an independent sales price in each currency, and sales flows must preserve the selected currency.
- Sales settlement is ledger-based: every cash or bank-transfer receipt is stored as an immutable payment record. Paid and due amounts and the unpaid/partial/paid status are derived from those records; they must never be manually toggled.
- Every saved scan-sale can carry a delivery contact phone, vehicle plate, delivery address, delivery date and notes. These fields must persist with the sale and remain available for an A4 delivery note and later reprints from the sales list.
- Main navigation uses browser-style page tabs. Opening a menu item preserves existing pages, tabs retain their local UI state while inactive, each business tab can be closed independently, and the dashboard tab remains fixed.
- Product images are stored as files in the persistent uploads volume while PostgreSQL stores only randomized image URLs. Keep image uploads limited to JPG, PNG and WebP up to 5 MB, and never embed image binaries in the database.
- Sales staff and administrators can open an existing order for editing from the sales-list action column; editing must reuse the scan-sale screen and update the original order rather than create a duplicate.
- The product list has user-selectable columns persisted in the browser. Selection only controls visibility; column order is always fixed as image, SKU, barcode, name, name 2, category, box size, HUF/EUR/USD prices, inbound quantity, net sales quantity, supplier, cost, current inventory, creation time and unit. The default view stays intentionally compact.
- The product-list toolbar uses a real category selector populated from existing product categories. Category and keyword filters can be combined; the generic placeholder selector must not appear on the product page.
- Product categories are managed on a dedicated two-level tree page. A category has a primary name, a secondary-language name, an optional parent main category and an optional persistent image; category renames must keep product category assignments in sync.
- Product and category edit dialogs must allow an existing image to be deleted after confirmation. Deletion clears the stored URL and removes the corresponding file from the persistent uploads volume.
- Product-list filtering uses linked main-category and subcategory selectors. Selecting only a main category includes that category and all direct children. Product create/edit forms must select an existing category and must not accept arbitrary category text.
- The Customers navigation group contains only the customer list; the obsolete customer-accounts menu item must not appear.
- Számlázz.hu invoicing is server-side and uses only the NAS `SZAMLAZZ_AGENT_KEY` environment variable. Sales prices are net, invoice VAT is fixed at 27%, e-invoices are not emailed to buyers, and authenticated users can print or download the stored PDF. The invoice dialog shows the original sales-order net unit price as read-only and a separate editable invoice unit price. Whole-order factors are entered and displayed only as percentages, then converted to a decimal API factor. Invoice pricing must not modify the sale or inventory. An issued or attempted invoice locks the related sale against editing.
