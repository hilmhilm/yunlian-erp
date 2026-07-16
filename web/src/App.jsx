import { useEffect, useState } from "react";
import {
  BarChart3, Boxes, ChevronDown, CircleDollarSign, ClipboardList, Database,
  FileBarChart, FileText, Home, LogOut, Menu, Package, Plus, RefreshCw,
  ScanLine, Search, Settings, ShoppingCart, Store, Tags, Truck, Users,
  Warehouse, X, Check, Pencil, ArrowDownToLine, WalletCards, Bell, Trash2, Clock3, Printer,
} from "lucide-react";
import { useI18n } from "./i18n.jsx";
import {
  ApiError, clearStoredSession, createCustomer as createCustomerRequest,
  createProduct as createProductRequest, createPurchase as createPurchaseRequest, createUser as createUserRequest,
  createSale as createSaleRequest, createSalePayment as createSalePaymentRequest, fetchCurrentUser, fetchCustomers, fetchDashboard, fetchProduct, fetchProducts, fetchSale,
  fetchPurchases, fetchReportSummary, fetchSales, fetchUsers, getStoredSession,
  login as loginRequest, storeSession, updateProduct as updateProductRequest, updateSale as updateSaleRequest, updateSaleStatus as updateSaleStatusRequest, updateUser as updateUserRequest,
} from "./api.js";

const pageNames = { dashboard: "dashboard", operatingControl: "operatingControl", smartPurchase: "smartPurchase", products: "products", purchases: "purchase", inventory: "inventory", categories: "categories", customers: "customerList", customerAccounts: "customerAccounts", sales: "salesList", scanSales: "scanSales", collectorSales: "collectorSales", saleSettlement: "orderSettlement", flowDetails: "flowDetails", orderFinance: "orderFinance", invoiceList: "invoiceList", issueInvoice: "issueInvoice", reports: "reports", cloudProducts: "cloudProducts", cloudSettings: "cloudSettings", users: "employeeManagement", settings: "settings" };
const pageTargets = { operatingControl: "dashboard", smartPurchase: "purchases", categories: "products", customerAccounts: "customers", scanSales: "pos", flowDetails: "reports", orderFinance: "reports", invoiceList: "sales", issueInvoice: "sales", cloudProducts: "products", cloudSettings: "settings" };
const roleOptions = ["admin","purchasing","warehouse","sales","finance"];
const pageRoles = {
  purchases: ["admin","purchasing","warehouse","finance"],
  customers: ["admin","sales","finance"], sales: ["admin","sales","finance"],
  pos: ["admin","sales"], collectorSales: ["admin","sales"], saleSettlement: ["admin","sales","finance"], reports: ["admin","finance"], users: ["admin"],
};
const canAccess = (role,page) => !pageRoles[pageTargets[page]||page] || pageRoles[pageTargets[page]||page].includes(role);

const menu = [
  { id: "dashboard", labelKey: "dashboard", icon: Home },
  { labelKey: "control", icon: BarChart3, children: [{ id: "operatingControl", labelKey: "operatingControl" }, { id: "smartPurchase", labelKey: "smartPurchase" }] },
  { labelKey: "goods", icon: Boxes, children: [{ id: "products", labelKey: "products" }, { id: "purchases", labelKey: "purchase" }, { id: "inventory", labelKey: "inventory" }, { id: "categories", labelKey: "categories" }] },
  { labelKey: "customers", icon: Users, children: [{ id: "customers", labelKey: "customerList" }, { id: "customerAccounts", labelKey: "customerAccounts" }] },
  { labelKey: "sales", icon: ShoppingCart, children: [{ id: "sales", labelKey: "salesList" }, { id: "scanSales", labelKey: "scanSales" }, { id: "collectorSales", labelKey: "collectorSales" }] },
  { labelKey: "finance", icon: CircleDollarSign, children: [{ id: "flowDetails", labelKey: "flowDetails" }, { id: "orderFinance", labelKey: "orderFinance" }] },
  { labelKey: "invoice", icon: FileText, children: [{ id: "invoiceList", labelKey: "invoiceList" }, { id: "issueInvoice", labelKey: "issueInvoice" }] },
  { id: "reports", labelKey: "reports", icon: FileBarChart },
  { labelKey: "cloudStore", icon: Store, children: [{ id: "cloudProducts", labelKey: "cloudProducts" }, { id: "cloudSettings", labelKey: "cloudSettings" }] },
  { id: "users", labelKey: "employeeManagement", icon: Users },
  { id: "settings", labelKey: "settings", icon: Settings },
];

const currencies=[{code:"HUF",symbol:"Ft"},{code:"EUR",symbol:"€"},{code:"USD",symbol:"$"}];
const money=(n,currency="HUF")=>`${new Intl.NumberFormat("zh-CN",{minimumFractionDigits:currency==="HUF"?0:2,maximumFractionDigits:currency==="HUF"?0:2}).format(Number(n||0))} ${currencies.find(item=>item.code===currency)?.symbol||currency}`;
const productPrice=(product,currency="HUF")=>Number({HUF:product.priceHuf,EUR:product.priceEur,USD:product.priceUsd}[currency]||0);
const localDateValue = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const defaultSalesFilters = () => ({startDate:localDateValue(),endDate:localDateValue()});
const uiVersion = "2026.07.15-3";
const saleStatusLabel = (status,t) => t({"已完成":"saleStatusCompleted","部分退货":"saleStatusPartiallyReturned","已退货":"saleStatusReturned"}[status],status);

