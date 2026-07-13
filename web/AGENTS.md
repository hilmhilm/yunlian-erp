# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product requirements

- The ERP is multilingual by design. All new user-facing copy must be added through `src/i18n.jsx`; do not hardcode new UI strings in business components.
- Initial supported locales are Simplified Chinese (`zh-CN`), English (`en`), and Hungarian (`hu`). Missing keys intentionally fall back to Simplified Chinese.
