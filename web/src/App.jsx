import { useEffect, useState } from "react";
import {
  BarChart3, Boxes, ChevronDown, CircleDollarSign, ClipboardList, Database,
  FileBarChart, FileText, Home, LogOut, Menu, Package, Plus, RefreshCw,
  ScanLine, Search, Settings, ShoppingCart, Store, Tags, Truck, Users,
  Warehouse, X, Check, Pencil, ArrowDownToLine, WalletCards, Bell, Trash2,
} from "lucide-react";
import { useI18n } from "./i18n.jsx";
import {
  ApiError, clearStoredSession, createCustomer as createCustomerRequest,
  createProduct as createProductRequest, createPurchase as createPurchaseRequest, createUser as createUserRequest,
  createSale as createSaleRequest, fetchCurrentUser, fetchCustomers, fetchDashboard, fetchProducts,
  fetchPurchases, fetchReportSummary, fetchSales, fetchUsers, getStoredSession,
  login as loginRequest, storeSession, updateUser as updateUserRequest,
} from "./api.js";

const pageNames = { dashboard: "dashboard", products: "products", purchases: "purchase", inventory: "inventory", customers: "customerList", sales: "salesList", pos: "scanSales", reports: "reports", users: "employeeManagement", settings: "settings" };
const roleOptions = ["admin","purchasing","warehouse","sales","finance"];
const pageRoles = {
  purchases: ["admin","purchasing","warehouse","finance"],
  customers: ["admin","sales","finance"], sales: ["admin","sales","finance"],
  pos: ["admin","sales"], reports: ["admin","finance"], users: ["admin"],
};
const canAccess = (role,page) => !pageRoles[page] || pageRoles[page].includes(role);

const menu = [
  { id: "dashboard", labelKey: "dashboard", icon: Home },
  { labelKey: "control", icon: BarChart3, children: [{ id: "dashboard", labelKey: "operatingControl" }, { id: "purchases", labelKey: "smartPurchase" }] },
  { labelKey: "goods", icon: Boxes, children: [{ id: "products", labelKey: "products" }, { id: "purchases", labelKey: "purchase" }, { id: "inventory", labelKey: "inventory" }, { id: "products", labelKey: "categories" }] },
  { labelKey: "customers", icon: Users, children: [{ id: "customers", labelKey: "customerList" }, { id: "customers", labelKey: "customerAccounts" }] },
  { labelKey: "sales", icon: ShoppingCart, children: [{ id: "sales", labelKey: "salesList" }, { id: "pos", labelKey: "scanRetail" }, { id: "pos", labelKey: "scanSales" }, { id: "sales", labelKey: "returns" }] },
  { labelKey: "finance", icon: CircleDollarSign, children: [{ id: "reports", labelKey: "flowDetails" }, { id: "reports", labelKey: "orderFinance" }] },
  { labelKey: "invoice", icon: FileText, children: [{ id: "sales", labelKey: "invoiceList" }, { id: "sales", labelKey: "issueInvoice" }] },
  { id: "reports", labelKey: "reports", icon: FileBarChart },
  { labelKey: "cloudStore", icon: Store, children: [{ id: "products", labelKey: "cloudProducts" }, { id: "settings", labelKey: "cloudSettings" }] },
  { id: "users", labelKey: "employeeManagement", icon: Users },
  { id: "settings", labelKey: "settings", icon: Settings },
];

const money = (n) => new Intl.NumberFormat("zh-CN").format(Number(n || 0)) + " Ft";

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
    <div className="exchange">EUR/HUF: 357.351<br/>USD/HUF: 313.465</div>
  </aside>;
}

