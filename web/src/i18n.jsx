import { createContext, useContext, useMemo, useState } from "react";

export const locales = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "hu", label: "Magyar" },
];

const messages = {
  "zh-CN": {
    appName: "云链 ERP", tagline: "让生意尽在掌握", loginTitle: "采购商的数字化工作台",
    loginDescription: "商品、采购、库存、销售和财务数据实时协同", nasEdition: "群晖 NAS 私有化部署版",
    username: "用户名", password: "密码", login: "登录", logout: "退出", signingIn: "正在登录…",
    loginRequired: "请输入用户名和密码", invalidCredentials: "用户名或密码错误", loginFailed: "登录失败，请检查账号、密码和网络连接", secureLoginNote: "请使用 NAS 管理员配置的账号登录",
    dashboard: "首页", control: "主控", goods: "货物", products: "产品", purchase: "入库", inventory: "库存",
    categories: "分类&标签", customers: "客户", customerList: "客户列表", customerAccounts: "客户账目",
    sales: "销售", salesList: "销售单列表", scanRetail: "扫码零售", scanSales: "扫码销售", collectorSales: "采集器销售", collectorWarehouse: "仓库", returns: "退货",
    bulkImport: "批量导入", excelImport: "Excel导入", currencyChoice: "货币选择", salesNote: "备注", commaDelimiter: "逗号分隔", spaceDelimiter: "空格分隔", optionalField: "可选字段", boxCount: "箱数", packCount: "包数", inputFormat: "输入格式", inputContent: "输入内容", collectorCommaFormat: "货号/条码,个数", collectorSpaceFormat: "货号/条码 个数", collectorInputPlaceholder: "请粘贴或扫描内容，每行一条记录", checkGoods: "检查货物", importOrder: "导入", resetImport: "重置", collectorInputRequired: "请先输入扫描记录", collectorInvalidFormat: "格式错误，请按所选分隔方式输入货号/条码和个数", collectorInvalidQuantity: "个数必须是非零整数", collectorProductNotFound: "未找到商品", collectorZeroCombinedQuantity: "同一商品合并后的个数不能为 0", collectorTooManyProducts: "一次最多导入 200 种商品", collectorCheckFirst: "请先检查货物", collectorFixErrors: "请先修正检查结果中的错误", collectorImportSuccess: "销售单已生成", collectorImportFailed: "导入失败", collectorCheckErrors: "检查发现错误", collectorCheckPassed: "检查通过，可以导入", collectorRecords: "条记录", collectorProducts: "种商品", lineNumber: "行号",
    finance: "财务", invoice: "发票", invoiceList: "发票列表", issueInvoice: "开票", reports: "报表",
    cloudStore: "App/云店", cloudProducts: "云店产品", cloudSettings: "云店设置", settings: "设置",
    smartPurchase: "智能采购", operatingControl: "经营主控", flowDetails: "流水明细", orderFinance: "订单财务",
    search: "搜索", refresh: "刷新", add: "新增", select: "请选择", all: "全部", cancel: "取消", save: "保存",
    newProduct: "新增产品", newCustomer: "新增客户", createPurchase: "新建采购入库单", saveOrder: "保存订单",
    clear: "清空", customer: "客户", total: "合计", noData: "暂无数据", actions: "操作",
    todaySales: "今日销售", inventoryCost: "库存成本", activeCustomers: "活跃客户", newArrival: "新品入库",
    salesReport: "销售报表", recentSales: "最近销售", sevenDayTrend: "近 7 日销售趋势",
    loadingProducts: "正在加载商品…", saving: "正在保存…", productsLoadFailed: "商品加载失败", retry: "重试", productCreateFailed: "商品保存失败", requiredProductFields: "请填写货号和产品名称",
    dataLoadFailed: "数据加载失败", supplier: "供货商", warehouseLabel: "入库仓库", product: "商品", quantity: "数量", unitCost: "采购单价",
    requiredPurchaseFields: "请填写供货商，并检查所有商品的数量和单价", purchaseCreateFailed: "采购入库失败", duplicatePurchaseProduct: "同一商品不能重复添加，请合并数量", purchaseItems: "采购明细", addLine: "添加商品", removeLine: "删除此行", lineTotal: "小计", purchaseTotal: "采购总价", noProductsForPurchase: "请先创建商品", mainWarehouse: "主仓库", storeWarehouse: "门店仓", customerName: "客户名称", phone: "电话", city: "城市", address: "地址",
    requiredCustomerName: "请填写客户名称", customerCreateFailed: "客户保存失败", walkInCustomer: "散客", orderSaved: "订单已保存，库存已同步扣减", saleSaveFailed: "销售单保存失败",
    systemSettings: "系统设置", employeeManagement: "员工与权限", employeeAccessDescription: "账号、角色与访问权限", addUser: "新增员工", displayName: "显示名称", role: "角色", statusLabel: "状态", lastLogin: "最后登录",
    enabled: "启用", disabled: "停用", userRequirements: "请填写用户名和至少 8 位密码", userCreateFailed: "员工账号创建失败",
    details: "详情", searchSales: "搜索销售单号、客户或销售员", salesOrderNo: "销售单号", orderDate: "订单日期", salesperson: "销售员", itemDetails: "详情", stockDeducted: "已扣库", delivered: "已送货", settlementStatus: "结算状态", completed: "已完成", pending: "未完成", markCompleted: "点击标记为已完成", markPending: "点击标记为未完成", statusUpdateFailed: "状态更新失败", startDate: "起始日期", endDate: "结束日期", queryDateRange: "查询日期", clearDateRange: "清除日期", invalidDateRange: "起始日期不能晚于结束日期", saleDetails: "销售单详情", loading: "正在加载…", salesTotal: "销售总价", returnedTotal: "已退金额", quantitySold: "售出数量", returnedQuantity: "已退数量", returnableQuantity: "可退数量", unitPrice: "销售单价", returnNow: "本次退货", returnReason: "退货原因", returnReasonPlaceholder: "选填，例如质量问题", returnTotal: "本次退款", confirmReturn: "确认退货入库", selectReturnItems: "请至少填写一项退货数量", returnQuantityExceeded: "退货数量不能超过可退数量", returnFailed: "退货失败", returnHistory: "退货记录", saleStatusCompleted: "已完成", saleStatusPartiallyReturned: "部分退货", saleStatusReturned: "已退货",
    edit: "编辑", editProduct: "编辑产品", productDetails: "产品详情", productSku: "货号", productBarcode: "条码", productName: "产品名称", productCategory: "分类", productUnit: "单位", productBoxSize: "箱装数", productCost: "采购成本", productPrice: "销售价格", currentStock: "当前库存", createdAt: "创建时间", updatedAt: "更新时间", inventoryMovements: "最近库存流水", dateTime: "时间", movementType: "流水类型", referenceNo: "关联单号", operator: "操作人", noInventoryMovements: "暂无库存流水", stockManagedByMovements: "库存由入库和销售流水管理，不能在产品资料中直接修改", invalidProductFields: "请填写货号和产品名称，并检查箱装数、成本和售价", productSaveFailed: "产品保存失败", movement_purchase: "采购入库", movement_sale: "销售出库", movement_sale_return: "历史退货入库", movement_sale_status_deduct: "销售扣库", movement_sale_status_restore: "销售恢复库存",
    role_admin: "管理员", role_purchasing: "采购", role_warehouse: "仓库", role_sales: "销售", role_finance: "财务",
  },
  en: {
    appName: "CloudLink ERP", tagline: "Your business, under control", loginTitle: "The digital workspace for buyers",
    loginDescription: "Products, purchasing, inventory, sales and finance in real time", nasEdition: "Synology NAS private deployment",
    username: "Username", password: "Password", login: "Sign in", logout: "Sign out", signingIn: "Signing in…",
    loginRequired: "Enter your username and password", invalidCredentials: "Incorrect username or password", loginFailed: "Sign-in failed. Check your credentials and network connection.", secureLoginNote: "Use the account configured by your NAS administrator",
    dashboard: "Dashboard", control: "Control", goods: "Goods", products: "Products", purchase: "Purchasing", inventory: "Inventory",
    categories: "Categories & tags", customers: "Customers", customerList: "Customer list", customerAccounts: "Customer accounts",
    sales: "Sales", salesList: "Sales orders", scanRetail: "Scan retail", scanSales: "Scan sale", collectorSales: "Collector sales", collectorWarehouse: "Warehouse", returns: "Returns",
    bulkImport: "Bulk import", excelImport: "Excel import", currencyChoice: "Currency", salesNote: "Notes", commaDelimiter: "Comma separated", spaceDelimiter: "Space separated", optionalField: "Optional fields", boxCount: "Boxes", packCount: "Packs", inputFormat: "Input format", inputContent: "Input content", collectorCommaFormat: "SKU/barcode,quantity", collectorSpaceFormat: "SKU/barcode quantity", collectorInputPlaceholder: "Paste or scan one record per line", checkGoods: "Check goods", importOrder: "Import", resetImport: "Reset", collectorInputRequired: "Enter scanner records first", collectorInvalidFormat: "Invalid format for the selected delimiter", collectorInvalidQuantity: "Quantity must be a non-zero integer", collectorProductNotFound: "Product not found", collectorZeroCombinedQuantity: "Combined quantity for a product cannot be zero", collectorTooManyProducts: "A maximum of 200 products can be imported", collectorCheckFirst: "Check the goods first", collectorFixErrors: "Fix the errors in the check results first", collectorImportSuccess: "Sales order created", collectorImportFailed: "Import failed", collectorCheckErrors: "Errors found", collectorCheckPassed: "Check passed; ready to import", collectorRecords: "records", collectorProducts: "products", lineNumber: "Line",
    finance: "Finance", invoice: "Invoices", invoiceList: "Invoice list", issueInvoice: "Create invoice", reports: "Reports",
    cloudStore: "App / Store", cloudProducts: "Store products", cloudSettings: "Store settings", settings: "Settings",
    smartPurchase: "Smart purchasing", operatingControl: "Operations", flowDetails: "Transactions", orderFinance: "Order finance",
    search: "Search", refresh: "Refresh", add: "Add", select: "Select", all: "All", cancel: "Cancel", save: "Save",
    newProduct: "New product", newCustomer: "New customer", createPurchase: "New purchase receipt", saveOrder: "Save order",
    clear: "Clear", customer: "Customer", total: "Total", noData: "No data", actions: "Actions",
    todaySales: "Today's sales", inventoryCost: "Inventory cost", activeCustomers: "Active customers", newArrival: "New arrival",
    salesReport: "Sales report", recentSales: "Recent sales", sevenDayTrend: "7-day sales trend",
    loadingProducts: "Loading products…", saving: "Saving…", productsLoadFailed: "Could not load products", retry: "Retry", productCreateFailed: "Could not save product", requiredProductFields: "Enter a SKU and product name",
    dataLoadFailed: "Could not load data", supplier: "Supplier", warehouseLabel: "Receiving warehouse", product: "Product", quantity: "Quantity", unitCost: "Unit cost",
    requiredPurchaseFields: "Enter a supplier and check every item's quantity and cost", purchaseCreateFailed: "Could not receive purchase", duplicatePurchaseProduct: "Each product can only appear once; combine its quantity", purchaseItems: "Purchase items", addLine: "Add product", removeLine: "Remove line", lineTotal: "Subtotal", purchaseTotal: "Purchase total", noProductsForPurchase: "Create a product first", mainWarehouse: "Main warehouse", storeWarehouse: "Store warehouse", customerName: "Customer name", phone: "Phone", city: "City", address: "Address",
    requiredCustomerName: "Enter a customer name", customerCreateFailed: "Could not save customer", walkInCustomer: "Walk-in customer", orderSaved: "Order saved and inventory updated", saleSaveFailed: "Could not save sales order",
    systemSettings: "System settings", employeeManagement: "Employees & access", employeeAccessDescription: "Accounts, roles and access", addUser: "Add employee", displayName: "Display name", role: "Role", statusLabel: "Status", lastLogin: "Last login",
    enabled: "Enabled", disabled: "Disabled", userRequirements: "Enter a username and a password of at least 8 characters", userCreateFailed: "Could not create employee account",
    details: "Details", searchSales: "Search order, customer or salesperson", salesOrderNo: "Sales order", orderDate: "Order date", salesperson: "Salesperson", itemDetails: "Details", stockDeducted: "Stock deducted", delivered: "Delivered", settlementStatus: "Settlement", completed: "Completed", pending: "Pending", markCompleted: "Click to mark completed", markPending: "Click to mark pending", statusUpdateFailed: "Could not update status", startDate: "Start date", endDate: "End date", queryDateRange: "Search dates", clearDateRange: "Clear dates", invalidDateRange: "Start date cannot be after end date", saleDetails: "Sales order details", loading: "Loading…", salesTotal: "Sales total", returnedTotal: "Returned total", quantitySold: "Sold", returnedQuantity: "Returned", returnableQuantity: "Returnable", unitPrice: "Unit price", returnNow: "Return now", returnReason: "Return reason", returnReasonPlaceholder: "Optional, for example damaged goods", returnTotal: "Refund total", confirmReturn: "Confirm return", selectReturnItems: "Enter a return quantity for at least one item", returnQuantityExceeded: "Return quantity exceeds the available quantity", returnFailed: "Return failed", returnHistory: "Return history", saleStatusCompleted: "Completed", saleStatusPartiallyReturned: "Partially returned", saleStatusReturned: "Returned",
    edit: "Edit", editProduct: "Edit product", productDetails: "Product details", productSku: "SKU", productBarcode: "Barcode", productName: "Product name", productCategory: "Category", productUnit: "Unit", productBoxSize: "Units per box", productCost: "Purchase cost", productPrice: "Sales price", currentStock: "Current stock", createdAt: "Created", updatedAt: "Updated", inventoryMovements: "Recent inventory movements", dateTime: "Date and time", movementType: "Movement type", referenceNo: "Reference", operator: "Operator", noInventoryMovements: "No inventory movements", stockManagedByMovements: "Stock is managed by purchase and sales movements and cannot be edited here", invalidProductFields: "Enter a SKU and product name, then check box size, cost and price", productSaveFailed: "Could not save product", movement_purchase: "Purchase receipt", movement_sale: "Sale", movement_sale_return: "Legacy sales return", movement_sale_status_deduct: "Sales stock deduction", movement_sale_status_restore: "Sales stock restore",
    role_admin: "Administrator", role_purchasing: "Purchasing", role_warehouse: "Warehouse", role_sales: "Sales", role_finance: "Finance",
  },
  hu: {
    appName: "CloudLink ERP", tagline: "Az üzlet mindig kézben", loginTitle: "Digitális munkatér beszerzőknek",
    loginDescription: "Termékek, beszerzés, készlet, értékesítés és pénzügy valós időben", nasEdition: "Privát Synology NAS telepítés",
    username: "Felhasználónév", password: "Jelszó", login: "Bejelentkezés", logout: "Kijelentkezés", signingIn: "Bejelentkezés…",
    loginRequired: "Adja meg a felhasználónevet és a jelszót", invalidCredentials: "Hibás felhasználónév vagy jelszó", loginFailed: "A bejelentkezés sikertelen. Ellenőrizze az adatokat és a hálózatot.", secureLoginNote: "Használja a NAS rendszergazdája által beállított fiókot",
    dashboard: "Kezdőlap", control: "Vezérlés", goods: "Áruk", products: "Termékek", purchase: "Beszerzés", inventory: "Készlet",
    categories: "Kategóriák és címkék", customers: "Vevők", customerList: "Vevőlista", customerAccounts: "Vevői számlák",
    sales: "Értékesítés", salesList: "Értékesítési rendelések", scanRetail: "Vonalkódos kisker.", scanSales: "Vonalkódos eladás", collectorSales: "Adatgyűjtős eladás", collectorWarehouse: "Raktár", returns: "Visszáru",
    bulkImport: "Tömeges import", excelImport: "Excel-import", currencyChoice: "Pénznem", salesNote: "Megjegyzés", commaDelimiter: "Vesszővel elválasztva", spaceDelimiter: "Szóközzel elválasztva", optionalField: "Választható mezők", boxCount: "Doboz", packCount: "Csomag", inputFormat: "Beviteli formátum", inputContent: "Beviteli tartalom", collectorCommaFormat: "Cikkszám/vonalkód,mennyiség", collectorSpaceFormat: "Cikkszám/vonalkód mennyiség", collectorInputPlaceholder: "Illessze be vagy olvassa be a rekordokat, soronként egyet", checkGoods: "Áru ellenőrzése", importOrder: "Importálás", resetImport: "Visszaállítás", collectorInputRequired: "Előbb adja meg a leolvasott rekordokat", collectorInvalidFormat: "A formátum nem felel meg a kiválasztott elválasztónak", collectorInvalidQuantity: "A mennyiség nem nulla egész szám legyen", collectorProductNotFound: "A termék nem található", collectorZeroCombinedQuantity: "Az összevont mennyiség nem lehet nulla", collectorTooManyProducts: "Legfeljebb 200 termék importálható", collectorCheckFirst: "Előbb ellenőrizze az árut", collectorFixErrors: "Előbb javítsa az ellenőrzési hibákat", collectorImportSuccess: "Az értékesítési rendelés elkészült", collectorImportFailed: "Az import sikertelen", collectorCheckErrors: "Az ellenőrzés hibákat talált", collectorCheckPassed: "Az ellenőrzés sikeres; importálható", collectorRecords: "rekord", collectorProducts: "termék", lineNumber: "Sor",
    finance: "Pénzügy", invoice: "Számlák", invoiceList: "Számlalista", issueInvoice: "Számlázás", reports: "Kimutatások",
    cloudStore: "App / Webshop", cloudProducts: "Webshop termékek", cloudSettings: "Webshop beállítások", settings: "Beállítások",
    smartPurchase: "Intelligens beszerzés", operatingControl: "Működési vezérlés", flowDetails: "Tranzakciók", orderFinance: "Rendelések pénzügyei",
    search: "Keresés", refresh: "Frissítés", add: "Új", select: "Válasszon", all: "Összes", cancel: "Mégse", save: "Mentés",
    newProduct: "Új termék", newCustomer: "Új vevő", createPurchase: "Új beszerzési bevét", saveOrder: "Rendelés mentése",
    clear: "Törlés", customer: "Vevő", total: "Összesen", noData: "Nincs adat", actions: "Műveletek",
    todaySales: "Mai értékesítés", inventoryCost: "Készletérték", activeCustomers: "Aktív vevők", newArrival: "Új bevételezés",
    salesReport: "Értékesítési riport", recentSales: "Legutóbbi eladások", sevenDayTrend: "7 napos értékesítési trend",
    loadingProducts: "Termékek betöltése…", saving: "Mentés…", productsLoadFailed: "A termékek betöltése sikertelen", retry: "Újra", productCreateFailed: "A termék mentése sikertelen", requiredProductFields: "Adja meg a cikkszámot és a termék nevét",
    dataLoadFailed: "Az adatok betöltése sikertelen", supplier: "Beszállító", warehouseLabel: "Bevételezési raktár", product: "Termék", quantity: "Mennyiség", unitCost: "Beszerzési egységár",
    requiredPurchaseFields: "Adjon meg beszállítót, és ellenőrizze minden tétel mennyiségét és árát", purchaseCreateFailed: "A bevételezés sikertelen", duplicatePurchaseProduct: "Egy termék csak egyszer szerepelhet; vonja össze a mennyiséget", purchaseItems: "Beszerzési tételek", addLine: "Termék hozzáadása", removeLine: "Sor törlése", lineTotal: "Részösszeg", purchaseTotal: "Beszerzés összesen", noProductsForPurchase: "Előbb hozzon létre terméket", mainWarehouse: "Főraktár", storeWarehouse: "Üzleti raktár", customerName: "Vevő neve", phone: "Telefon", city: "Város", address: "Cím",
    requiredCustomerName: "Adja meg a vevő nevét", customerCreateFailed: "A vevő mentése sikertelen", walkInCustomer: "Alkalmi vevő", orderSaved: "A rendelés mentve, a készlet frissítve", saleSaveFailed: "Az értékesítési rendelés mentése sikertelen",
    systemSettings: "Rendszerbeállítások", employeeManagement: "Munkatársak és jogosultságok", employeeAccessDescription: "Fiókok, szerepkörök és hozzáférés", addUser: "Munkatárs hozzáadása", displayName: "Megjelenített név", role: "Szerepkör", statusLabel: "Állapot", lastLogin: "Utolsó belépés",
    enabled: "Aktív", disabled: "Letiltva", userRequirements: "Adjon meg felhasználónevet és legalább 8 karakteres jelszót", userCreateFailed: "A munkatársi fiók létrehozása sikertelen",
    details: "Részletek", searchSales: "Rendelés, vevő vagy értékesítő keresése", salesOrderNo: "Értékesítési rendelés", orderDate: "Rendelés dátuma", salesperson: "Értékesítő", itemDetails: "Részletek", stockDeducted: "Készlet levonva", delivered: "Kiszállítva", settlementStatus: "Elszámolás", completed: "Kész", pending: "Függőben", markCompleted: "Kattintson a befejezéshez", markPending: "Kattintson a visszaállításhoz", statusUpdateFailed: "Az állapot frissítése sikertelen", startDate: "Kezdő dátum", endDate: "Záró dátum", queryDateRange: "Dátumok keresése", clearDateRange: "Dátumok törlése", invalidDateRange: "A kezdő dátum nem lehet későbbi a záró dátumnál", saleDetails: "Rendelés részletei", loading: "Betöltés…", salesTotal: "Értékesítés összesen", returnedTotal: "Visszatérített összeg", quantitySold: "Eladott", returnedQuantity: "Visszavett", returnableQuantity: "Visszavehető", unitPrice: "Egységár", returnNow: "Most visszavéve", returnReason: "Visszáru oka", returnReasonPlaceholder: "Nem kötelező, például sérült áru", returnTotal: "Visszatérítés", confirmReturn: "Visszáru megerősítése", selectReturnItems: "Adjon meg visszáru mennyiséget legalább egy tételnél", returnQuantityExceeded: "A visszáru mennyisége meghaladja a visszavehető mennyiséget", returnFailed: "A visszáru sikertelen", returnHistory: "Visszáru előzmények", saleStatusCompleted: "Teljesítve", saleStatusPartiallyReturned: "Részben visszavéve", saleStatusReturned: "Visszavéve",
    edit: "Szerkesztés", editProduct: "Termék szerkesztése", productDetails: "Termék részletei", productSku: "Cikkszám", productBarcode: "Vonalkód", productName: "Terméknév", productCategory: "Kategória", productUnit: "Egység", productBoxSize: "Darab dobozonként", productCost: "Beszerzési költség", productPrice: "Eladási ár", currentStock: "Aktuális készlet", createdAt: "Létrehozva", updatedAt: "Frissítve", inventoryMovements: "Legutóbbi készletmozgások", dateTime: "Időpont", movementType: "Mozgás típusa", referenceNo: "Hivatkozás", operator: "Kezelő", noInventoryMovements: "Nincs készletmozgás", stockManagedByMovements: "A készletet a beszerzési és értékesítési mozgások kezelik, itt nem módosítható", invalidProductFields: "Adja meg a cikkszámot és a termék nevét, majd ellenőrizze a dobozméretet, költséget és árat", productSaveFailed: "A termék mentése sikertelen", movement_purchase: "Beszerzési bevét", movement_sale: "Értékesítés", movement_sale_return: "Korábbi visszáru", movement_sale_status_deduct: "Értékesítési készletlevonás", movement_sale_status_restore: "Értékesítési készlet-visszaállítás",
    role_admin: "Rendszergazda", role_purchasing: "Beszerzés", role_warehouse: "Raktár", role_sales: "Értékesítés", role_finance: "Pénzügy",
  },
};

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => localStorage.getItem("erp-locale") || "zh-CN");
  const setLocale = (next) => { localStorage.setItem("erp-locale", next); setLocaleState(next); };
  const value = useMemo(() => ({
    locale,
    locales,
    setLocale,
    t: (key, fallback) => messages[locale]?.[key] ?? messages["zh-CN"]?.[key] ?? fallback ?? key,
  }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useI18n must be used inside LocaleProvider");
  return context;
}

// Add a locale by extending `locales` and `messages`. Missing keys automatically
// fall back to Simplified Chinese, so partial translations are safe to ship.
