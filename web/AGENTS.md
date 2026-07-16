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
- Every saved scan-sale can carry a delivery contact phone, vehicle plate, delivery address and delivery date. These fields must persist with the sale and remain available for an A4 delivery note and later reprints from the sales list.