function Header({ page, user, onLogout, toggleMenu }) {
  const { t, locale, setLocale, locales } = useI18n();
  return <><header className="header"><button className="icon-btn menu-btn" onClick={toggleMenu}><Menu size={23}/></button><b>{t(pageNames[page])}</b><div className="header-spacer"/><span className="date">2026-07-13 09:24</span><select className="language-select" aria-label="Language" value={locale} onChange={e=>setLocale(e.target.value)}>{locales.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select><button className="icon-btn"><Bell size={19}/><i>1</i></button><div className="user-chip">{user}<ChevronDown size={13}/></div><button title={t("logout")} className="icon-btn" onClick={onLogout}><LogOut size={18}/></button></header><div className="tabs"><span>{t("dashboard")}</span><span className="active">● {t(pageNames[page])} ×</span></div></>;
}

function Stat({ icon: Icon, color, label, value, suffix }) { return <div className="stat-card"><div className="stat-icon" style={{color,background:`${color}18`}}><Icon size={31}/></div><div><small>{label}</small><strong>{value}</strong><span>{suffix}</span></div></div>; }

function Dashboard({ products, customers, sales, summary, setPage }) {
  const stock = summary?.products.stock ?? products.reduce((s,p)=>s+p.stock,0), revenue=summary?.sales.total ?? 0;
  return <div className="page-content">
    <div className="smart-actions"><button className="outline danger">智能采购 推荐进货: 51</button><button className="outline success">推荐供货商</button><button className="outline" onClick={()=>setPage("reports")}>新老板视图</button></div>
    <div className="stats-grid"><Stat icon={Boxes} color="#26b99a" label="货物" value={summary?.products.count ?? products.length} suffix="种商品"/><Stat icon={ShoppingCart} color="#3f9fea" label="今日销售" value={money(revenue)} suffix={`${summary?.sales.count ?? 0} 笔订单`}/><Stat icon={CircleDollarSign} color="#f05a78" label="库存成本" value={money(products.reduce((s,p)=>s+p.stock*p.cost*390,0))} suffix={`${stock} 件库存`}/><Stat icon={Users} color="#42c7c7" label="客户" value={summary?.customers.count ?? customers.length} suffix="活跃客户"/></div>
    <div className="quick-row"><button onClick={()=>setPage("purchases")}><ArrowDownToLine/>新品入库</button><button onClick={()=>setPage("pos")}><ScanLine/>扫码销售</button><button onClick={()=>setPage("reports")}><WalletCards/>财务</button><button onClick={()=>setPage("reports")}><BarChart3/>销售报表</button></div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-title">近 7 日销售趋势</div><div className="bar-chart">{[42,58,37,72,66,89,76].map((h,i)=><div key={i}><span style={{height:`${h}%`}}></span><small>{i+7}日</small></div>)}</div></section><section className="panel"><div className="panel-title">最近销售</div><CompactTable rows={sales.slice(0,6)} columns={["id","qty","total","customer"]}/></section></div>
    <div className="rank-grid">{[
      ["7天热销数量",products.slice(0,3)],["7天热销金额",products.slice(1,4)],["7天热销利润",products.slice(2,5)],["7天库存预警",products.filter(p=>p.stock<100)]
    ].map(([title,items])=><section className="rank-card" key={title}><div className="panel-title">{title}<ChevronDown size={15}/></div>{items.map((p,i)=><div className="rank-line" key={p.id}><b>{i+1}</b><span>{p.sku} {p.name}</span><em>{p.stock}</em></div>)}</section>)}</div>
  </div>;
}

function Toolbar({ search, setSearch, onAdd, onSearch, onRefresh, busy=false, placeholder="搜索货号、条码或名称" }) { const {t}=useI18n(); return <div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder={placeholder} value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSearch?.()}/></div><select><option>{t("select")}</option><option>{t("all")}</option></select><button className="primary" onClick={onSearch} disabled={busy}><Search size={16}/>{t("search")}</button><div className="toolbar-spacer"/><button className="outline" onClick={onRefresh} disabled={busy}><RefreshCw size={16}/>{t("refresh")}</button>{onAdd&&<button className="primary" onClick={onAdd} disabled={busy}><Plus size={16}/>{t("add")}</button>}</div>; }

