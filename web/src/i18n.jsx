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
    sales: "销售", salesList: "销售单列表", scanRetail: "扫码零售", scanSales: "扫码销售", returns: "退货",
    finance: "财务", invoice: "发票", invoiceList: "发票列表", issueInvoice: "开票", reports: "报表",
    cloudStore: "App/云店", cloudProducts: "云店产品", cloudSettings: "云店设置", settings: "设置",
    smartPurchase: "智能采购", operatingControl: "经营主控", flowDetails: "流水明细", orderFinance: "订单财务",
    search: "搜索", refresh: "刷新", add: "新增", select: "请选择", all: "全部", cancel: "取消", save: "保存",
    newProduct: "新增产品", newCustomer: "新增客户", createPurchase: "新建采购入库单", saveOrder: "保存订单",
    clear: "清空", customer: "客户", total: "合计", noData: "暂无数据", actions: "操作",
    todaySales: "今日销售", inventoryCost: "库存成本", activeCustomers: "活跃客户", newArrival: "新品入库",
    salesReport: "销售报表", recentSales: "最近销售", sevenDayTrend: "近 7 日销售趋势",
    loadingProducts: "正在加载商品…", saving: "正在保存…", productsLoadFailed: "商品加载失败", retry: "重试", productCreateFailed: "商品保存失败", requiredProductFields: "请填写货号和产品名称",
  },
  en: {
    appName: "CloudLink ERP", tagline: "Your business, under control", loginTitle: "The digital workspace for buyers",
    loginDescription: "Products, purchasing, inventory, sales and finance in real time", nasEdition: "Synology NAS private deployment",
    username: "Username", password: "Password", login: "Sign in", logout: "Sign out", signingIn: "Signing in…",
    loginRequired: "Enter your username and password", invalidCredentials: "Incorrect username or password", loginFailed: "Sign-in failed. Check your credentials and network connection.", secureLoginNote: "Use the account configured by your NAS administrator",
    dashboard: "Dashboard", control: "Control", goods: "Goods", products: "Products", purchase: "Purchasing", inventory: "Inventory",
    categories: "Categories & tags", customers: "Customers", customerList: "Customer list", customerAccounts: "Customer accounts",
    sales: "Sales", salesList: "Sales orders", scanRetail: "Scan retail", scanSales: "Scan sale", returns: "Returns",
    finance: "Finance", invoice: "Invoices", invoiceList: "Invoice list", issueInvoice: "Create invoice", reports: "Reports",
    cloudStore: "App / Store", cloudProducts: "Store products", cloudSettings: "Store settings", settings: "Settings",
    smartPurchase: "Smart purchasing", operatingControl: "Operations", flowDetails: "Transactions", orderFinance: "Order finance",
    search: "Search", refresh: "Refresh", add: "Add", select: "Select", all: "All", cancel: "Cancel", save: "Save",
    newProduct: "New product", newCustomer: "New customer", createPurchase: "New purchase receipt", saveOrder: "Save order",
    clear: "Clear", customer: "Customer", total: "Total", noData: "No data", actions: "Actions",
    todaySales: "Today's sales", inventoryCost: "Inventory cost", activeCustomers: "Active customers", newArrival: "New arrival",
    salesReport: "Sales report", recentSales: "Recent sales", sevenDayTrend: "7-day sales trend",
    loadingProducts: "Loading products…", saving: "Saving…", productsLoadFailed: "Could not load products", retry: "Retry", productCreateFailed: "Could not save product", requiredProductFields: "Enter a SKU and product name",
  },
  hu: {
    appName: "CloudLink ERP", tagline: "Az üzlet mindig kézben", loginTitle: "Digitális munkatér beszerzőknek",
    loginDescription: "Termékek, beszerzés, készlet, értékesítés és pénzügy valós időben", nasEdition: "Privát Synology NAS telepítés",
    username: "Felhasználónév", password: "Jelszó", login: "Bejelentkezés", logout: "Kijelentkezés", signingIn: "Bejelentkezés…",
    loginRequired: "Adja meg a felhasználónevet és a jelszót", invalidCredentials: "Hibás felhasználónév vagy jelszó", loginFailed: "A bejelentkezés sikertelen. Ellenőrizze az adatokat és a hálózatot.", secureLoginNote: "Használja a NAS rendszergazdája által beállított fiókot",
    dashboard: "Kezdőlap", control: "Vezérlés", goods: "Áruk", products: "Termékek", purchase: "Beszerzés", inventory: "Készlet",
    categories: "Kategóriák és címkék", customers: "Vevők", customerList: "Vevőlista", customerAccounts: "Vevői számlák",
    sales: "Értékesítés", salesList: "Értékesítési rendelések", scanRetail: "Vonalkódos kisker.", scanSales: "Vonalkódos eladás", returns: "Visszáru",
    finance: "Pénzügy", invoice: "Számlák", invoiceList: "Számlalista", issueInvoice: "Számlázás", reports: "Kimutatások",
    cloudStore: "App / Webshop", cloudProducts: "Webshop termékek", cloudSettings: "Webshop beállítások", settings: "Beállítások",
    smartPurchase: "Intelligens beszerzés", operatingControl: "Működési vezérlés", flowDetails: "Tranzakciók", orderFinance: "Rendelések pénzügyei",
    search: "Keresés", refresh: "Frissítés", add: "Új", select: "Válasszon", all: "Összes", cancel: "Mégse", save: "Mentés",
    newProduct: "Új termék", newCustomer: "Új vevő", createPurchase: "Új beszerzési bevét", saveOrder: "Rendelés mentése",
    clear: "Törlés", customer: "Vevő", total: "Összesen", noData: "Nincs adat", actions: "Műveletek",
    todaySales: "Mai értékesítés", inventoryCost: "Készletérték", activeCustomers: "Aktív vevők", newArrival: "Új bevételezés",
    salesReport: "Értékesítési riport", recentSales: "Legutóbbi eladások", sevenDayTrend: "7 napos értékesítési trend",
    loadingProducts: "Termékek betöltése…", saving: "Mentés…", productsLoadFailed: "A termékek betöltése sikertelen", retry: "Újra", productCreateFailed: "A termék mentése sikertelen", requiredProductFields: "Adja meg a cikkszámot és a termék nevét",
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