function Login({ onLogin }) {
  const { t, locale, setLocale, locales } = useI18n();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) return setError(t("loginRequired"));
    setError("");
    setSubmitting(true);
    try {
      await onLogin(username, password);
    } catch (requestError) {
      setError(requestError instanceof ApiError && requestError.status === 401 ? t("invalidCredentials") : t("loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="login-page">
    <div className="brand-lockup"><div className="brand-mark"><Warehouse size={24}/></div><strong>{t("appName")}</strong><span>{t("tagline")}</span></div>
    <select className="login-language" aria-label="Language" value={locale} onChange={e=>setLocale(e.target.value)}>{locales.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select>
    <div className="login-showcase">
      <div className="showcase-orbit"><Database size={42}/><Boxes size={58}/><BarChart3 size={48}/><ScanLine size={40}/></div>
      <h2>{t("loginTitle")}</h2><p>{t("loginDescription")}</p>
    </div>
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo"><Warehouse size={28}/></div>
      <h1>{t("appName")}</h1><p>{t("nasEdition")}</p>
      <label>{t("username")}<input aria-label={t("username")} value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
      <label>{t("password")}<input aria-label={t("password")} type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary login-button" disabled={submitting}>{submitting ? t("signingIn") : t("login")}</button>
      <div className="login-note">{t("secureLoginNote")}</div>
    </form>
    <div className="login-footer">Private ERP · Docker Compose · Synology NAS</div>
  </div>;
}

function Sidebar({ page, setPage, open, setOpen, role }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(["goods", "sales"]);
  const toggle = (label) => setExpanded(v => v.includes(label) ? v.filter(x=>x!==label) : [...v, label]);
  const visibleMenu=menu.map(item=>item.children?{...item,children:item.children.filter(child=>canAccess(role,child.id))}:item).filter(item=>item.children?item.children.length:canAccess(role,item.id));
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="side-brand"><Warehouse size={22}/><span>{t("appName")}</span></div>
    <nav>{visibleMenu.map((item, i) => {
      const Icon = item.icon;
      if (!item.children) return <button key={i} className={`nav-item ${page===item.id?"active":""}`} onClick={()=>{setPage(item.id);setOpen(false)}}><Icon size={17}/><span>{t(item.labelKey)}</span></button>;
      const isOpen = expanded.includes(item.labelKey);
      return <div className="nav-group" key={i}>
        <button className="nav-item" onClick={()=>toggle(item.labelKey)}><Icon size={17}/><span>{t(item.labelKey)}</span><ChevronDown className={isOpen?"rotated":""} size={14}/></button>
        {isOpen && <div className="subnav">{item.children.map((child,j)=><button key={j} className={page===child.id?"active":""} onClick={()=>{setPage(child.id);setOpen(false)}}>{t(child.labelKey)}</button>)}</div>}
      </div>;
    })}</nav>
    <div className="exchange">EUR/HUF: 357.351<br/>USD/HUF: 313.465<br/>UI {uiVersion}</div>
  </aside>;
}

function Header({ page, user, onLogout, toggleMenu }) {
  const { t, locale, setLocale, locales } = useI18n();
  return <><header className="header"><button className="icon-btn menu-btn" onClick={toggleMenu}><Menu size={23}/></button><b>{t(pageNames[page])}</b><div className="header-spacer"/><span className="date">2026-07-13 09:24</span><select className="language-select" aria-label="Language" value={locale} onChange={e=>setLocale(e.target.value)}>{locales.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select><button className="icon-btn"><Bell size={19}/><i>1</i></button><div className="user-chip">{user}<ChevronDown size={13}/></div><button title={t("logout")} className="icon-btn" onClick={onLogout}><LogOut size={18}/></button></header><div className="tabs"><span>{t("dashboard")}</span><span className="active">● {t(pageNames[page])} ×</span></div></>;
}

function Stat({ icon: Icon, color, label, value, suffix }) { return <div className="stat-card"><div className="stat-icon" style={{color,background:`${color}18`}}><Icon size={31}/></div><div><small>{label}</small><strong>{value}</strong><span>{suffix}</span></div></div>; }

function Dashboard({ products, customers, sales, summary, setPage }) {
  const stock=summary?.products.stock??products.reduce((s,p)=>s+p.stock,0),revenue=summary?.sales.totals||{HUF:0,EUR:0,USD:0};
  return <div className="page-content">
    <div className="smart-actions"><button className="outline danger">智能采购 推荐进货: 51</button><button className="outline success">推荐供货商</button><button className="outline" onClick={()=>setPage("reports")}>新老板视图</button></div>
    <div className="stats-grid"><Stat icon={Boxes} color="#26b99a" label="货物" value={summary?.products.count ?? products.length} suffix="种商品"/><Stat icon={ShoppingCart} color="#3f9fea" label="今日销售" value={money(revenue.HUF,"HUF")} suffix={`${money(revenue.EUR,"EUR")} · ${money(revenue.USD,"USD")} · ${summary?.sales.count??0} 笔`}/><Stat icon={CircleDollarSign} color="#f05a78" label="库存成本" value={money(products.reduce((s,p)=>s+p.stock*p.cost*390,0))} suffix={`${stock} 件库存`}/><Stat icon={Users} color="#42c7c7" label="客户" value={summary?.customers.count ?? customers.length} suffix="活跃客户"/></div>
    <div className="quick-row"><button onClick={()=>setPage("purchases")}><ArrowDownToLine/>新品入库</button><button onClick={()=>setPage("scanSales")}><ScanLine/>扫码销售</button><button onClick={()=>setPage("reports")}><WalletCards/>财务</button><button onClick={()=>setPage("reports")}><BarChart3/>销售报表</button></div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-title">近 7 日销售趋势</div><div className="bar-chart">{[42,58,37,72,66,89,76].map((h,i)=><div key={i}><span style={{height:`${h}%`}}></span><small>{i+7}日</small></div>)}</div></section><section className="panel"><div className="panel-title">最近销售</div><CompactTable rows={sales.slice(0,6)} columns={["id","qty","total","customer"]}/></section></div>
    <div className="rank-grid">{[
      ["7天热销数量",products.slice(0,3)],["7天热销金额",products.slice(1,4)],["7天热销利润",products.slice(2,5)],["7天库存预警",products.filter(p=>p.stock<100)]
    ].map(([title,items])=><section className="rank-card" key={title}><div className="panel-title">{title}<ChevronDown size={15}/></div>{items.map((p,i)=><div className="rank-line" key={p.id}><b>{i+1}</b><span>{p.sku} {p.name}</span><em>{p.stock}</em></div>)}</section>)}</div>
  </div>;
}

function Toolbar({ search, setSearch, onAdd, onSearch, onRefresh, busy=false, placeholder="搜索货号、条码或名称" }) { const {t}=useI18n(); return <div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder={placeholder} value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSearch?.()}/></div><select><option>{t("select")}</option><option>{t("all")}</option></select><button className="primary" onClick={onSearch} disabled={busy}><Search size={16}/>{t("search")}</button><div className="toolbar-spacer"/><button className="outline" onClick={onRefresh} disabled={busy}><RefreshCw size={16}/>{t("refresh")}</button>{onAdd&&<button className="primary" onClick={onAdd} disabled={busy}><Plus size={16}/>{t("add")}</button>}</div>; }

function DataTable({ columns, rows, renderCell, onEdit, onDetail }) { const {t}=useI18n(); return <div className="table-wrap"><table><thead><tr><th><input type="checkbox"/></th>{columns.map(c=><th key={c.key}>{c.label}</th>)}<th>{t("actions")}</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><input type="checkbox"/></td>{columns.map(c=><td key={c.key}>{renderCell?renderCell(row,c):row[c.key]}</td>)}<td><div className="row-actions">{onEdit&&<button title={t("edit")} onClick={()=>onEdit(row)}><Pencil size={16}/></button>}{onDetail&&<button title={t("details")} onClick={()=>onDetail(row)}><ClipboardList size={16}/></button>}</div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">{t("noData")}</div>}</div>; }
function CompactTable({rows,columns}) { return <div className="compact-table">{rows.map(r=><div key={r.id}>{columns.map(c=><span key={c}>{c==="total"?money(r[c],r.currency):r[c]}</span>)}</div>)}</div>; }

function Products({ products, onCreate, onUpdate, onLoad, onLoadDetail, loading=false, error="", inventoryOnly=false, canCreate=true, canEdit=true }) {
  const { t } = useI18n();
  const [search,setSearch]=useState(""),[editor,setEditor]=useState(null),[detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState("");
  const filtered=products.filter(p=>`${p.sku}${p.barcode}${p.name}${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const save=async(data)=>{if(editor?.id)await onUpdate(editor.id,data);else await onCreate(data);setEditor(null)};
  const openDetail=async product=>{setDetail({id:product.id,sku:product.sku,name:product.name});setDetailLoading(true);setDetailError("");try{setDetail(await onLoadDetail(product.id))}catch(e){setDetailError(e.message)}finally{setDetailLoading(false)}};
  const columns=inventoryOnly?[
    {key:"sku",label:"货号"},{key:"name",label:"产品名"},{key:"category",label:"分类"},{key:"supplier",label:"仓库/供货商"},{key:"stock",label:"库存量"},{key:"box",label:"箱数"}
  ]:[{key:"sku",label:"货号"},{key:"barcode",label:"条码"},{key:"name",label:"产品名"},{key:"category",label:"分类"},{key:"cost",label:t("productCost")},{key:"priceHuf",label:t("priceHuf")},{key:"priceEur",label:t("priceEur")},{key:"priceUsd",label:t("priceUsd")},{key:"stock",label:"入库统计"}];
  return <Page><Toolbar search={search} setSearch={setSearch} onAdd={canCreate?()=>setEditor({}):undefined} onSearch={()=>onLoad(search)} onRefresh={()=>{setSearch("");onLoad("")}} busy={loading}/>{error&&<div className="form-error page-error">{t("productsLoadFailed")}：{error} <button className="outline" onClick={()=>onLoad(search)}>{t("retry")}</button></div>}{loading&&<div className="empty">{t("loadingProducts")}</div>}<div className="filter-strip"><span>全部</span><span className="selected">仅显示有库存</span><span>仅显示零库存</span></div><DataTable columns={columns} rows={filtered} renderCell={(r,c)=>c.key==="cost"?money(r.cost,"EUR"):c.key==="priceHuf"?money(r.priceHuf,"HUF"):c.key==="priceEur"?money(r.priceEur,"EUR"):c.key==="priceUsd"?money(r.priceUsd,"USD"):c.key==="stock"?<b className={r.stock<20?"stock-low":"stock-ok"}>{r.stock}</b>:c.key==="box"?(r.stock/r.boxSize).toFixed(1):r[c.key]} onEdit={canEdit&&!inventoryOnly?setEditor:undefined} onDetail={openDetail}/>{editor&&<ProductModal product={editor.id?editor:null} onClose={()=>setEditor(null)} onSave={save}/>} {detail&&<ProductDetailModal product={detail} loading={detailLoading} error={detailError} onClose={()=>setDetail(null)}/>}</Page>;
}

const productFields=[
  ["sku","productSku","text"],["barcode","productBarcode","text"],["name","productName","text"],["category","productCategory","text"],["supplier","supplier","text"],["unit","productUnit","text"],["boxSize","productBoxSize","number"],["cost","productCost","number"],["priceHuf","priceHuf","number"],["priceEur","priceEur","number"],["priceUsd","priceUsd","number"],
];

function ProductModal({product,onClose,onSave}) {
  const {t}=useI18n();
  const [form,setForm]=useState(()=>({sku:product?.sku||"",barcode:product?.barcode||"",name:product?.name||"",category:product?.category||"",supplier:product?.supplier||"",unit:product?.unit||"个",boxSize:product?.boxSize??1,cost:product?.cost??0,priceHuf:product?.priceHuf??0,priceEur:product?.priceEur??0,priceUsd:product?.priceUsd??0})),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const save=async()=>{const data={...form,boxSize:Number(form.boxSize),cost:Number(form.cost),priceHuf:Number(form.priceHuf),priceEur:Number(form.priceEur),priceUsd:Number(form.priceUsd)};if(!data.sku.trim()||!data.name.trim()||!data.unit.trim()||!Number.isSafeInteger(data.boxSize)||data.boxSize<=0||[data.cost,data.priceHuf,data.priceEur,data.priceUsd].some(value=>!Number.isFinite(value)||value<0))return setError(t("invalidProductFields"));setError("");setSaving(true);try{await onSave(data)}catch(e){setError(`${t("productSaveFailed")}：${e.message}`)}finally{setSaving(false)}};
  return <Modal title={t(product?"editProduct":"newProduct")} onClose={onClose} wide><div className="form-grid">{productFields.map(([key,label,type])=><label key={key}>{t(label)}<input type={type} min={key==="boxSize"?"1":type==="number"?"0":undefined} step={key==="boxSize"?"1":type==="number"?"0.01":undefined} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>{product&&<div className="readonly-note">{t("stockManagedByMovements")}：<b>{product.stock}</b></div>}{error&&<div className="form-error detail-error">{error}</div>}<div className="modal-actions"><button className="outline" onClick={onClose} disabled={saving}>{t("cancel")}</button><button className="primary" onClick={save} disabled={saving}>{saving?t("saving"):t("save")}</button></div></Modal>;
}

function ProductDetailModal({product,loading,error,onClose}) {
  const {t}=useI18n();
  const facts=[["productSku",product.sku],["productBarcode",product.barcode||"—"],["productName",product.name],["productCategory",product.category||"—"],["supplier",product.supplier||"—"],["productUnit",product.unit],["productBoxSize",product.boxSize],["productCost",money(product.cost,"EUR")],["priceHuf",money(product.priceHuf,"HUF")],["priceEur",money(product.priceEur,"EUR")],["priceUsd",money(product.priceUsd,"USD")],["currentStock",product.stock],["createdAt",product.createdAt?new Date(product.createdAt).toLocaleString():"—"],["updatedAt",product.updatedAt?new Date(product.updatedAt).toLocaleString():"—"]];
  return <Modal title={`${t("productDetails")} · ${product.sku||""}`} onClose={onClose} wide>{loading?<div className="empty">{t("loading")}</div>:error?<div className="form-error detail-error">{error}</div>:<><div className="product-facts">{facts.map(([label,value])=><span key={label}><small>{t(label)}</small><b>{value}</b></span>)}</div><div className="detail-section-title">{t("inventoryMovements")}</div><div className="table-wrap detail-table"><table><thead><tr><th>{t("dateTime")}</th><th>{t("movementType")}</th><th>{t("warehouseLabel")}</th><th>{t("quantity")}</th><th>{t("referenceNo")}</th><th>{t("operator")}</th></tr></thead><tbody>{(product.movements||[]).map(movement=><tr key={movement.id}><td>{movement.date}</td><td>{t(`movement_${movement.movementType}`,movement.movementType)}</td><td>{movement.warehouse}</td><td><b className={movement.quantity<0?"stock-low":"stock-ok"}>{movement.quantity>0?`+${movement.quantity}`:movement.quantity}</b></td><td>{movement.referenceNo||"—"}</td><td>{movement.createdBy||"—"}</td></tr>)}</tbody></table>{!product.movements?.length&&<div className="empty">{t("noInventoryMovements")}</div>}</div></>}</Modal>;
}

function Purchases({ purchases, products, onCreate, onRefresh, loading=false, error="", canCreate=true }) {
  const { t } = useI18n();
  const [search,setSearch]=useState(""),[modal,setModal]=useState(false);
  const rows=purchases.filter(x=>`${x.id}${x.supplier}`.toLowerCase().includes(search.toLowerCase()));
  return <Page><Toolbar search={search} setSearch={setSearch} onAdd={canCreate?()=>setModal(true):undefined} onSearch={()=>{}} onRefresh={onRefresh} busy={loading} placeholder="搜索入库单号或供货商"/>{error&&<div className="form-error">{t("dataLoadFailed")}：{error}</div>}<DataTable rows={rows} columns={[{key:"id",label:"入库单号"},{key:"date",label:"建单时间"},{key:"supplier",label:"供货商"},{key:"quantity",label:"总数"},{key:"total",label:"采购总价"},{key:"status",label:"审核"}]} renderCell={(r,c)=>c.key==="total"?money(r.total):c.key==="status"?<span className={`status ${r.status==="已入库"?"done":"pending"}`}>{r.status}</span>:r[c.key]}/>{modal&&<PurchaseModal products={products} onClose={()=>setModal(false)} onSave={async data=>{await onCreate(data);setModal(false)}}/>}</Page>;
}

function PurchaseModal({products,onClose,onSave}) {
  const {t}=useI18n();
  const newItem=(product=products[0])=>({key:`${Date.now()}-${Math.random()}`,productId:product?.id||"",quantity:1,cost:product?.cost||0});
  const [form,setForm]=useState({supplier:"",warehouse:"主仓库",items:[newItem()]});
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const updateItem=(key,changes)=>setForm(current=>({...current,items:current.items.map(item=>item.key===key?{...item,...changes}:item)}));
  const chooseProduct=(key,value)=>{const product=products.find(p=>String(p.id)===value);updateItem(key,{productId:value,cost:product?.cost||0})};
  const addItem=()=>{const selected=new Set(form.items.map(item=>String(item.productId)));const product=products.find(item=>!selected.has(String(item.id)))||products[0];setForm(current=>({...current,items:[...current.items,newItem(product)]}))};
  const removeItem=(key)=>setForm(current=>({...current,items:current.items.filter(item=>item.key!==key)}));
  const total=form.items.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.cost||0),0);
  const save=async()=>{const items=form.items.map(({productId,quantity,cost})=>({productId:Number(productId),quantity:Number(quantity),cost:Number(cost)}));if(!form.supplier.trim()||!items.length||items.some(item=>!item.productId||!Number.isInteger(item.quantity)||item.quantity<=0||!Number.isFinite(item.cost)||item.cost<0))return setError(t("requiredPurchaseFields"));if(new Set(items.map(item=>item.productId)).size!==items.length)return setError(t("duplicatePurchaseProduct"));setSaving(true);setError("");try{await onSave({supplier:form.supplier.trim(),warehouse:form.warehouse,items})}catch(e){setError(`${t("purchaseCreateFailed")}：${e.message}`)}finally{setSaving(false)}};
  return <Modal title={t("createPurchase")} onClose={onClose} wide><div className="form-grid purchase-head"><label>{t("supplier")}<input value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})}/></label><label>{t("warehouseLabel")}<select value={form.warehouse} onChange={e=>setForm({...form,warehouse:e.target.value})}><option value="主仓库">{t("mainWarehouse")}</option><option value="门店仓">{t("storeWarehouse")}</option></select></label></div><div className="purchase-items"><div className="purchase-items-head"><b>{t("purchaseItems")}</b><button className="outline" type="button" onClick={addItem} disabled={!products.length||form.items.length>=products.length}><Plus size={15}/>{t("addLine")}</button></div>{!products.length&&<div className="empty purchase-empty">{t("noProductsForPurchase")}</div>}{form.items.map((item,index)=><div className="purchase-line" key={item.key}><span className="line-number">{index+1}</span><label>{t("product")}<select value={item.productId} onChange={e=>chooseProduct(item.key,e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label><label>{t("quantity")}<input type="number" min="1" step="1" value={item.quantity} onChange={e=>updateItem(item.key,{quantity:e.target.value})}/></label><label>{t("unitCost")}<input type="number" min="0" step="0.01" value={item.cost} onChange={e=>updateItem(item.key,{cost:e.target.value})}/></label><span className="line-total"><small>{t("lineTotal")}</small>{money(Number(item.quantity||0)*Number(item.cost||0))}</span><button className="icon-btn remove-line" type="button" title={t("removeLine")} aria-label={t("removeLine")} onClick={()=>removeItem(item.key)} disabled={form.items.length===1}><Trash2 size={17}/></button></div>)}</div>{error&&<div className="form-error purchase-error">{error}</div>}<div className="purchase-total"><span>{t("purchaseTotal")}</span><b>{money(total)}</b></div><div className="modal-actions"><button className="outline" onClick={onClose} disabled={saving}>{t("cancel")}</button><button className="primary" onClick={save} disabled={saving||!products.length}>{saving?t("saving"):t("createPurchase")}</button></div></Modal>;
}

function Customers({ customers,onCreate,onLoad,loading=false,error="",canCreate=true }) {
  const {t}=useI18n();
  const [search,setSearch]=useState(""),[modal,setModal]=useState(false);
  return <Page><Toolbar search={search} setSearch={setSearch} onAdd={canCreate?()=>setModal(true):undefined} onSearch={()=>onLoad(search)} onRefresh={()=>{setSearch("");onLoad("")}} busy={loading} placeholder="搜索客户名、电话或城市"/>{error&&<div className="form-error">{t("dataLoadFailed")}：{error}</div>}<div className="filter-strip"><span className="selected">全部</span><span>30天</span><span>60天</span><span>90天</span></div><DataTable rows={customers} columns={[{key:"name",label:"客户名"},{key:"phone",label:"电话"},{key:"address",label:"地址"},{key:"city",label:"城市"},{key:"group",label:"分组"}]}/>{modal&&<CustomerModal onClose={()=>setModal(false)} onSave={async data=>{await onCreate(data);setModal(false)}}/>}</Page>;
}
function CustomerModal({onClose,onSave}) {
  const {t}=useI18n();
  const [form,setForm]=useState({name:"",phone:"",city:"",address:"",group:"零售"}),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const save=async()=>{if(!form.name)return setError(t("requiredCustomerName"));setSaving(true);setError("");try{await onSave(form)}catch(e){setError(`${t("customerCreateFailed")}：${e.message}`)}finally{setSaving(false)}};
  return <Modal title={t("newCustomer")} onClose={onClose}><div className="form-grid">{["name","phone","city","address"].map(k=><label key={k}>{t({name:"customerName",phone:"phone",city:"city",address:"address"}[k])}<input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}</div>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button className="outline" onClick={onClose} disabled={saving}>{t("cancel")}</button><button className="primary" onClick={save} disabled={saving}>{saving?t("saving"):t("save")}</button></div></Modal>;
}

function SaleStatusButton({value,label,onToggle,disabled=false}) {
  const {t}=useI18n();
  return <button type="button" className={`sale-state ${value?"complete":"incomplete"}`} onClick={onToggle} disabled={disabled} title={value?t("markPending"):t("markCompleted")} aria-label={`${label}：${value?t("completed"):t("pending")}`}>{value?<Check size={16} strokeWidth={3}/>:<X size={16} strokeWidth={3}/>}</button>;
}

function SettlementStatusButton({sale,onOpen,disabled=false}) {
  const {t}=useI18n();
  const state=sale.settled?"complete":sale.paidTotal>0?"partial":"incomplete";
  const label=t(state==="complete"?"settlementPaid":state==="partial"?"settlementPartial":"settlementUnpaid");
  return <button type="button" className={`sale-state settlement-state ${state}`} onClick={onOpen} disabled={disabled} title={t("openSettlement")} aria-label={`${t("settlementStatus")}：${label}`}>{state==="complete"?<Check size={16} strokeWidth={3}/>:state==="partial"?<Clock3 size={15} strokeWidth={2.7}/>:<X size={16} strokeWidth={3}/>}</button>;
}

function Sales({sales,filters,onRefresh,onLoadDetail,onToggleStatus,onOpenSettlement,loading=false,error="",canUpdateStatus=true,canSettle=true}) {
  const {t}=useI18n();
  const [search,setSearch]=useState(""),[startDate,setStartDate]=useState(filters.startDate),[endDate,setEndDate]=useState(filters.endDate),[filterError,setFilterError]=useState(""),[statusError,setStatusError]=useState(""),[updatingStatus,setUpdatingStatus]=useState(""),[detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState("");
  const openDetail=async sale=>{setDetailLoading(true);setDetailError("");setDetail({databaseId:sale.databaseId,id:sale.id});try{setDetail(await onLoadDetail(sale.databaseId))}catch(e){setDetailError(e.message)}finally{setDetailLoading(false)}};
  const queryDates=()=>{if(startDate&&endDate&&startDate>endDate)return setFilterError(t("invalidDateRange"));setFilterError("");onRefresh({startDate,endDate})};
  const clearDates=()=>{setStartDate("");setEndDate("");setFilterError("")};
  const toggleStatus=async(row,key)=>{setUpdatingStatus(`${row.databaseId}-${key}`);setStatusError("");try{await onToggleStatus(row.databaseId,{[key]:!row[key]})}catch(e){setStatusError(`${t("statusUpdateFailed")}：${e.message}`)}finally{setUpdatingStatus("")}};
  const statusKeys=new Set(["stockDeducted","delivered"]);
  const moneyKeys=new Set(["total","paidTotal","balance"]);
  const columns=[{key:"id",label:t("salesOrderNo")},{key:"databaseId",label:"ID"},{key:"date",label:t("orderDate")},{key:"salesperson",label:t("salesperson")},{key:"customer",label:t("customer")},{key:"itemCount",label:t("itemDetails")},{key:"qty",label:t("quantity")},{key:"currency",label:t("currencyChoice")},{key:"total",label:t("total")},{key:"paidTotal",label:t("amountPaid")},{key:"balance",label:t("amountDue")},{key:"stockDeducted",label:t("stockDeducted")},{key:"delivered",label:t("delivered")},{key:"settled",label:t("settlementStatus")}];
  return <Page><div className="sales-list-page"><Toolbar search={search} setSearch={setSearch} onSearch={()=>{}} onRefresh={queryDates} busy={loading} placeholder={t("searchSales")}/><div className="date-filter"><label>{t("startDate")}<input type="date" value={startDate} max={endDate||undefined} onChange={e=>setStartDate(e.target.value)}/></label><span>—</span><label>{t("endDate")}<input type="date" value={endDate} min={startDate||undefined} onChange={e=>setEndDate(e.target.value)}/></label><button className="primary" onClick={queryDates} disabled={loading}><Search size={16}/>{t("queryDateRange")}</button><button className="outline" onClick={clearDates} disabled={loading}>{t("clearDateRange")}</button></div>{(filterError||statusError||error)&&<div className="form-error page-error">{filterError||statusError||`${t("dataLoadFailed")}：${error}`}</div>}<div className="sales-dense-table"><DataTable rows={sales.filter(s=>`${s.id}${s.customer}${s.salesperson}`.toLowerCase().includes(search.toLowerCase()))} columns={columns} renderCell={(r,c)=>moneyKeys.has(c.key)?<b className={c.key==="balance"&&r.balance>0?"amount-due":""}>{money(r[c.key],r.currency)}</b>:c.key==="itemCount"?<button type="button" className="detail-count" onClick={()=>openDetail(r)} title={t("details")} aria-label={`${t("details")} ${r.id}`}>{r.itemCount}</button>:c.key==="settled"?<SettlementStatusButton sale={r} disabled={!canSettle} onOpen={()=>onOpenSettlement(r)}/>:statusKeys.has(c.key)?<SaleStatusButton value={r[c.key]} label={c.label} disabled={!canUpdateStatus||Boolean(updatingStatus)} onToggle={()=>toggleStatus(r,c.key)}/>:r[c.key]} onDetail={openDetail}/></div>{detail&&<SaleDetailModal sale={detail} loading={detailLoading} error={detailError} onClose={()=>setDetail(null)}/>}</div></Page>;
}

function SaleDetailModal({sale,loading,error,onClose}) {
  const {t}=useI18n();
  const items=sale.items||[];
  return <Modal title={`${t("saleDetails")} · ${sale.id||""}`} onClose={onClose} wide>{loading?<div className="empty">{t("loading")}</div>:error?<div className="form-error detail-error">{error}</div>:<><div className="sale-summary"><span><small>{t("customer")}</small><b>{sale.customer||t("walkInCustomer")}</b></span><span><small>{t("orderDate")}</small><b>{sale.date}</b></span><span><small>{t("currencyChoice")}</small><b>{sale.currency}</b></span><span><small>{t("salesTotal")}</small><b>{money(sale.total,sale.currency)}</b></span></div><div className="table-wrap detail-table"><table><thead><tr><th>{t("product")}</th><th>{t("quantity")}</th><th>{t("unitPrice")}</th><th>{t("total")}</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.sku}</b><br/><small>{item.name}</small></td><td>{item.quantity}</td><td>{money(item.price,sale.currency)}</td><td>{money(item.quantity*item.price,sale.currency)}</td></tr>)}</tbody></table></div></>}</Modal>;
}

function SettlementPage({sale,loading,error,onCancel,onSubmit}) {
  const {t}=useI18n();
  const [bookedOn,setBookedOn]=useState(localDateValue),[method,setMethod]=useState("cash"),[amount,setAmount]=useState(""),[note,setNote]=useState(""),[formError,setFormError]=useState(""),[saving,setSaving]=useState(false),[toast,setToast]=useState("");
  const balance=Number(sale?.balance||0),paidTotal=Number(sale?.paidTotal||0);
  useEffect(()=>{setAmount(balance>0?String(Number(balance.toFixed(2))):"")},[sale?.databaseId,balance]);
  const reset=()=>{setBookedOn(localDateValue());setMethod("cash");setAmount(balance>0?String(Number(balance.toFixed(2))):"");setNote("");setFormError("");setToast("")};
  const save=async(printAfter=false)=>{
    const value=Number(amount);
    if(!Number.isFinite(value)||value<=0||value>balance+0.0001)return setFormError(t("invalidPaymentAmount"));
    setSaving(true);setFormError("");setToast("");
    try{await onSubmit({amount:value,method,bookedOn,note:note.trim()});setNote("");setToast(t("paymentSaved"));if(printAfter)setTimeout(()=>window.print(),50)}catch(requestError){setFormError(`${t("paymentSaveFailed")}：${requestError.message}`)}finally{setSaving(false)}
  };
  if(loading)return <Page><div className="settlement-page panel"><div className="empty">{t("loading")}</div></div></Page>;
  if(error||!sale)return <Page><div className="settlement-page panel"><div className="form-error detail-error">{error||t("dataLoadFailed")}</div><div className="settlement-footer"><button className="outline" onClick={onCancel}>{t("backToSales")}</button></div></div></Page>;
  return <Page><section className="settlement-page panel">
    <h2>{t("orderSettlement")}</h2>
    <div className="settlement-summary"><span><small>{t("customer")}</small><b>{sale.customer||t("walkInCustomer")}</b></span><span><small>{t("salesOrderNo")}</small><b>{sale.id}</b></span><span><small>{t("salesperson")}</small><b>{sale.salesperson||"—"}</b></span><span><small>{t("salesTotal")}</small><b>{money(sale.total,sale.currency)}</b></span><span><small>{t("amountPaid")}</small><b className="stock-ok">{money(paidTotal,sale.currency)}</b></span><span><small>{t("amountDue")}</small><b className={balance>0?"amount-due":"stock-ok"}>{money(balance,sale.currency)}</b></span></div>
    <div className="settlement-form">
      <label>{t("bookingDate")}<input type="date" value={bookedOn} onChange={event=>setBookedOn(event.target.value)}/></label>
      <label>{t("financeCategory")}<select value="sales_income" disabled><option value="sales_income">{t("salesIncome")}</option></select></label>
      <label>{t("paymentMethod")}<select value={method} onChange={event=>setMethod(event.target.value)}><option value="cash">{t("cash")}</option><option value="bank_transfer">{t("bankTransfer")}</option></select></label>
      <label className="settlement-amount">{t("paymentAmount")}<div><input type="number" min="0.01" max={balance} step="0.01" value={amount} disabled={balance<=0} onChange={event=>setAmount(event.target.value)}/><span>{sale.currency}</span><button type="button" className="outline" disabled={balance<=0} onClick={()=>setAmount(String(Number(balance.toFixed(2))))}>{t("payInFull")}</button></div></label>
      <label className="settlement-note">{t("salesNote")}<textarea maxLength="1000" value={note} onChange={event=>setNote(event.target.value)} placeholder={t("paymentNotePlaceholder")}/></label>
    </div>
    {formError&&<div className="form-error settlement-feedback">{formError}</div>}
    {toast&&<div className="collector-success settlement-feedback"><Check size={16}/>{toast}</div>}
    <div className="settlement-footer"><button className="primary" disabled={saving||balance<=0} onClick={()=>save(false)}><CircleDollarSign size={16}/>{saving?t("saving"):t("settleNow")}</button><button className="outline" disabled={saving||balance<=0} onClick={()=>save(true)}><Printer size={16}/>{t("settleAndPrint")}</button><button className="outline" disabled={saving} onClick={reset}>{t("resetImport")}</button><button className="outline" disabled={saving} onClick={onCancel}>{t("cancel")}</button></div>
    <div className="settlement-history"><div className="settlement-history-title"><b>{t("paymentHistory")}</b><span>{sale.payments.length} {t("paymentRecords")}</span></div>{sale.payments.length?<div className="table-wrap"><table><thead><tr><th>{t("bookingDate")}</th><th>{t("paymentMethod")}</th><th>{t("paymentAmount")}</th><th>{t("salesNote")}</th><th>{t("operator")}</th></tr></thead><tbody>{sale.payments.map(payment=><tr key={payment.id}><td>{payment.bookedOn}</td><td>{t(payment.method==="bank_transfer"?"bankTransfer":"cash")}</td><td><b>{money(payment.amount,sale.currency)}</b></td><td>{payment.note||"—"}</td><td>{payment.createdBy}</td></tr>)}</tbody></table></div>:<div className="empty settlement-empty">{t("noPayments")}</div>}</div>
  </section></Page>;
}

function POS({products,customers,sale,onSaveSale,onUpdateSale,onCloseEdit}) {
  const {t}=useI18n();
  const [query,setQuery]=useState(""),[cart,setCart]=useState([]),[customerId,setCustomerId]=useState(""),[currency,setCurrency]=useState("HUF"),[toast,setToast]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{if(!sale)return;setCart((sale.items||[]).map(item=>{const product=products.find(candidate=>candidate.id===item.productId);return product?{...product,qty:item.quantity}:{id:item.productId,sku:item.sku,name:item.name,stock:0,price:item.price,priceHuf:item.price,priceEur:item.price,priceUsd:item.price,qty:item.quantity}}));setCustomerId(sale.customerId?String(sale.customerId):"");setCurrency(sale.currency||"HUF");setError("")},[sale,products]);
  const addProduct=(p)=>setCart(v=>{const found=v.find(x=>x.id===p.id);return found?v.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x):[...v,{...p,qty:1}]});
  const scan=(e)=>{e.preventDefault();const p=products.find(p=>p.barcode===query||p.sku===query)||products.find(p=>p.name.includes(query));if(p)addProduct(p);setQuery("")};
  const total=cart.reduce((sum,item)=>sum+productPrice(item,currency)*item.qty,0);
  const hasZeroQuantity=cart.some(item=>item.qty===0);
  const save=async()=>{if(!cart.length||hasZeroQuantity)return;setSaving(true);setError("");const payload={customerId:customerId?Number(customerId):null,currency,notes:sale?.notes||"",items:cart.map(item=>({productId:item.id,quantity:item.qty}))};try{if(sale)await onUpdateSale(sale.databaseId,payload);else{await onSaveSale(payload);setCart([])}setToast(t(sale?"orderUpdated":"orderSaved"));setTimeout(()=>setToast(""),2200)}catch(e){setError(`${t(sale?"saleUpdateFailed":"saleSaveFailed")}：${e.message}`)}finally{setSaving(false)}};
  const startNewOrder=()=>{onCloseEdit?.();setCart([]);setCustomerId("");setCurrency("HUF");setError("");setToast("")};
  return <div className="pos-page"><div className="pos-main">{sale&&<div className="sale-edit-banner"><span><Pencil size={17}/>{t("editingSalesOrder")} <b>{sale.id}</b></span><button type="button" className="outline" onClick={startNewOrder} disabled={saving}>{t("startNewOrder")}</button></div>}<form className="scan-bar" onSubmit={scan}><select value={currency} onChange={e=>setCurrency(e.target.value)}>{currencies.map(item=><option key={item.code} value={item.code}>× 1 / 个 / {item.symbol}</option>)}</select><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="请扫描条码、输入货号或商品名"/><button className="outline" type="button">新品(F9)</button></form><div className="product-picks">{products.slice(0,5).map(p=><button key={p.id} onClick={()=>addProduct(p)}><Package size={17}/>{p.sku}<small>{p.name}</small></button>)}</div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap cart-table"><table><thead><tr><th>货号</th><th>产品</th><th>库存</th><th>{t("unitPrice")}</th><th>数量</th><th>售价</th><th></th></tr></thead><tbody>{cart.map(p=><tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.stock}</td><td>{money(productPrice(p,currency),currency)}</td><td><div className="qty"><button type="button" onClick={()=>setCart(v=>v.map(x=>x.id===p.id?{...x,qty:x.qty-1}:x))}>−</button><input type="number" step="1" value={p.qty} onChange={e=>{const quantity=Number(e.target.value);if(Number.isSafeInteger(quantity))setCart(v=>v.map(x=>x.id===p.id?{...x,qty:quantity}:x))}}/><button type="button" onClick={()=>setCart(v=>v.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x))}>+</button></div></td><td>{money(productPrice(p,currency)*p.qty,currency)}</td><td><button className="icon-btn" onClick={()=>setCart(v=>v.filter(x=>x.id!==p.id))}><X size={16}/></button></td></tr>)}</tbody></table>{!cart.length&&<div className="empty">扫描或选择商品后会出现在这里</div>}</div></div><aside className="checkout"><div className="checkout-total"><span>{t("total")}</span><b>{money(total,currency)}</b></div><label>{t("currencyChoice")}<select value={currency} onChange={e=>setCurrency(e.target.value)}>{currencies.map(item=><option key={item.code} value={item.code}>{item.code} · {item.symbol}</option>)}</select></label><label>{t("customer")}<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">{t("walkInCustomer")}</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="danger-soft" onClick={()=>setCart([])} disabled={saving}>{t("clear")}</button><button className="save-order" disabled={!cart.length||hasZeroQuantity||saving} onClick={save}><Check size={18}/>{saving?t("saving"):t(sale?"updateOrder":"saveOrder")}</button></aside>{toast&&<div className="toast"><Check size={17}/>{toast}</div>}</div>;
}

function CollectorSales({products,onSaveSale,onImported}) {
  const {t}=useI18n();
  const [delimiter,setDelimiter]=useState("comma"),[currency,setCurrency]=useState("HUF"),[notes,setNotes]=useState(""),[input,setInput]=useState("");
  const [result,setResult]=useState(null),[error,setError]=useState(""),[toast,setToast]=useState(""),[saving,setSaving]=useState(false),[progress,setProgress]=useState(0);
  const reset=()=>{setInput("");setNotes("");setResult(null);setError("");setToast("");setProgress(0)};
  const check=()=>{
    setError("");setToast("");setProgress(0);
    const lines=input.split(/\r?\n/).map((value,index)=>({value:value.trim(),line:index+1})).filter(line=>line.value);
    if(!lines.length){setResult(null);return setError(t("collectorInputRequired"))}
    const productByCode=new Map();
    products.forEach(product=>{if(product.sku)productByCode.set(String(product.sku).trim(),product);if(product.barcode)productByCode.set(String(product.barcode).trim(),product)});
    const parsed=[],errors=[];
    lines.forEach(({value,line})=>{
      const parts=delimiter==="comma"?value.split(",").map(part=>part.trim()):value.split(/\s+/).map(part=>part.trim());
      if(parts.length!==2||!parts[0]||!parts[1]){errors.push({line,message:t("collectorInvalidFormat")});return}
      const [code,quantityText]=parts,quantity=Number(quantityText);
      if(!Number.isSafeInteger(quantity)||quantity===0){errors.push({line,message:t("collectorInvalidQuantity")});return}
      const product=productByCode.get(code);
      if(!product){errors.push({line,message:`${t("collectorProductNotFound")}：${code}`});return}
      parsed.push({line,code,product,quantity});
    });
    const grouped=new Map();
    parsed.forEach(item=>{const current=grouped.get(item.product.id);grouped.set(item.product.id,current?{...current,quantity:current.quantity+item.quantity}:item)});
    const rows=[...grouped.values()];
    rows.filter(row=>row.quantity===0).forEach(row=>errors.push({line:row.line,message:`${t("collectorZeroCombinedQuantity")}：${row.code}`}));
    const validRows=rows.filter(row=>row.quantity!==0);
    if(validRows.length>200)errors.push({line:"—",message:t("collectorTooManyProducts")});
    setResult({rows:validRows,errors,lineCount:lines.length});setProgress(errors.length?35:50);
  };
  const importOrder=async()=>{
    if(!result)return setError(t("collectorCheckFirst"));
    if(result.errors.length)return setError(t("collectorFixErrors"));
    if(!result.rows.length)return setError(t("collectorInputRequired"));
    setSaving(true);setError("");setToast("");setProgress(72);
    try{
      const created=await onSaveSale({customerId:null,currency,notes,items:result.rows.map(row=>({productId:row.product.id,quantity:row.quantity}))});
      setProgress(100);await onImported(created.databaseId);
    }catch(requestError){setProgress(0);setError(`${t("collectorImportFailed")}：${requestError.message}`)}finally{setSaving(false)}
  };
  return <div className="collector-page">
    <div className="collector-tabs"><button className="active">{t("bulkImport")}</button><button disabled>{t("excelImport")}</button></div>
    <section className="collector-form">
      <div className="collector-row"><label>{t("collectorWarehouse")}:</label><select value="main" disabled><option value="main">{t("mainWarehouse")}</option></select></div>
      <div className="collector-row"><label>{t("currencyChoice")}:</label><select value={currency} onChange={event=>{setCurrency(event.target.value);setResult(null);setProgress(0)}}>{currencies.map(item=><option key={item.code} value={item.code}>{item.symbol} ({item.code})</option>)}</select><div className="delimiter-choice"><label><input type="radio" name="delimiter" checked={delimiter==="comma"} onChange={()=>{setDelimiter("comma");setResult(null)}}/>{t("commaDelimiter")}</label><label><input type="radio" name="delimiter" checked={delimiter==="space"} onChange={()=>{setDelimiter("space");setResult(null)}}/>{t("spaceDelimiter")}</label></div></div>
      <div className="collector-row collector-note"><label>{t("salesNote")}:</label><input maxLength="1000" value={notes} onChange={event=>setNotes(event.target.value)}/></div>
      <div className="collector-row"><label>{t("optionalField")}:</label><div className="field-pills"><span>{t("boxCount")}</span><span>{t("packCount")}</span><b>{t("quantity")}</b><span>{t("unitPrice")}</span><span>{t("salesNote")}</span></div></div>
      <div className="collector-row format-row"><label>{t("inputFormat")}:</label><strong>{delimiter==="comma"?t("collectorCommaFormat"):t("collectorSpaceFormat")}</strong></div>
      <div className="collector-input-row"><label>{t("inputContent")}:</label><textarea autoFocus value={input} onChange={event=>{setInput(event.target.value);setResult(null);setProgress(0)}} placeholder={t("collectorInputPlaceholder")}/></div>
      {error&&<div className="form-error collector-message">{error}</div>}
      {toast&&<div className="collector-success"><Check size={16}/>{toast}</div>}
      <div className="collector-actions"><button className="outline" onClick={check} disabled={saving}>1. {t("checkGoods")}</button><button className="primary" onClick={importOrder} disabled={saving||!result||Boolean(result.errors.length)}>2. {saving?t("saving"):t("importOrder")}</button><button className="outline collector-reset" title={t("resetImport")} aria-label={t("resetImport")} onClick={reset} disabled={saving}><RefreshCw size={19}/></button></div>
      <div className="collector-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{width:`${progress}%`}}></span><small>{progress}%</small></div>
    </section>
    {result&&<section className="collector-results panel"><div className="collector-result-head"><b>{result.errors.length?t("collectorCheckErrors"):t("collectorCheckPassed")}</b><span>{result.lineCount} {t("collectorRecords")} · {result.rows.length} {t("collectorProducts")}</span></div>
      {result.rows.length>0&&<div className="table-wrap"><table><thead><tr><th>{t("lineNumber")}</th><th>{t("productSku")}/{t("productBarcode")}</th><th>{t("productName")}</th><th>{t("currentStock")}</th><th>{t("quantity")}</th><th>{t("unitPrice")}</th><th>{t("lineTotal")}</th></tr></thead><tbody>{result.rows.map(row=><tr key={row.product.id}><td>{row.line}</td><td><b>{row.code}</b></td><td>{row.product.name}</td><td>{row.product.stock}</td><td><b className={row.quantity<0?"stock-low":"stock-ok"}>{row.quantity}</b></td><td>{money(productPrice(row.product,currency),currency)}</td><td>{money(productPrice(row.product,currency)*row.quantity,currency)}</td></tr>)}</tbody></table></div>}
      {result.errors.length>0&&<div className="collector-errors">{result.errors.map((item,index)=><div key={`${item.line}-${index}`}><b>{t("lineNumber")} {item.line}</b><span>{item.message}</span></div>)}</div>}
    </section>}
  </div>;
}

function Reports({products,summary}) { const {t}=useI18n(),totals=summary?.salesTotals||{HUF:0,EUR:0,USD:0},stock=summary?.stockTotal??products.reduce((s,p)=>s+p.stock,0);return <Page><div className="report-summary"><Stat icon={ShoppingCart} color="#3f9fea" label={t("salesHuf")} value={money(totals.HUF,"HUF")} suffix={t("currentPeriod")}/><Stat icon={ShoppingCart} color="#26b99a" label={t("salesEur")} value={money(totals.EUR,"EUR")} suffix={t("currentPeriod")}/><Stat icon={CircleDollarSign} color="#f05a78" label={t("salesUsd")} value={money(totals.USD,"USD")} suffix={t("currentPeriod")}/><Stat icon={Warehouse} color="#f6a43a" label={t("inventory")} value={stock} suffix={t("pieces")}/></div><section className="panel reports-panel"><h2>报表</h2>{[["货物",["入库报表","采购价格变动","库存报表","调拨分析报表","库存盘点报表","进销存报表"]],["客户",["客户报表","客户账目分析"]],["销售",["销售报表","销售分析","销售趋势图","客单价报表","销售饼状图","利润报表"]],["财务",["财务流水报表","还款报表","日结单","月结单","业绩报表"]]].map(([g,items])=><div className="report-group" key={g}><h3>{g}</h3><div>{items.map((x,i)=><button key={x}><FileBarChart size={18} color={["#3f9fea","#f6a43a","#26b99a"][i%3]}/>{x}</button>)}</div></div>)}</section></Page>; }

function SettingsPage({currentUser,onOpenEmployees}) {
  const {t}=useI18n();
  return <Page><section className="panel settings-panel"><h2>{t("systemSettings")}</h2><div className="settings-grid">{[[Store,"基础信息","企业名称、货币与语言"],[Warehouse,"仓库管理","多仓库与门店库存"],[Truck,"供货商","采购供货商资料"],[Tags,"各种选项","分类、单位与价格规则"],[Database,"系统日志","审计、备份与恢复"]].map(([I,title,description])=><button key={title}><I/><span><b>{title}</b><small>{description}</small></span><ChevronDown/></button>)}{currentUser.role==="admin"&&<button onClick={onOpenEmployees}><Users/><span><b>{t("employeeManagement")}</b><small>{t("employeeAccessDescription")}</small></span><ChevronDown/></button>}</div></section></Page>
}

function UserManagementPage({currentUser,users,onCreateUser,onUpdateUser,loading=false,error=""}) {
  const {t}=useI18n();
  const [modal,setModal]=useState(false);
  return <Page><section className="panel settings-panel user-management"><div className="panel-heading"><h2>{t("employeeManagement")}</h2><button className="primary" onClick={()=>setModal(true)} disabled={loading}><Plus size={16}/>{t("addUser")}</button></div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap"><table><thead><tr><th>{t("username")}</th><th>{t("displayName")}</th><th>{t("role")}</th><th>{t("statusLabel")}</th><th>{t("lastLogin")}</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td>{user.username}</td><td>{user.displayName}</td><td><select value={user.role} disabled={loading||user.id===currentUser.id} onChange={e=>onUpdateUser(user.id,{role:e.target.value})}>{roleOptions.map(role=><option key={role} value={role}>{t(`role_${role}`)}</option>)}</select></td><td><button className={user.enabled?"status done":"status pending"} disabled={loading||user.id===currentUser.id} onClick={()=>onUpdateUser(user.id,{enabled:!user.enabled})}>{user.enabled?t("enabled"):t("disabled")}</button></td><td>{user.lastLoginAt?new Date(user.lastLoginAt).toLocaleString():"—"}</td></tr>)}</tbody></table>{!users.length&&<div className="empty">{t("noData")}</div>}</div>{modal&&<UserModal onClose={()=>setModal(false)} onSave={async data=>{await onCreateUser(data);setModal(false)}}/>}</section></Page>
}

function UserModal({onClose,onSave}) {
  const {t}=useI18n();
  const [form,setForm]=useState({username:"",displayName:"",password:"",role:"sales"}),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const save=async()=>{if(!form.username||form.password.length<8)return setError(t("userRequirements"));setSaving(true);setError("");try{await onSave(form)}catch(e){setError(`${t("userCreateFailed")}：${e.message}`)}finally{setSaving(false)}};
  return <Modal title={t("addUser")} onClose={onClose}><div className="form-grid"><label>{t("username")}<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>{t("displayName")}<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label><label>{t("password")}<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>{t("role")}<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{roleOptions.map(role=><option key={role} value={role}>{t(`role_${role}`)}</option>)}</select></label></div>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button className="outline" onClick={onClose} disabled={saving}>{t("cancel")}</button><button className="primary" onClick={save} disabled={saving}>{saving?t("saving"):t("save")}</button></div></Modal>
}

function Page({children}) {return <div className="page-content">{children}</div>}
function Modal({title,onClose,children,wide=false}) {return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className={`modal${wide?" modal-wide":""}`}><div className="modal-head"><b>{title}</b><button className="icon-btn" onClick={onClose}><X size={19}/></button></div>{children}</div></div>}

export function App() {
  const [session,setSession]=useState(getStoredSession);
  const [page,setPage]=useState("dashboard"),[menuOpen,setMenuOpen]=useState(false);
  const [products,setProducts]=useState([]),[customers,setCustomers]=useState([]),[purchases,setPurchases]=useState([]),[sales,setSales]=useState([]),[users,setUsers]=useState([]);
  const [editingSale,setEditingSale]=useState(null),[settlementSale,setSettlementSale]=useState(null),[settlementLoading,setSettlementLoading]=useState(false),[settlementError,setSettlementError]=useState("");
  const [salesFilters,setSalesFilters]=useState(defaultSalesFilters);
  const [dashboardSummary,setDashboardSummary]=useState(null),[reportSummary,setReportSummary]=useState(null);
  const [dataLoading,setDataLoading]=useState(false),[dataError,setDataError]=useState("");
  useEffect(()=>{const close=()=>setMenuOpen(false);window.addEventListener("resize",close);return()=>window.removeEventListener("resize",close)},[]);
  useEffect(()=>{if(page!=="scanSales")setEditingSale(null)},[page]);
  const logout=()=>{clearStoredSession();setSession(null);setProducts([]);setCustomers([]);setPurchases([]);setSales([]);setUsers([]);setEditingSale(null);setSettlementSale(null);setSalesFilters(defaultSalesFilters())};
  const handleError=(error)=>{if(error instanceof ApiError&&error.status===401){logout();return}setDataError(error.message)};
  const loadAll=async(token=session?.token)=>{if(!token)return;setDataLoading(true);setDataError("");try{const nextIdentity=await fetchCurrentUser(token),role=nextIdentity.role;const [nextProducts,nextCustomers,nextPurchases,nextSales,nextDashboard,nextReport,nextUsers]=await Promise.all([fetchProducts(token),["admin","sales","finance"].includes(role)?fetchCustomers(token):Promise.resolve([]),["admin","purchasing","warehouse","finance"].includes(role)?fetchPurchases(token):Promise.resolve([]),["admin","sales","finance"].includes(role)?fetchSales(token,salesFilters):Promise.resolve([]),fetchDashboard(token),["admin","finance"].includes(role)?fetchReportSummary(token):Promise.resolve(null),role==="admin"?fetchUsers(token):Promise.resolve([])]);setProducts(nextProducts);setCustomers(nextCustomers);setPurchases(nextPurchases);setSales(nextSales);setDashboardSummary(nextDashboard);setReportSummary(nextReport);setUsers(nextUsers);const refreshedSession={...session,user:nextIdentity};storeSession(refreshedSession);setSession(refreshedSession)}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const loadProducts=async(search="")=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setProducts(await fetchProducts(session.token,search))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const loadCustomers=async(search="")=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setCustomers(await fetchCustomers(session.token,search))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const refreshPurchases=async()=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setPurchases(await fetchPurchases(session.token))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const refreshSales=async(filters=salesFilters)=>{if(!session?.token)return;setSalesFilters(filters);setDataLoading(true);setDataError("");try{setSales(await fetchSales(session.token,filters))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const refreshReport=()=>["admin","finance"].includes(session?.user?.role)?fetchReportSummary(session.token):Promise.resolve(reportSummary);
  useEffect(()=>{if(session?.token)loadAll(session.token)},[session?.token]);
  const login=async(username,password)=>{const next=await loginRequest(username,password);storeSession(next);setSession(next)};
  const addProduct=async(product)=>{const created=await createProductRequest(session.token,product);setProducts(current=>[created,...current]);const [nextDashboard,nextReport]=await Promise.all([fetchDashboard(session.token),refreshReport()]);setDashboardSummary(nextDashboard);setReportSummary(nextReport)};
  const changeProduct=async(id,product)=>{const updated=await updateProductRequest(session.token,id,product);setProducts(current=>current.map(item=>item.id===updated.id?updated:item));return updated};
  const loadProductDetail=async id=>fetchProduct(session.token,id);
  const addCustomer=async(customer)=>{const created=await createCustomerRequest(session.token,customer);setCustomers(current=>[created,...current]);setDashboardSummary(await fetchDashboard(session.token))};
  const addPurchase=async(purchase)=>{await createPurchaseRequest(session.token,purchase);const [nextProducts,nextPurchases,nextDashboard,nextReport]=await Promise.all([fetchProducts(session.token),fetchPurchases(session.token),fetchDashboard(session.token),refreshReport()]);setProducts(nextProducts);setPurchases(nextPurchases);setDashboardSummary(nextDashboard);setReportSummary(nextReport)};
  const addSale=async(sale)=>{const created=await createSaleRequest(session.token,sale);const [nextProducts,nextSales,nextDashboard,nextReport]=await Promise.all([fetchProducts(session.token),fetchSales(session.token,salesFilters),fetchDashboard(session.token),refreshReport()]);setProducts(nextProducts);setSales(nextSales);setDashboardSummary(nextDashboard);setReportSummary(nextReport);return created};
  const loadSaleDetail=async id=>fetchSale(session.token,id);
  const openSaleForEdit=async id=>{const detail=await fetchSale(session.token,id);setEditingSale(detail);setPage("scanSales");return detail};
  const openSettlement=async sale=>{setSettlementSale(sale);setSettlementError("");setSettlementLoading(true);setPage("saleSettlement");try{setSettlementSale(await fetchSale(session.token,sale.databaseId))}catch(error){setSettlementError(error.message)}finally{setSettlementLoading(false)}};
  const addSalePayment=async payment=>{if(!settlementSale?.databaseId)return;await createSalePaymentRequest(session.token,settlementSale.databaseId,payment);const [detail,nextSales]=await Promise.all([fetchSale(session.token,settlementSale.databaseId),fetchSales(session.token,salesFilters)]);setSettlementSale(detail);setSales(nextSales);return detail};
  const changeSale=async(id,sale)=>{await updateSaleRequest(session.token,id,sale);const [nextProducts,nextSales,nextDashboard,nextReport,detail]=await Promise.all([fetchProducts(session.token),fetchSales(session.token,salesFilters),fetchDashboard(session.token),refreshReport(),fetchSale(session.token,id)]);setProducts(nextProducts);setSales(nextSales);setDashboardSummary(nextDashboard);setReportSummary(nextReport);setEditingSale(detail);return detail};
  const changeSaleStatus=async(id,changes)=>{await updateSaleStatusRequest(session.token,id,changes);setSales(current=>current.map(sale=>sale.databaseId===id?{...sale,...changes}:sale));if(typeof changes.stockDeducted==="boolean"){try{const [nextProducts,nextDashboard,nextReport]=await Promise.all([fetchProducts(session.token),fetchDashboard(session.token),refreshReport()]);setProducts(nextProducts);setDashboardSummary(nextDashboard);setReportSummary(nextReport)}catch(error){handleError(error)}}};
  const addUser=async(user)=>{const created=await createUserRequest(session.token,user);setUsers(current=>[...current,created])};
  const changeUser=async(id,changes)=>{const updated=await updateUserRequest(session.token,id,changes);setUsers(current=>current.map(user=>user.id===updated.id?updated:user))};
  if(!session?.user)return <Login onLogin={login}/>;
  const salesPage=<Sales sales={sales} filters={salesFilters} onRefresh={refreshSales} onLoadDetail={loadSaleDetail} onToggleStatus={changeSaleStatus} onOpenSettlement={openSettlement} loading={dataLoading} error={dataError} canUpdateStatus={["admin","sales"].includes(session.user.role)} canSettle={["admin","sales","finance"].includes(session.user.role)}/>;
  const content=({
    dashboard:<Dashboard products={products} customers={customers} sales={sales} summary={dashboardSummary} setPage={setPage}/>,
    products:<Products products={products} onCreate={addProduct} onUpdate={changeProduct} onLoad={loadProducts} onLoadDetail={loadProductDetail} loading={dataLoading} error={dataError} canCreate={["admin","purchasing","warehouse"].includes(session.user.role)} canEdit={["admin","purchasing","warehouse"].includes(session.user.role)}/>,
    purchases:<Purchases purchases={purchases} products={products} onCreate={addPurchase} onRefresh={refreshPurchases} loading={dataLoading} error={dataError} canCreate={["admin","purchasing","warehouse"].includes(session.user.role)}/>,
    inventory:<Products products={products} onCreate={addProduct} onUpdate={changeProduct} onLoad={loadProducts} onLoadDetail={loadProductDetail} loading={dataLoading} error={dataError} inventoryOnly canCreate={["admin","purchasing","warehouse"].includes(session.user.role)} canEdit={false}/>,
    customers:<Customers customers={customers} onCreate={addCustomer} onLoad={loadCustomers} loading={dataLoading} error={dataError} canCreate={["admin","sales"].includes(session.user.role)}/>,
    sales:salesPage,pos:<POS products={products} customers={customers} sale={editingSale} onSaveSale={addSale} onUpdateSale={changeSale} onCloseEdit={()=>setEditingSale(null)}/>,
    saleSettlement:<SettlementPage sale={settlementSale} loading={settlementLoading} error={settlementError} onSubmit={addSalePayment} onCancel={()=>{setSettlementSale(null);setSettlementError("");setPage("sales")}}/>,
    collectorSales:<CollectorSales products={products} onSaveSale={addSale} onImported={openSaleForEdit}/>,
    reports:<Reports products={products} summary={reportSummary}/>,
    users:<UserManagementPage currentUser={session.user} users={users} onCreateUser={addUser} onUpdateUser={changeUser} loading={dataLoading} error={dataError}/>,
    settings:<SettingsPage currentUser={session.user} onOpenEmployees={()=>setPage("users")}/>
  })[pageTargets[page]||page];
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={menuOpen} setOpen={setMenuOpen} role={session.user.role}/>{menuOpen&&<button className="sidebar-scrim" aria-label="关闭菜单" onClick={()=>setMenuOpen(false)}/>}<main className="main-shell"><Header page={page} user={session.user.username} onLogout={logout} toggleMenu={()=>setMenuOpen(v=>!v)}/>{content}</main></div>;
}
