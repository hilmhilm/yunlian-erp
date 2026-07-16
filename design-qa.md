# Design QA — 销售单列表

- source visual truth path: `C:/Users/Akos/AppData/Local/Temp/codex-clipboard-22bd19cb-f37a-4e93-862f-7a19cfd3c843.png`
- implementation screenshot path: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/sales-list-implementation.png`
- full-view comparison evidence: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/sales-list-comparison.png`
- focused region comparison evidence: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/sales-list-focused-comparison.png`
- viewport: 1654 × 900 desktop
- state: authenticated sales-order list with three populated orders and mixed completion states

**Findings**

- No actionable P0/P1/P2 visual differences remain for the requested sales-list scope.
- Fonts and typography: the existing Microsoft YaHei / Noto Sans SC / Arial stack preserves the reference's compact Chinese ERP typography, readable numeric emphasis, short labels, and single-line headers. The implementation intentionally keeps the product's established font stack.
- Spacing and layout rhythm: the search band, date band, dense grid, 45px rows, narrow status columns, detail-count badges and centered action column closely follow the reference. The existing application sidebar and header remain because the supplied image represents only the content region.
- Colors and visual tokens: pale grey workspace, white filter bands, fine blue-grey borders, alternating rows, blue detail badges, dark navy completion circles and coral-red incomplete circles match the supplied reference.
- Image quality and asset fidelity: the screen contains no raster imagery. UI actions use the project's existing Lucide icon library; no text glyph, emoji, CSS drawing or handcrafted SVG substitutes were introduced.
- Copy and content: order number, database ID, order date, salesperson, customer, detail count, quantity, total, stock deduction, delivery and settlement columns match the requested workflow. Unsupported payment/arrears/remarks columns from the reference were intentionally omitted because the current data model does not yet provide those records.

**Interaction and runtime checks**

- Login and sales-list navigation completed successfully in the in-app browser.
- All nine status controls rendered with accessible completed/pending labels.
- The first row's delivery state was clicked from incomplete to complete and the UI updated successfully.
- Date-range controls and sales-detail action remained visible and usable.
- Browser console errors checked: none.

**Comparison history**

- Initial implementation was compared with the supplied reference using both a full content-region composite and a focused table composite.
- No P0/P1/P2 correction loop was required. The retained application shell and omitted unsupported financial columns are intentional product constraints, not visual regressions.

**Follow-up Polish**

- P3: add payment amount, arrears and remarks columns when their accounting data model is implemented.
- P3: add sortable column headers after server-side ordering is available.

final result: passed

---

# Design QA — 销售订单结算

- source visual truth path: `C:/Users/Akos/AppData/Local/Temp/codex-clipboard-485ffefb-bf68-45f0-975b-2ebc317a1fbe.png`
- implementation screenshot path: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/settlement-implementation.png`
- comparison evidence: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/settlement-comparison.png`
- state: authenticated user on an unpaid sales order, with real amount, currency and customer fields

**Findings**

- No actionable P0/P1/P2 visual differences remain for the requested settlement scope.
- The compact title, order summary, booking date, finance category, receipt amount and footer actions follow the reference while retaining the ERP application shell.
- Cash and bank-transfer receipts, partial/full settlement and payment history are real interactive controls backed by the payment API.
- The sales list now shows paid and due columns plus red unpaid, yellow partial and blue paid status icons.
- Icons use the existing Lucide library and all new copy is localized for Simplified Chinese, English and Hungarian.

**Interaction and runtime checks**

- Verified a HUF order from 57,000 Ft paid / 100,365 Ft due through a 50,000 Ft bank-transfer receipt.
- Confirmed the list updated to 107,000 Ft paid / 50,365 Ft due and retained the yellow partial status.
- Reopened the same order, paid the exact remainder, and confirmed 157,365 Ft paid / 0 Ft due with the blue paid status.
- Confirmed the unpaid order opens directly from its red status icon.

final result: passed

---

# Design QA — 采集器销售

- source visual truth path: `C:/Users/Akos/AppData/Local/Temp/codex-clipboard-2e9f0dca-4871-4837-8385-73e9960b142e.png`
- implementation screenshot path: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/collector-implementation.png`
- comparison evidence: `C:/Users/Akos/.codex/visualizations/2026/07/14/019f5fdb-4a40-7ae1-9934-59d0a30a559c/collector-comparison.png`
- viewport: 1655 × 567 desktop
- state: authenticated sales user on the empty collector-import form

**Findings**

- No actionable P0/P1/P2 visual differences remain for the requested collector-sales scope.
- The implementation follows the reference's compact two-tab header, aligned label/control rows, delimiter selector, segmented optional-field control, red format hint, large scanner input, two-step buttons, reset action and progress bar.
- The existing ERP sidebar, sticky header and page tabs are intentionally retained. The reference depicts only a content area, while this implementation is integrated into the established application shell.
- The product currently has one warehouse and one accounting currency, so those selectors truthfully show the fixed main warehouse and HUF instead of presenting non-functional options.
- All visible icons use the existing Lucide library; the screen requires no raster assets.

**Interaction and runtime checks**

- Confirmed the sales menu contains only “扫码销售” plus the new “采集器销售”; the duplicate “扫码零售” item is absent.
- Checked three realistic records by barcode/SKU, including a negative quantity. All products matched and the preview totals were correct.
- Imported the checked records through the real sales client flow; order `Vs20260715-4` was returned by the local integration fixture and inventory changed in the expected direction.
- Import remains disabled before a successful check, and the progress state moved from 0% to 50% to 100%.
- Browser console errors checked: none.

final result: passed