function DataTable({ columns, rows, renderCell }) { const {t}=useI18n(); return <div className="table-wrap"><table><thead><tr><th><input type="checkbox"/></th>{columns.map(c=><th key={c.key}>{c.label}</th>)}<th>{t("actions")}</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><input type="checkbox"/></td>{columns.map(c=><td key={c.key}>{renderCell?renderCell(row,c):row[c.key]}</td>)}<td><div className="row-actions"><button title="编辑"><Pencil size={16}/></button><button title="详情"><ClipboardList size={16}/></button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">{t("noData")}</div>}</div>; }
function CompactTable({rows,columns}) { return <div className="compact-table">{rows.map(r=><div key={r.id}>{columns.map(c=><span key={c}>{c==="total"?money(r[c]):r[c]}</span>)}</div>)}</div>; }

function Products({ products, onCreate, onLoad, loading=false, error="", inventoryOnly=false, canCreate=true }) {
  const { t } = useI18n();
  const [search,setSearch]=useState(""), [modal,setModal]=useState(false);
  const filtered=products.filter(p=>`${p.sku}${p.barcode}${p.name}${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const add=async(data)=>{await onCreate(data);setModal(false)};
  const columns=inventoryOnly?[
    {key:"sku",label:"货号"},{key:"name",label:"产品名"},{key:"category",label:"分类"},{key:"supplier",label:"仓库/供货商"},{key:"stock",label:"库存量"},{key:"box",label:"箱数"}
  ]:[{key:"sku",label:"货号"},{key:"barcode",label:"条码"},{key:"name",label:"产品名"},{key:"category",label:"分类"},{key:"cost",label:"单价"},{key:"boxSize",label:"/箱装数"},{key:"price",label:"第二货币价格"},{key:"stock",label:"入库统计"}];
  return <Page><Toolbar search={search} setSearch={setSearch} onAdd={canCreate?()=>setModal(true):undefined} onSearch={()=>onLoad(search)} onRefresh={()=>{setSearch("");onLoad("")}} busy={loading}/>{error&&<div className="form-error page-error">{t("productsLoadFailed")}：{error} <button className="outline" onClick={()=>onLoad(search)}>{t("retry")}</button></div>}{loading&&<div className="empty">{t("loadingProducts")}</div>}<div className="filter-strip"><span>全部</span><span className="selected">仅显示有库存</span><span>仅显示零库存</span></div><DataTable columns={columns} rows={filtered} renderCell={(r,c)=>c.key==="cost"?`${r.cost.toFixed(2)} €`:c.key==="price"?money(r.price):c.key==="stock"?<b className={r.stock<20?"stock-low":"stock-ok"}>{r.stock}</b>:c.key==="box"?(r.stock/r.boxSize).toFixed(1):r[c.key]}/>{modal&&<ProductModal onClose={()=>setModal(false)} onSave={add}/>}</Page>;
}

function ProductModal({onClose,onSave}) { const {t}=useI18n(); const [form,setForm]=useState({sku:"",barcode:"",name:"",category:""}); const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const save=async()=>{if(!form.sku||!form.name)return setError(t("requiredProductFields"));setError("");setSaving(true);try{await onSave(form)}catch(e){setError(`${t("productCreateFailed")}：${e.message}`)}finally{setSaving(false)}}; return <Modal title={t("newProduct")} onClose={onClose}><div className="form-grid">{Object.entries({sku:"货号",barcode:"条码",name:"产品名称",category:"分类"}).map(([k,l])=><label key={k}>{l}<input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}</div>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button className="outline" onClick={onClose} disabled={saving}>{t("cancel")}</button><button className="primary" onClick={save} disabled={saving}>{saving?t("saving"):t("save")}</button></div></Modal>; }

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

function Sales({sales,onRefresh,loading=false,error=""}) { const {t}=useI18n(); const [search,setSearch]=useState("");return <Page><Toolbar search={search} setSearch={setSearch} onSearch={()=>{}} onRefresh={onRefresh} busy={loading} placeholder="搜索销售单号或客户"/>{error&&<div className="form-error">{t("dataLoadFailed")}：{error}</div>}<DataTable rows={sales.filter(s=>`${s.id}${s.customer}`.toLowerCase().includes(search.toLowerCase()))} columns={[{key:"id",label:"销售单号"},{key:"date",label:"订单日期"},{key:"customer",label:"客户"},{key:"qty",label:"总数"},{key:"total",label:"总价"},{key:"status",label:"状态"}]} renderCell={(r,c)=>c.key==="total"?money(r.total):c.key==="status"?<span className="status done">{r.status}</span>:r[c.key]}/></Page>; }

function POS({products,customers,onSaveSale}) {
  const {t}=useI18n();
  const [query,setQuery]=useState(""),[cart,setCart]=useState([]),[customerId,setCustomerId]=useState(""),[toast,setToast]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{if(!customerId&&customers[0])setCustomerId(String(customers[0].id))},[customers,customerId]);
  const addProduct=(p)=>setCart(v=>{const found=v.find(x=>x.id===p.id);return found?v.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x):[...v,{...p,qty:1}]});
  const scan=(e)=>{e.preventDefault();const p=products.find(p=>p.barcode===query||p.sku===query)||products.find(p=>p.name.includes(query));if(p)addProduct(p);setQuery("")};
  const total=cart.reduce((s,p)=>s+p.price*p.qty,0);
  const save=async()=>{if(!cart.length)return;const overstock=cart.find(item=>item.qty>item.stock);if(overstock)return setError(`${overstock.name}：${t("insufficientStock")}`);setSaving(true);setError("");try{await onSaveSale({customerId:customerId?Number(customerId):null,total,items:cart.map(item=>({productId:item.id,quantity:item.qty,price:item.price}))});setCart([]);setToast(t("orderSaved"));setTimeout(()=>setToast(""),2200)}catch(e){setError(`${t("saleSaveFailed")}：${e.message}`)}finally{setSaving(false)}};
  return <div className="pos-page"><div className="pos-main"><form className="scan-bar" onSubmit={scan}><select><option>× 1 / 个 / Ft</option></select><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="请扫描条码、输入货号或商品名"/><button className="outline" type="button">新品(F9)</button></form><div className="product-picks">{products.slice(0,5).map(p=><button key={p.id} onClick={()=>addProduct(p)}><Package size={17}/>{p.sku}<small>{p.name}</small></button>)}</div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap cart-table"><table><thead><tr><th>货号</th><th>产品</th><th>库存</th><th>原价</th><th>数量</th><th>售价</th><th></th></tr></thead><tbody>{cart.map(p=><tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.stock}</td><td>{money(p.price)}</td><td><div className="qty"><button onClick={()=>setCart(v=>v.map(x=>x.id===p.id?{...x,qty:Math.max(1,x.qty-1)}:x))}>−</button>{p.qty}<button onClick={()=>setCart(v=>v.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x))}>+</button></div></td><td>{money(p.price*p.qty)}</td><td><button className="icon-btn" onClick={()=>setCart(v=>v.filter(x=>x.id!==p.id))}><X size={16}/></button></td></tr>)}</tbody></table>{!cart.length&&<div className="empty">扫描或选择商品后会出现在这里</div>}</div></div><aside className="checkout"><div className="checkout-total"><span>{t("total")}</span><b>{money(total)}</b></div><label>{t("customer")}<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">{t("walkInCustomer")}</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="danger-soft" onClick={()=>setCart([])} disabled={saving}>{t("clear")}</button><button className="save-order" disabled={!cart.length||saving} onClick={save}><Check size={18}/>{saving?t("saving"):t("saveOrder")}</button></aside>{toast&&<div className="toast"><Check size={17}/>{toast}</div>}</div>;
}

function Reports({products,summary}) { const revenue=summary?.salesTotal||0,purchase=summary?.purchaseTotal||0,stock=summary?.stockTotal??products.reduce((s,p)=>s+p.stock,0);return <Page><div className="report-summary"><Stat icon={ShoppingCart} color="#3f9fea" label="销售额" value={money(revenue)} suffix="本期"/><Stat icon={Truck} color="#26b99a" label="采购额" value={money(purchase)} suffix="本期"/><Stat icon={Warehouse} color="#f6a43a" label="库存" value={stock} suffix="件"/><Stat icon={CircleDollarSign} color="#f05a78" label="销售采购差额" value={money(revenue-purchase)} suffix="本期"/></div><section className="panel reports-panel"><h2>报表</h2>{[["货物",["入库报表","采购价格变动","库存报表","调拨分析报表","库存盘点报表","进销存报表"]],["客户",["客户报表","客户账目分析"]],["销售",["销售报表","销售分析","销售趋势图","客单价报表","销售饼状图","利润报表"]],["财务",["财务流水报表","还款报表","日结单","月结单","业绩报表"]]].map(([g,items])=><div className="report-group" key={g}><h3>{g}</h3><div>{items.map((x,i)=><button key={x}><FileBarChart size={18} color={["#3f9fea","#f6a43a","#26b99a"][i%3]}/>{x}</button>)}</div></div>)}</section></Page>; }

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
  const [dashboardSummary,setDashboardSummary]=useState(null),[reportSummary,setReportSummary]=useState(null);
  const [dataLoading,setDataLoading]=useState(false),[dataError,setDataError]=useState("");
  useEffect(()=>{const close=()=>setMenuOpen(false);window.addEventListener("resize",close);return()=>window.removeEventListener("resize",close)},[]);
  const logout=()=>{clearStoredSession();setSession(null);setProducts([]);setCustomers([]);setPurchases([]);setSales([]);setUsers([])};
  const handleError=(error)=>{if(error instanceof ApiError&&error.status===401){logout();return}setDataError(error.message)};
  const loadAll=async(token=session?.token)=>{if(!token)return;setDataLoading(true);setDataError("");try{const nextIdentity=await fetchCurrentUser(token),role=nextIdentity.role;const [nextProducts,nextCustomers,nextPurchases,nextSales,nextDashboard,nextReport,nextUsers]=await Promise.all([fetchProducts(token),["admin","sales","finance"].includes(role)?fetchCustomers(token):Promise.resolve([]),["admin","purchasing","warehouse","finance"].includes(role)?fetchPurchases(token):Promise.resolve([]),["admin","sales","finance"].includes(role)?fetchSales(token):Promise.resolve([]),fetchDashboard(token),["admin","finance"].includes(role)?fetchReportSummary(token):Promise.resolve(null),role==="admin"?fetchUsers(token):Promise.resolve([])]);setProducts(nextProducts);setCustomers(nextCustomers);setPurchases(nextPurchases);setSales(nextSales);setDashboardSummary(nextDashboard);setReportSummary(nextReport);setUsers(nextUsers);const refreshedSession={...session,user:nextIdentity};storeSession(refreshedSession);setSession(refreshedSession)}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const loadProducts=async(search="")=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setProducts(await fetchProducts(session.token,search))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const loadCustomers=async(search="")=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setCustomers(await fetchCustomers(session.token,search))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const refreshPurchases=async()=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setPurchases(await fetchPurchases(session.token))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  const refreshSales=async()=>{if(!session?.token)return;setDataLoading(true);setDataError("");try{setSales(await fetchSales(session.token))}catch(error){handleError(error)}finally{setDataLoading(false)}};
  useEffect(()=>{if(session?.token)loadAll(session.token)},[session?.token]);
  const login=async(username,password)=>{const next=await loginRequest(username,password);storeSession(next);setSession(next)};
  const addProduct=async(product)=>{const created=await createProductRequest(session.token,product);setProducts(current=>[created,...current]);const [nextDashboard,nextReport]=await Promise.all([fetchDashboard(session.token),fetchReportSummary(session.token)]);setDashboardSummary(nextDashboard);setReportSummary(nextReport)};
  const addCustomer=async(customer)=>{const created=await createCustomerRequest(session.token,customer);setCustomers(current=>[created,...current]);setDashboardSummary(await fetchDashboard(session.token))};
  const addPurchase=async(purchase)=>{await createPurchaseRequest(session.token,purchase);const [nextProducts,nextPurchases,nextDashboard,nextReport]=await Promise.all([fetchProducts(session.token),fetchPurchases(session.token),fetchDashboard(session.token),fetchReportSummary(session.token)]);setProducts(nextProducts);setPurchases(nextPurchases);setDashboardSummary(nextDashboard);setReportSummary(nextReport)};
  const addSale=async(sale)=>{await createSaleRequest(session.token,sale);const [nextProducts,nextSales,nextDashboard,nextReport]=await Promise.all([fetchProducts(session.token),fetchSales(session.token),fetchDashboard(session.token),fetchReportSummary(session.token)]);setProducts(nextProducts);setSales(nextSales);setDashboardSummary(nextDashboard);setReportSummary(nextReport)};
  const addUser=async(user)=>{const created=await createUserRequest(session.token,user);setUsers(current=>[...current,created])};
  const changeUser=async(id,changes)=>{const updated=await updateUserRequest(session.token,id,changes);setUsers(current=>current.map(user=>user.id===updated.id?updated:user))};
  if(!session?.user)return <Login onLogin={login}/>;
  const content=({
    dashboard:<Dashboard products={products} customers={customers} sales={sales} summary={dashboardSummary} setPage={setPage}/>,
    products:<Products products={products} onCreate={addProduct} onLoad={loadProducts} loading={dataLoading} error={dataError} canCreate={["admin","purchasing","warehouse"].includes(session.user.role)}/>,
    purchases:<Purchases purchases={purchases} products={products} onCreate={addPurchase} onRefresh={refreshPurchases} loading={dataLoading} error={dataError} canCreate={["admin","purchasing","warehouse"].includes(session.user.role)}/>,
    inventory:<Products products={products} onCreate={addProduct} onLoad={loadProducts} loading={dataLoading} error={dataError} inventoryOnly canCreate={["admin","purchasing","warehouse"].includes(session.user.role)}/>,
    customers:<Customers customers={customers} onCreate={addCustomer} onLoad={loadCustomers} loading={dataLoading} error={dataError} canCreate={["admin","sales"].includes(session.user.role)}/>,
    sales:<Sales sales={sales} onRefresh={refreshSales} loading={dataLoading} error={dataError}/>,pos:<POS products={products} customers={customers} onSaveSale={addSale}/>,
    reports:<Reports products={products} summary={reportSummary}/>,
    users:<UserManagementPage currentUser={session.user} users={users} onCreateUser={addUser} onUpdateUser={changeUser} loading={dataLoading} error={dataError}/>,
    settings:<SettingsPage currentUser={session.user} onOpenEmployees={()=>setPage("users")}/>
  })[page];
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={menuOpen} setOpen={setMenuOpen} role={session.user.role}/>{menuOpen&&<button className="sidebar-scrim" aria-label="关闭菜单" onClick={()=>setMenuOpen(false)}/>}<main className="main-shell"><Header page={page} user={session.user.username} onLogout={logout} toggleMenu={()=>setMenuOpen(v=>!v)}/>{content}</main></div>;
}
