import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { runMigrations } from "./migrate.js";
import { fetchMnbExchangeRates } from "./mnb.js";
import { createInvoiceXml, createStornoXml, queryInvoicePdf, sendInvoiceXml, sendStornoXml } from "./szamlazz.js";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const businessTimezone = process.env.BUSINESS_TIMEZONE || "Europe/Budapest";
const uploadDirectory = process.env.UPLOAD_DIR || fileURLToPath(new URL("../uploads", import.meta.url));
const invoiceDirectory = process.env.INVOICE_DIR || fileURLToPath(new URL("../invoices", import.meta.url));
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "erp",
  password: process.env.PGPASSWORD || "erp",
  database: process.env.PGDATABASE || "erp",
});

app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDirectory, { maxAge: "7d", immutable: true }));

const scrypt = promisify(crypto.scrypt);
const roles = new Set(["admin", "purchasing", "warehouse", "sales", "finance"]);
const configurableRoles = ["purchasing","warehouse","sales","finance"];
const permissionKeys = [
  "page.dashboard","page.products","page.purchases","page.inventory","page.categories","page.customers","page.sales","page.pickingLists","page.scanSales","page.collectorSales","page.flowDetails","page.invoiceList","page.issueInvoice","page.reports","page.settings",
  "products.manage","products.delete","products.images","products.export","inventory.locations","inventory.edit","categories.manage","categories.delete","categories.export","purchases.create","purchases.delete","customers.manage","customers.delete","sales.create","sales.edit","sales.delete","sales.status","sales.settle","sales.print","picking.print","invoices.issue","invoices.manage","invoices.delete","invoices.download","finance.create","reports.export","settings.manage",
];
const permissionKeySet = new Set(permissionKeys);
const currencies = new Set(["HUF","EUR","USD"]);
const manualFinanceCategories={income:new Set(["other_income","capital_injection","interest_income","reimbursement_received"]),expense:new Set(["purchase_expense","freight_expense","operating_expense","salary_expense","tax_expense","other_expense"])};
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
};
const verifyPassword = async (password, stored = "") => {
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(encoded, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
};

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
};
const verify = (token = "") => {
  try {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
};
const auth = async (req, res, next) => {
  const payload = verify(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  const result = await pool.query("select id,username,display_name,role from app_users where lower(username)=lower($1) and enabled=true", [payload.sub]);
  if (!result.rowCount) return res.status(401).json({ error: "unauthorized" });
  const user=result.rows[0];
  const permissions=user.role==="admin"?permissionKeys:(await pool.query("select permission_key from role_permissions where role=$1 and allowed=true",[user.role])).rows.map(row=>row.permission_key);
  req.user = {...user,permissions}; next();
};
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireRole = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "forbidden" });
const requirePermission = permission => (req,res,next) => req.user.role==="admin"||req.user.permissions.includes(permission)?next():res.status(403).json({error:"forbidden"});
const requireAnyPermission = (...permissions) => (req,res,next) => req.user.role==="admin"||permissions.some(permission=>req.user.permissions.includes(permission))?next():res.status(403).json({error:"forbidden"});
const getSystemSettings = async (client=pool) => (await client.query("select * from system_settings where id=true")).rows[0];
const salesPriceForCurrency = (product,currency,settings) => {
  if(currency==="HUF"){
    const hufPrice=Number(product.price||0);
    return hufPrice>0?hufPrice:Math.round(Number(product.price_eur||0)*Number(settings.eur_huf_rate));
  }
  return Number(currency==="EUR"?product.price_eur:product.price_usd)||0;
};
const applySalesDiscount = (price,currency,discountPercent=0) => {
  const discounted=Number(price||0)*(1-Number(discountPercent||0)/100);
  return currency==="HUF"?Math.round(discounted):Number(discounted.toFixed(2));
};
const discountedSalesPrice = (product,currency,settings,discountPercent=0) => {
  return applySalesDiscount(salesPriceForCurrency(product,currency,settings),currency,discountPercent);
};
const customerDiscountForSale = async (client,customerId) => {
  if(!customerId)return 0;
  const customer=await client.query("select c.id,coalesce(g.discount_percent,0)::numeric discount_percent from customers c left join customer_groups g on g.id=c.customer_group_id and g.deleted_at is null where c.id=$1 and c.deleted_at is null",[customerId]);
  if(!customer.rowCount){const error=new Error("customer not found");error.status=400;throw error}
  return Number(customer.rows[0].discount_percent);
};
const salePricingOptions = body => {
  const manualDiscountPercent=Number(body.manualDiscountPercent??0),pricingMode=String(body.pricingMode||"standard");
  if(!Number.isFinite(manualDiscountPercent)||manualDiscountPercent<0||manualDiscountPercent>100){const error=new Error("manual discount must be between 0 and 100");error.status=400;throw error}
  if(!new Set(["standard","last_customer"]).has(pricingMode)){const error=new Error("invalid sale pricing mode");error.status=400;throw error}
  return {manualDiscountPercent,pricingMode};
};
const lastCustomerSalePrices = async (client,customerId,currency,{productIds=null,excludeSaleId=null}={}) => {
  const params=[customerId,currency,excludeSaleId],productFilter=productIds?.length?(params.push(productIds),` and si.product_id=any($${params.length}::bigint[])`):"";
  const result=await client.query(`select distinct on(si.product_id) si.product_id,si.price,s.id sale_id,s.order_no,s.created_at
    from sale_items si join sales s on s.id=si.sale_id
    where s.customer_id=$1 and s.currency=$2 and s.deleted_at is null and si.quantity>0 and ($3::bigint is null or s.id<>$3)${productFilter}
    order by si.product_id,s.created_at desc,s.id desc,si.id desc`,params);
  return result.rows;
};
const productStatisticsSql="select (select coalesce(sum(si.quantity),0)::int from sale_items si join sales s on s.id=si.sale_id where si.product_id=$1 and s.deleted_at is null) sales_quantity,(select imported_purchase_quantity from products where id=$1)+(select coalesce(sum(pi.quantity),0)::int from purchase_items pi join purchases p on p.id=pi.purchase_id where pi.product_id=$1 and p.deleted_at is null and p.status='已入库') purchase_quantity,(select max(p.received_at) from purchase_items pi join purchases p on p.id=pi.purchase_id where pi.product_id=$1 and p.deleted_at is null and p.status='已入库') inbound_at";
const nextSalesOrderNumber = async (client,prefix) => {
  const businessDate=(await client.query("select to_char(now() at time zone $1,'YYYYMMDD') value",[businessTimezone])).rows[0].value;
  const base=`${prefix}${businessDate}-`;
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[base]);
  const result=await client.query(`select coalesce(max(case when substring(order_no from length($1)+1) ~ '^[0-9]+$' then substring(order_no from length($1)+1)::bigint end),0)+1 next_sequence from sales where left(order_no,length($1))=$1`,[base]);
  return `${base}${result.rows[0].next_sequence}`;
};
const isoDatePattern=/^\d{4}-\d{2}-\d{2}$/;
const validIsoDate=value=>isoDatePattern.test(value)&&!Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const invoiceRound=(value,currency)=>Number(Number(value).toFixed(currency==="HUF"?0:2));
const auditMethods=new Set(["POST","PUT","PATCH","DELETE"]);
const auditSensitiveKey=/password|passcode|token|secret|authorization|agent.?key|api.?key/i;
const sanitizeAuditValue=(value,depth=0)=>{
  if(depth>5)return "[maximum depth]";
  if(Buffer.isBuffer(value))return {fileType:"binary",size:value.length};
  if(Array.isArray(value))return value.slice(0,200).map(item=>sanitizeAuditValue(item,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!auditSensitiveKey.test(key)).map(([key,item])=>[key,sanitizeAuditValue(item,depth+1)]));
  if(typeof value==="string")return value.slice(0,1000);
  return value;
};
const auditMetadata=(path,method)=>{
  const parts=path.replace(/^\/api\//,"").split("/").filter(Boolean),root=parts[0]||"system",id=parts[1]||"";
  if(root==="sales"&&parts[2]==="payments")return {module:"finance",action:"record_payment",entityType:"sale",entityId:id};
  if(root==="sales"&&parts[2]==="returns")return {module:"inventory",action:"return_sale",entityType:"sale",entityId:id};
  if(root==="sales"&&parts[2]==="status")return {module:"inventory",action:"update_sale_status",entityType:"sale",entityId:id};
  if(root==="sales"&&parts[2]==="invoice")return {module:"invoices",action:"issue_invoice",entityType:"sale",entityId:id};
  if(root==="invoices"&&parts[2]==="corrections")return {module:"invoices",action:"correct_invoice",entityType:"invoice",entityId:id};
  if(root==="invoices"&&parts[2]==="storno")return {module:"invoices",action:"void_invoice",entityType:"invoice",entityId:id};
  const modules={settings:"system",users:"users","role-permissions":"users",categories:"categories",products:"products",purchases:"inventory",customers:"customers","customer-groups":"customers",sales:"sales",invoices:"invoices","finance-transactions":"finance"};
  const entities={settings:"settings",users:"user","role-permissions":"role",categories:"category",products:"product",purchases:"purchase",customers:"customer","customer-groups":"customer_group",sales:"sale",invoices:"invoice","finance-transactions":"finance_transaction"};
  return {module:modules[root]||root,action:{POST:"create",PUT:"update",PATCH:"update",DELETE:"delete"}[method]||"change",entityType:entities[root]||root,entityId:id};
};

async function ensureAdminUser() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is required");
  const existing = await pool.query("select id,password_hash from app_users where lower(username)=lower($1)", [username]);
  if (!existing.rowCount) {
    await pool.query("insert into app_users(username,password_hash,display_name,role) values($1,$2,$1,'admin')", [username,await hashPassword(password)]);
  } else {
    const passwordHash=await verifyPassword(password,existing.rows[0].password_hash)?existing.rows[0].password_hash:await hashPassword(password);
    await pool.query("update app_users set password_hash=$1,role='admin',enabled=true,updated_at=now() where id=$2", [passwordHash,existing.rows[0].id]);
  }
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  const db = await pool.query("select now() as now");
  res.json({ ok: true, database: db.rows[0].now });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (attempt?.resetAt > now && attempt.count >= maxLoginAttempts) return res.status(429).json({ error: "登录尝试过多，请稍后再试" });
  if (attempt?.resetAt <= now) loginAttempts.delete(key);
  const result = await pool.query("select id,username,password_hash,display_name,role,enabled from app_users where lower(username)=lower($1)", [String(req.body.username || "")]);
  const user = result.rows[0];
  if (!user?.enabled || !await verifyPassword(String(req.body.password || ""), user.password_hash)) {
    const current = loginAttempts.get(key);
    loginAttempts.set(key, { count: (current?.count || 0) + 1, resetAt: current?.resetAt || now + loginWindowMs });
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  loginAttempts.delete(key);
  await pool.query("update app_users set last_login_at=now() where id=$1", [user.id]);
  const permissions=user.role==="admin"?permissionKeys:(await pool.query("select permission_key from role_permissions where role=$1 and allowed=true",[user.role])).rows.map(row=>row.permission_key);
  res.json({ token: sign({ sub: user.username, role: user.role }), user: { id:user.id,username:user.username,displayName:user.display_name,role:user.role,permissions } });
}));

app.use("/api", asyncRoute(auth));

app.use("/api",(req,res,next)=>{
  if(!auditMethods.has(req.method))return next();
  const requestPath=req.originalUrl.split("?")[0],metadata=auditMetadata(requestPath,req.method),startedAt=Date.now();
  let responseTarget={};
  const sendJson=res.json.bind(res);
  res.json=body=>{if(body&&typeof body==="object"&&!Array.isArray(body)){responseTarget=sanitizeAuditValue(Object.fromEntries(Object.entries(body).filter(([key])=>["id","order_no","invoice_number","sku","name","username"].includes(key))))}return sendJson(body)};
  res.on("finish",()=>{
    const contentType=String(req.headers["content-type"]||""),requestDetails=Buffer.isBuffer(req.body)?{fileType:contentType,size:req.body.length}:sanitizeAuditValue(req.body||{});
    const details={request:requestDetails,response:responseTarget,durationMs:Date.now()-startedAt};
    pool.query("insert into audit_logs(user_id,username,user_role,module,action,entity_type,entity_id,http_method,request_path,status_code,success,details,ip_address) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[req.user.id,req.user.username,req.user.role,metadata.module,metadata.action,metadata.entityType,metadata.entityId,req.method,requestPath,res.statusCode,res.statusCode>=200&&res.statusCode<400,details,String(req.ip||req.socket.remoteAddress||"").slice(0,100)]).catch(error=>console.error("Audit log write failed",error));
  });
  next();
});

app.get("/api/auth/me", (req,res)=>res.json({ user: { id:req.user.id,username:req.user.username,displayName:req.user.display_name,role:req.user.role,permissions:req.user.permissions } }));

app.get("/api/mnb-exchange-rates", asyncRoute(async (_req,res)=>{
  try{
    res.set("Cache-Control","private, max-age=300");
    res.json(await fetchMnbExchangeRates());
  }catch(error){
    console.error("MNB exchange-rate request failed",error);
    res.status(502).json({error:"MNB exchange rates unavailable"});
  }
}));

app.get("/api/finance-transactions",requirePermission("page.flowDetails"),asyncRoute(async(req,res)=>{
  const startDate=String(req.query.startDate||""),endDate=String(req.query.endDate||"");
  if((startDate&&!validIsoDate(startDate))||(endDate&&!validIsoDate(endDate))||(startDate&&endDate&&startDate>endDate))return res.status(400).json({error:"invalid date range"});
  const result=await pool.query(`with ledger as (
    select concat('sale_payment:',sp.id) row_key,sp.booked_on occurred_on,'income'::text direction,sp.category,
      sp.method payment_method,s.currency,sp.amount::numeric amount,s.order_no reference_no,coalesce(c.name,'') counterparty,
      sp.note,sp.created_by,sp.created_at,'sale_payment'::text source_type
    from sale_payments sp join sales s on s.id=sp.sale_id left join customers c on c.id=s.customer_id
    where s.deleted_at is null
    union all
    select concat('sale_return:',sr.id),(sr.created_at at time zone $1)::date,'expense','sales_refund','unspecified',
      s.currency,abs(sr.total)::numeric,sr.return_no,coalesce(c.name,''),sr.reason,sr.created_by,sr.created_at,'sale_return'
    from sale_returns sr join sales s on s.id=sr.sale_id left join customers c on c.id=s.customer_id
    where s.deleted_at is null and sr.total<>0
    union all
    select concat('negative_sale:',s.id),(s.created_at at time zone $1)::date,'expense','sales_refund','unspecified',
      s.currency,abs(s.total)::numeric,s.order_no,coalesce(c.name,''),s.notes,s.created_by,s.created_at,'negative_sale'
    from sales s left join customers c on c.id=s.customer_id
    where s.deleted_at is null and s.total<0
    union all
    select concat('manual:',ft.id),ft.occurred_on,ft.direction,ft.category,ft.payment_method,ft.currency,
      ft.amount::numeric,''::text,''::text,ft.note,ft.created_by,ft.created_at,'manual'
    from finance_transactions ft
  ) select * from ledger
    where ($2::date is null or occurred_on >= $2::date) and ($3::date is null or occurred_on <= $3::date)
    order by occurred_on desc,created_at desc,row_key desc limit 5000`,[businessTimezone,startDate||null,endDate||null]);
  const summary=Object.fromEntries([...currencies].map(currency=>[currency,{income:0,expense:0,net:0,cashIncome:0,cashExpense:0,cashNet:0,bankIncome:0,bankExpense:0,bankNet:0,unspecifiedExpense:0}]));
  for(const row of result.rows){
    const values=summary[row.currency],amount=Number(row.amount||0),income=row.direction==="income";
    if(!values)continue;
    values[income?"income":"expense"]+=amount;
    if(row.payment_method==="cash")values[income?"cashIncome":"cashExpense"]+=amount;
    else if(row.payment_method==="bank_transfer")values[income?"bankIncome":"bankExpense"]+=amount;
    else if(!income)values.unspecifiedExpense+=amount;
  }
  for(const values of Object.values(summary)){values.net=values.income-values.expense;values.cashNet=values.cashIncome-values.cashExpense;values.bankNet=values.bankIncome-values.bankExpense}
  res.json({rows:result.rows,summary});
}));

app.post("/api/finance-transactions",requirePermission("finance.create"),asyncRoute(async(req,res)=>{
  const body=req.body||{},occurredOn=String(body.occurredOn||""),direction=String(body.direction||""),category=String(body.category||"").trim().slice(0,100),paymentMethod=String(body.paymentMethod||""),currency=String(body.currency||"").toUpperCase(),amount=Number(body.amount),note=String(body.note||"").trim().slice(0,1000);
  if(!validIsoDate(occurredOn)||!manualFinanceCategories[direction]?.has(category)||!new Set(["cash","bank_transfer"]).has(paymentMethod)||!currencies.has(currency)||!Number.isFinite(amount)||amount<=0||amount>999999999999.99)return res.status(400).json({error:"invalid finance transaction"});
  const result=await pool.query("insert into finance_transactions(occurred_on,direction,category,payment_method,currency,amount,note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",[occurredOn,direction,category,paymentMethod,currency,amount,note,req.user.username]);
  res.status(201).json(result.rows[0]);
}));

app.get("/api/audit-logs",requireRole("admin"),asyncRoute(async(req,res)=>{
  const startDate=String(req.query.startDate||""),endDate=String(req.query.endDate||""),module=String(req.query.module||"").trim(),search=String(req.query.search||"").trim();
  if((startDate&&!validIsoDate(startDate))||(endDate&&!validIsoDate(endDate))||(startDate&&endDate&&startDate>endDate))return res.status(400).json({error:"invalid date range"});
  const params=startDate||endDate?[businessTimezone]:[],filters=[];
  if(startDate){params.push(startDate);filters.push(`created_at >= ($${params.length}::date at time zone $1)`) }
  if(endDate){params.push(endDate);filters.push(`created_at < (($${params.length}::date + 1) at time zone $1)`) }
  if(module){params.push(module);filters.push(`module=$${params.length}`)}
  if(search){params.push(`%${search}%`);filters.push(`(username ilike $${params.length} or entity_id ilike $${params.length} or request_path ilike $${params.length} or details::text ilike $${params.length})`)}
  const result=await pool.query(`select id,created_at,username,user_role,module,action,entity_type,entity_id,http_method,request_path,status_code,success,details,ip_address from audit_logs ${filters.length?`where ${filters.join(" and ")}`:""} order by created_at desc,id desc limit 1000`,params);
  res.json(result.rows);
}));

app.get("/api/settings", asyncRoute(async (_req,res)=>res.json(await getSystemSettings())));
app.patch("/api/settings", requirePermission("settings.manage"), asyncRoute(async (req,res)=>{
  const current=await getSystemSettings(),body=req.body||{},text=(key,max)=>String(body[key]??current[key]).trim().slice(0,max);
  const companyName=text("company_name",200),taxNumber=text("tax_number",100),registrationNumber=text("registration_number",100),companyAddress=text("company_address",500),companyPhone=text("company_phone",100),companyEmail=text("company_email",200),companyWebsite=text("company_website",300),defaultWarehouse=text("default_warehouse",120),salesOrderPrefix=text("sales_order_prefix",12),purchaseOrderPrefix=text("purchase_order_prefix",12);
  const eurHufRate=Number(body.eur_huf_rate??current.eur_huf_rate),usdHufRate=Number(body.usd_huf_rate??current.usd_huf_rate),defaultCurrency=String(body.default_currency??current.default_currency).toUpperCase(),allowOverselling=body.allow_overselling??current.allow_overselling,lowStockThreshold=Number(body.low_stock_threshold??current.low_stock_threshold);
  if(!companyName||!defaultWarehouse||!currencies.has(defaultCurrency)||typeof allowOverselling!=="boolean"||!Number.isFinite(eurHufRate)||eurHufRate<=0||!Number.isFinite(usdHufRate)||usdHufRate<=0||!Number.isSafeInteger(lowStockThreshold)||lowStockThreshold<0||lowStockThreshold>1000000||!/^[A-Za-z0-9-]{1,12}$/.test(salesOrderPrefix)||!/^[A-Za-z0-9-]{1,12}$/.test(purchaseOrderPrefix))return res.status(400).json({error:"invalid system settings"});
  const result=await pool.query("update system_settings set company_name=$1,tax_number=$2,registration_number=$3,company_address=$4,company_phone=$5,company_email=$6,company_website=$7,eur_huf_rate=$8,usd_huf_rate=$9,default_currency=$10,allow_overselling=$11,low_stock_threshold=$12,default_warehouse=$13,sales_order_prefix=$14,purchase_order_prefix=$15,updated_at=now() where id=true returning *",[companyName,taxNumber,registrationNumber,companyAddress,companyPhone,companyEmail,companyWebsite,eurHufRate,usdHufRate,defaultCurrency,allowOverselling,lowStockThreshold,defaultWarehouse,salesOrderPrefix,purchaseOrderPrefix]);
  res.json(result.rows[0]);
}));

app.get("/api/users", requireRole("admin"), asyncRoute(async (_req,res)=>{
  const result=await pool.query("select id,username,display_name,role,enabled,last_login_at,created_at from app_users order by id");
  res.json(result.rows);
}));
app.post("/api/users", requireRole("admin"), asyncRoute(async (req,res)=>{
  const b=req.body;
  if(!b.username||String(b.password||"").length<8||!roles.has(b.role))return res.status(400).json({error:"用户名、至少 8 位密码和有效角色为必填项"});
  const result=await pool.query("insert into app_users(username,password_hash,display_name,role) values($1,$2,$3,$4) returning id,username,display_name,role,enabled,last_login_at,created_at",[String(b.username).trim(),await hashPassword(String(b.password)),String(b.displayName||""),b.role]);
  res.status(201).json(result.rows[0]);
}));
app.patch("/api/users/:id", requireRole("admin"), asyncRoute(async (req,res)=>{
  const b=req.body;
  if(b.role!==undefined&&!roles.has(b.role))return res.status(400).json({error:"无效角色"});
  if(String(req.user.id)===String(req.params.id)&&b.enabled===false)return res.status(400).json({error:"不能停用当前登录账号"});
  if(String(req.user.id)===String(req.params.id)&&b.role!==undefined&&b.role!=="admin")return res.status(400).json({error:"不能降低当前管理员账号的权限"});
  if(b.password!==undefined&&String(b.password).length<8)return res.status(400).json({error:"密码至少需要 8 位"});
  const passwordHash=b.password===undefined?null:await hashPassword(String(b.password));
  const result=await pool.query("update app_users set display_name=coalesce($1,display_name),role=coalesce($2,role),enabled=coalesce($3,enabled),password_hash=coalesce($4,password_hash),updated_at=now() where id=$5 returning id,username,display_name,role,enabled,last_login_at,created_at",[b.displayName,b.role,b.enabled,passwordHash,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"用户不存在"});
  res.json(result.rows[0]);
}));
app.delete("/api/users/:id", requireRole("admin"), asyncRoute(async (req,res)=>{
  if(String(req.user.id)===String(req.params.id))return res.status(400).json({error:"不能删除当前登录账号"});
  const result=await pool.query("delete from app_users where id=$1 returning id,username",[req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"用户不存在"});
  res.json(result.rows[0]);
}));
app.get("/api/role-permissions",requireRole("admin"),asyncRoute(async(_req,res)=>{
  const rows=(await pool.query("select role,permission_key from role_permissions where allowed=true order by role,permission_key")).rows;
  const permissions=Object.fromEntries(configurableRoles.map(role=>[role,rows.filter(row=>row.role===role).map(row=>row.permission_key)]));
  res.json({roles:configurableRoles,permissionKeys,permissions});
}));
app.put("/api/role-permissions/:role",requireRole("admin"),asyncRoute(async(req,res)=>{
  const role=String(req.params.role||"");
  if(!configurableRoles.includes(role))return res.status(400).json({error:"不能修改该角色的权限"});
  const requested=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
  if(requested.some(permission=>!permissionKeySet.has(permission)))return res.status(400).json({error:"包含无效权限"});
  const client=await pool.connect();
  try{
    await client.query("begin");
    await client.query("delete from role_permissions where role=$1",[role]);
    for(const permission of requested)await client.query("insert into role_permissions(role,permission_key,allowed) values($1,$2,true)",[role,permission]);
    await client.query("commit");
    res.json({role,permissions:requested});
  }catch(error){await client.query("rollback");throw error}finally{client.release()}
}));

app.get("/api/dashboard", requirePermission("page.dashboard"), asyncRoute(async (_req, res) => {
  const [products, customers, sales, returns, purchases, trend] = await Promise.all([
    pool.query("select count(*)::int count, coalesce(sum(stock),0)::int stock from products where deleted_at is null"),
    pool.query("select count(*)::int count from customers where deleted_at is null"),
    pool.query("select count(*)::int count,coalesce(sum(total) filter(where currency='HUF'),0)::numeric total_huf,coalesce(sum(total) filter(where currency='EUR'),0)::numeric total_eur,coalesce(sum(total) filter(where currency='USD'),0)::numeric total_usd from sales where deleted_at is null and created_at::date=current_date"),
    pool.query("select coalesce(sum(sr.total) filter(where s.currency='HUF'),0)::numeric total_huf,coalesce(sum(sr.total) filter(where s.currency='EUR'),0)::numeric total_eur,coalesce(sum(sr.total) filter(where s.currency='USD'),0)::numeric total_usd from sale_returns sr join sales s on s.id=sr.sale_id where s.deleted_at is null and sr.created_at::date=current_date"),
    pool.query("select count(*)::int count, coalesce(sum(total),0)::numeric total from purchases where deleted_at is null and status='已入库' and created_at::date=current_date"),
    pool.query(`select to_char(days.day,'YYYY-MM-DD') date,count(s.id)::int count
      from generate_series((now() at time zone $1)::date-6,(now() at time zone $1)::date,interval '1 day') days(day)
      left join sales s on s.deleted_at is null and (s.created_at at time zone $1)::date=days.day
      group by days.day order by days.day`,[businessTimezone])
  ]);
  const saleTotals={...sales.rows[0]};
  for(const currency of ["huf","eur","usd"])saleTotals[`total_${currency}`]=Number(saleTotals[`total_${currency}`])-Number(returns.rows[0][`total_${currency}`]);
  res.json({ products: products.rows[0], customers: customers.rows[0], sales: saleTotals, purchases: purchases.rows[0], trend: trend.rows });
}));

app.get("/api/categories", requireAnyPermission("page.products","page.categories","page.reports","page.dashboard"), asyncRoute(async (_req,res)=>{
  const result=await pool.query("select c.*,coalesce((select count(*) from products p where p.deleted_at is null and lower(btrim(p.category))=lower(c.name)),0)::int product_count from product_categories c where c.deleted_at is null order by coalesce(c.parent_id,c.id),c.parent_id nulls first,lower(c.name)");
  res.json(result.rows);
}));
app.post("/api/categories", requirePermission("categories.manage"), asyncRoute(async (req,res)=>{
  const name=String(req.body?.name||"").trim(),name2=String(req.body?.name2||"").trim(),parentId=req.body?.parentId===null||req.body?.parentId===""||req.body?.parentId===undefined?null:Number(req.body.parentId);
  if(!name||(parentId!==null&&!Number.isSafeInteger(parentId)))return res.status(400).json({error:"invalid category data"});
  if(parentId!==null){const parent=await pool.query("select id from product_categories where id=$1 and parent_id is null and deleted_at is null",[parentId]);if(!parent.rowCount)return res.status(400).json({error:"parent category must be a main category"})}
  const result=await pool.query("insert into product_categories(parent_id,name,name2) values($1,$2,$3) returning *,0::int product_count",[parentId,name,name2]);
  res.status(201).json(result.rows[0]);
}));
app.post("/api/categories/import", requirePermission("categories.manage"), asyncRoute(async (req,res)=>{
  const source=Array.isArray(req.body?.categories)?req.body.categories:[];
  if(!source.length||source.length>1000)return res.status(400).json({error:"category import must contain between 1 and 1000 rows"});
  const rows=source.map((item,index)=>({row:index+2,mainName:String(item?.mainName||"").trim(),mainName2:String(item?.mainName2||"").trim(),childName:String(item?.childName||"").trim(),childName2:String(item?.childName2||"").trim()})),errors=[],mainDefinitions=new Map(),importedNames=new Map();
  for(const row of rows){
    if(!row.mainName){errors.push(`row ${row.row}: main category name is required`);continue}
    const mainKey=row.mainName.toLocaleLowerCase(),knownMain=mainDefinitions.get(mainKey);
    if(knownMain&&knownMain.name2!==row.mainName2)errors.push(`row ${row.row}: main category ${row.mainName} has inconsistent secondary names`);else if(!knownMain)mainDefinitions.set(mainKey,{name:row.mainName,name2:row.mainName2,row:row.row});
    const knownName=importedNames.get(mainKey);if(knownName?.type==="child")errors.push(`rows ${knownName.row} and ${row.row}: duplicate category name ${row.mainName}`);else if(!knownName)importedNames.set(mainKey,{type:"main",row:row.row,name:row.mainName});
    if(row.childName){const childKey=row.childName.toLocaleLowerCase(),known=importedNames.get(childKey);if(known)errors.push(`rows ${known.row} and ${row.row}: duplicate category name ${row.childName}`);else importedNames.set(childKey,{type:"child",row:row.row,name:row.childName})}
  }
  if(errors.length)return res.status(400).json({error:errors.slice(0,20).join("; ")});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const existing=(await client.query("select id,parent_id,name from product_categories where deleted_at is null for update")).rows,existingByName=new Map(existing.map(category=>[category.name.toLocaleLowerCase(),category]));
    for(const definition of mainDefinitions.values()){const category=existingByName.get(definition.name.toLocaleLowerCase());if(category?.parent_id!==null&&category?.parent_id!==undefined)errors.push(`row ${definition.row}: ${definition.name} already exists as a subcategory`)}
    for(const row of rows){if(!row.childName)continue;const category=existingByName.get(row.childName.toLocaleLowerCase());if(category)errors.push(`row ${row.row}: category already exists (${row.childName})`)}
    if(errors.length){await client.query("rollback");return res.status(400).json({error:errors.slice(0,20).join("; ")})}
    const mainIds=new Map(),created=[];
    for(const [key,definition] of mainDefinitions){
      const current=existingByName.get(key);
      if(current){mainIds.set(key,current.id);continue}
      const result=await client.query("insert into product_categories(parent_id,name,name2) values(null,$1,$2) returning *",[definition.name,definition.name2]);
      mainIds.set(key,result.rows[0].id);created.push(result.rows[0]);
    }
    for(const row of rows){if(!row.childName)continue;const result=await client.query("insert into product_categories(parent_id,name,name2) values($1,$2,$3) returning *",[mainIds.get(row.mainName.toLocaleLowerCase()),row.childName,row.childName2]);created.push(result.rows[0])}
    if(!created.length){await client.query("rollback");return res.status(400).json({error:"category import contains no new categories"})}
    await client.query("commit");
    res.status(201).json({count:created.length,mainCount:created.filter(category=>category.parent_id===null).length,childCount:created.filter(category=>category.parent_id!==null).length});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));
app.patch("/api/categories/:id", requirePermission("categories.manage"), asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const current=await client.query("select * from product_categories where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!current.rowCount){await client.query("rollback");return res.status(404).json({error:"category not found"})}
    const row=current.rows[0],name=req.body?.name===undefined?row.name:String(req.body.name).trim(),name2=req.body?.name2===undefined?row.name2:String(req.body.name2).trim(),parentId=req.body?.parentId===undefined?row.parent_id:req.body.parentId===null||req.body.parentId===""?null:Number(req.body.parentId);
    if(!name||(parentId!==null&&(!Number.isSafeInteger(parentId)||String(parentId)===String(req.params.id)))){await client.query("rollback");return res.status(400).json({error:"invalid category data"})}
    if(parentId!==null){const parent=await client.query("select id from product_categories where id=$1 and parent_id is null and deleted_at is null",[parentId]);const children=await client.query("select 1 from product_categories where parent_id=$1 and deleted_at is null limit 1",[req.params.id]);if(!parent.rowCount||children.rowCount){await client.query("rollback");return res.status(400).json({error:"category hierarchy is limited to two levels"})}}
    const result=await client.query("update product_categories set parent_id=$1,name=$2,name2=$3,updated_at=now() where id=$4 returning *",[parentId,name,name2,req.params.id]);
    if(name!==row.name)await client.query("update products set category=$1,updated_at=now() where lower(btrim(category))=lower($2)",[name,row.name]);
    await client.query("commit");
    const count=await pool.query("select count(*)::int product_count from products where deleted_at is null and lower(btrim(category))=lower($1)",[name]);
    res.json({...result.rows[0],product_count:count.rows[0].product_count});
  }catch(error){await client.query("rollback");throw error}finally{client.release()}
}));
app.put("/api/categories/:id/image", requirePermission("categories.manage"), express.raw({ type: ["image/jpeg","image/png","image/webp"], limit: "5mb" }), asyncRoute(async (req,res)=>{
  const mimeType=String(req.headers["content-type"]||"").split(";")[0].toLowerCase(),extensions={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  if(!extensions[mimeType]||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:"invalid category image"});
  const category=await pool.query("select id,image_url from product_categories where id=$1 and deleted_at is null",[req.params.id]);
  if(!category.rowCount)return res.status(404).json({error:"category not found"});
  const fileName=`category-${req.params.id}-${crypto.randomUUID()}.${extensions[mimeType]}`,filePath=path.join(uploadDirectory,fileName);
  await writeFile(filePath,req.body,{flag:"wx"});
  let updated;
  try{updated=await pool.query("update product_categories set image_url=$1,updated_at=now() where id=$2 returning *",[`/uploads/${fileName}`,req.params.id])}
  catch(error){await unlink(filePath).catch(()=>{});throw error}
  const previous=category.rows[0].image_url;
  if(previous?.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(previous))).catch(()=>{});
  const count=await pool.query("select count(*)::int product_count from products where deleted_at is null and lower(btrim(category))=lower($1)",[updated.rows[0].name]);
  res.json({...updated.rows[0],product_count:count.rows[0].product_count});
}));
app.delete("/api/categories/:id/image", requirePermission("categories.manage"), asyncRoute(async (req,res)=>{
  const category=await pool.query("select * from product_categories where id=$1 and deleted_at is null",[req.params.id]);
  if(!category.rowCount)return res.status(404).json({error:"category not found"});
  const updated=await pool.query("update product_categories set image_url='',updated_at=now() where id=$1 returning *",[req.params.id]);
  const previous=category.rows[0].image_url;
  if(previous?.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(previous))).catch(()=>{});
  const count=await pool.query("select count(*)::int product_count from products where deleted_at is null and lower(btrim(category))=lower($1)",[updated.rows[0].name]);
  res.json({...updated.rows[0],product_count:count.rows[0].product_count});
}));

app.delete("/api/categories/:id", requirePermission("categories.delete"), asyncRoute(async (req,res)=>{
  const client=await pool.connect();let imageUrls=[];
  try{
    await client.query("begin");
    const category=await client.query("select id,parent_id,name from product_categories where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!category.rowCount){const error=new Error("category not found");error.status=404;throw error}
    const descendants=await client.query("select id,name,image_url from product_categories where (id=$1 or parent_id=$1) and deleted_at is null for update",[req.params.id]);
    const names=descendants.rows.map(row=>row.name),ids=descendants.rows.map(row=>row.id);imageUrls=descendants.rows.map(row=>row.image_url).filter(Boolean);
    if(names.length)await client.query("update products set category='',updated_at=now() where deleted_at is null and lower(btrim(category))=any($1::text[])",[names.map(name=>name.toLocaleLowerCase())]);
    await client.query("update product_categories set deleted_at=now(),deleted_by=$1,updated_at=now() where id=any($2::bigint[])",[req.user.username,ids]);
    await client.query("commit");
    for(const imageUrl of imageUrls)if(imageUrl.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(imageUrl))).catch(()=>{});
    res.json({id:Number(req.params.id),deletedCount:ids.length});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));

app.get("/api/products", requireAnyPermission("page.dashboard","page.products","page.inventory","page.purchases","page.scanSales","page.collectorSales","page.reports"), asyncRoute(async (req, res) => {
  const q = `%${req.query.search || ""}%`;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  if(categoryId!==null&&!Number.isSafeInteger(categoryId))return res.status(400).json({error:"invalid category"});
  const result = await pool.query("select p.*,(select coalesce(sum(si.quantity),0)::int from sale_items si join sales s on s.id=si.sale_id where si.product_id=p.id and s.deleted_at is null) sales_quantity,p.imported_purchase_quantity+(select coalesce(sum(pi.quantity),0)::int from purchase_items pi join purchases po on po.id=pi.purchase_id where pi.product_id=p.id and po.deleted_at is null and po.status='已入库') purchase_quantity,(select max(po.received_at) from purchase_items pi join purchases po on po.id=pi.purchase_id where pi.product_id=p.id and po.deleted_at is null and po.status='已入库') inbound_at from products p where p.deleted_at is null and (p.sku ilike $1 or p.barcode ilike $1 or p.name ilike $1 or p.name2 ilike $1) and ($2::bigint is null or lower(btrim(p.category)) in (select lower(name) from product_categories where deleted_at is null and (id=$2 or parent_id=$2))) order by p.id desc", [q,categoryId]);
  res.json(result.rows);
}));
app.get("/api/products/categories", requireAnyPermission("page.products","page.inventory","page.purchases","page.scanSales","page.collectorSales","page.reports"), asyncRoute(async (_req,res)=>{
  const result=await pool.query("select name from product_categories where deleted_at is null order by lower(name)");
  res.json(result.rows.map(row=>row.name));
}));
app.post("/api/products/import", requireRole("admin"), asyncRoute(async (req,res)=>{
  const source=Array.isArray(req.body?.products)?req.body.products:[];
  if(!source.length||source.length>1000)return res.status(400).json({error:"product import must contain between 1 and 1000 rows"});
  const importNumber=(value,fallback)=>String(value??"").trim()===""?fallback:Number(value);
  const products=source.map((item,index)=>({
    row:index+2,sku:String(item?.sku||"").trim(),barcode:String(item?.barcode||"").trim(),name:String(item?.name||"").trim(),name2:String(item?.name2||"").trim(),category:String(item?.category||"").trim(),supplier:String(item?.supplier||"").trim(),unit:String(item?.unit||"个").trim()||"个",
    boxSize:importNumber(item?.boxSize,1),packageSize:importNumber(item?.packageSize,1),cost:importNumber(item?.cost,0),priceHuf:importNumber(item?.priceHuf,0),priceEur:importNumber(item?.priceEur,0),priceUsd:importNumber(item?.priceUsd,0),stock:importNumber(item?.stock,0),purchaseQuantity:importNumber(item?.purchaseQuantity,0),
  }));
  const errors=[];
  for(const product of products){
    if(!Number.isSafeInteger(product.stock))errors.push(`row ${product.row}: stock must be an integer`);
  }
  const duplicateRows=(field,label)=>{
    const seen=new Map();
    for(const product of products){const value=product[field];if(!value)continue;const key=value.toLocaleLowerCase();if(seen.has(key))errors.push(`rows ${seen.get(key)} and ${product.row}: duplicate ${label} ${value}`);else seen.set(key,product.row)}
  };
  duplicateRows("sku","SKU");duplicateRows("barcode","barcode");
  if(errors.length)return res.status(400).json({error:errors.slice(0,20).join("; ")});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const skus=products.map(product=>product.sku.toLocaleLowerCase()).filter(Boolean),barcodes=products.map(product=>product.barcode.toLocaleLowerCase()).filter(Boolean);
    const existing=(await client.query("select * from products where deleted_at is null and (lower(sku)=any($1::text[]) or (barcode<>'' and lower(barcode)=any($2::text[]))) for update",[skus,barcodes])).rows;
    const existingBySku=new Map(existing.map(row=>[String(row.sku).toLocaleLowerCase(),row])),existingByBarcode=new Map(existing.filter(row=>row.barcode).map(row=>[String(row.barcode).toLocaleLowerCase(),row]));
    for(const product of products){
      const skuMatch=product.sku?existingBySku.get(product.sku.toLocaleLowerCase()):null,barcodeMatch=product.barcode?existingByBarcode.get(product.barcode.toLocaleLowerCase()):null;
      if(skuMatch&&barcodeMatch&&Number(skuMatch.id)!==Number(barcodeMatch.id))errors.push(`row ${product.row}: SKU and barcode belong to different existing products`);
      product.existing=skuMatch||barcodeMatch||null;
      if(product.existing)continue;
      if(!product.sku)errors.push(`row ${product.row}: SKU is required`);
      if(!product.name)errors.push(`row ${product.row}: product name is required`);
      if(!Number.isSafeInteger(product.boxSize)||product.boxSize<=0)errors.push(`row ${product.row}: box size must be a positive integer`);
      if(!Number.isSafeInteger(product.packageSize)||product.packageSize<=0)errors.push(`row ${product.row}: package size must be a positive integer`);
      if([product.cost,product.priceHuf,product.priceEur,product.priceUsd].some(value=>!Number.isFinite(value)||value<0))errors.push(`row ${product.row}: prices and cost must be non-negative numbers`);
      if(!Number.isSafeInteger(product.purchaseQuantity)||product.purchaseQuantity<0)errors.push(`row ${product.row}: inbound statistics must be a non-negative integer`);
    }
    const categories=(await client.query("select id,parent_id,name from product_categories where deleted_at is null")).rows,categoryByName=new Map(categories.map(row=>[row.name.toLocaleLowerCase(),row]));
    for(const product of products){
      if(product.existing||!product.category)continue;
      const parts=product.category.split(">").map(value=>value.trim());
      let category=null;
      if(parts.some(part=>!part))category=null;
      else if(parts.length===1)category=categoryByName.get(parts[0].toLocaleLowerCase());
      else if(parts.length===2){
        const main=categoryByName.get(parts[0].toLocaleLowerCase()),child=categoryByName.get(parts[1].toLocaleLowerCase());
        if(main&&!main.parent_id&&child&&Number(child.parent_id)===Number(main.id))category=child;
      }
      if(!category||parts.length>2)errors.push(`row ${product.row}: category path does not exist (${product.category})`);else product.category=category.name;
    }
    if(errors.length){await client.query("rollback");return res.status(400).json({error:errors.slice(0,20).join("; ")})}
    const settings=await getSystemSettings(client),imported=[],createdSkus=[],importReference=`PRODUCT-IMPORT-${new Date().toISOString().replace(/\D/g,"").slice(0,14)}-${crypto.randomUUID().slice(0,8)}`;let createdCount=0,updatedCount=0;
    for(const product of products){
      if(product.existing){
        const delta=product.stock-Number(product.existing.stock),warehouse=product.existing.storage_warehouse||settings.default_warehouse;
        const result=await client.query("update products set stock=$1,updated_at=now() where id=$2 returning *",[product.stock,product.existing.id]);
        if(delta!==0)await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'inventory_adjustment',$4,$5)",[product.existing.id,warehouse,delta,importReference,req.user.username]);
        const statistics=await client.query(productStatisticsSql,[product.existing.id]);
        imported.push({...result.rows[0],...statistics.rows[0]});
        updatedCount+=1;
        continue;
      }
      const result=await client.query("insert into products(sku,barcode,name,name2,category,supplier,unit,box_size,package_size,cost,price,price_eur,price_usd,stock,imported_purchase_quantity,storage_warehouse) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *",[product.sku,product.barcode,product.name,product.name2,product.category,product.supplier,product.unit,product.boxSize,product.packageSize,product.cost,product.priceHuf,product.priceEur,product.priceUsd,product.stock,product.purchaseQuantity,settings.default_warehouse]);
      if(product.stock!==0)await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'product_import',$4,$5)",[result.rows[0].id,settings.default_warehouse,product.stock,importReference,req.user.username]);
      imported.push({...result.rows[0],sales_quantity:0,purchase_quantity:product.purchaseQuantity});
      createdSkus.push(product.sku.toLocaleLowerCase());
      createdCount+=1;
    }
    await client.query("commit");
    res.status(201).json({count:imported.length,createdCount,updatedCount,createdSkus,stockTotal:products.reduce((total,product)=>total+product.stock,0),products:imported});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));
app.get("/api/products/:id", requireAnyPermission("page.products","page.inventory","page.purchases","page.scanSales","page.collectorSales","page.reports"), asyncRoute(async (req,res)=>{
  const product=await pool.query("select p.*,(select coalesce(sum(si.quantity),0)::int from sale_items si join sales s on s.id=si.sale_id where si.product_id=p.id and s.deleted_at is null) sales_quantity,p.imported_purchase_quantity+(select coalesce(sum(pi.quantity),0)::int from purchase_items pi join purchases po on po.id=pi.purchase_id where pi.product_id=p.id and po.deleted_at is null and po.status='已入库') purchase_quantity,(select max(po.received_at) from purchase_items pi join purchases po on po.id=pi.purchase_id where pi.product_id=p.id and po.deleted_at is null and po.status='已入库') inbound_at from products p where p.id=$1 and p.deleted_at is null",[req.params.id]);
  if(!product.rowCount)return res.status(404).json({error:"product not found"});
  const movements=await pool.query("select id,warehouse,quantity,movement_type,reference_no,created_by,created_at from inventory_movements where product_id=$1 order by created_at desc,id desc limit 20",[req.params.id]);
  res.json({...product.rows[0],movements:movements.rows});
}));
app.get("/api/products/:id/sales", requirePermission("page.products"), asyncRoute(async(req,res)=>{
  if(!(await pool.query("select 1 from products where id=$1 and deleted_at is null",[req.params.id])).rowCount)return res.status(404).json({error:"product not found"});
  const result=await pool.query(`select s.id,s.order_no,s.created_at,s.created_by,s.currency,s.status,s.stock_deducted,s.delivered,coalesce(c.name,'') customer,si.quantity,si.price,(si.quantity*si.price)::numeric line_total
    from sale_items si join sales s on s.id=si.sale_id left join customers c on c.id=s.customer_id
    where si.product_id=$1 and s.deleted_at is null order by s.created_at desc,s.id desc`,[req.params.id]);
  res.json(result.rows);
}));
app.get("/api/products/:id/purchases", requireAnyPermission("page.products","page.inventory"), asyncRoute(async(req,res)=>{
  if(!(await pool.query("select 1 from products where id=$1 and deleted_at is null",[req.params.id])).rowCount)return res.status(404).json({error:"product not found"});
  const result=await pool.query(`select p.id,p.order_no,p.created_at,p.received_at,p.supplier,p.warehouse,p.status,pi.quantity,pi.cost,(pi.quantity*pi.cost)::numeric line_total
    from purchase_items pi join purchases p on p.id=pi.purchase_id
    where pi.product_id=$1 and p.deleted_at is null
    order by coalesce(p.received_at,p.created_at) desc,p.id desc`,[req.params.id]);
  res.json(result.rows);
}));
app.post("/api/products", requirePermission("products.manage"), asyncRoute(async (req, res) => {
  const b=req.body||{},sku=String(b.sku||"").trim(),name=String(b.name||"").trim(),name2=String(b.name2||"").trim(),boxSize=Number(b.boxSize??1),packageSize=Number(b.packageSize??1),cost=Number(b.cost??0),priceHuf=Number(b.priceHuf??b.price??0),priceEur=Number(b.priceEur??0),priceUsd=Number(b.priceUsd??0);
  if(!sku||!name||!Number.isSafeInteger(boxSize)||boxSize<=0||!Number.isSafeInteger(packageSize)||packageSize<=0||[cost,priceHuf,priceEur,priceUsd].some(value=>!Number.isFinite(value)||value<0))return res.status(400).json({error:"invalid product data"});
  const category=String(b.category||"").trim();
  if(category&&!(await pool.query("select 1 from product_categories where name=$1 and deleted_at is null",[category])).rowCount)return res.status(400).json({error:"category does not exist"});
  const settings=await getSystemSettings();
  const result = await pool.query("insert into products(sku,barcode,name,name2,category,supplier,unit,box_size,package_size,cost,price,price_eur,price_usd,stock,storage_warehouse) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14) returning *", [sku,String(b.barcode||"").trim(),name,name2,String(b.category||"").trim(),String(b.supplier||"").trim(),String(b.unit||"个").trim()||"个",boxSize,packageSize,cost,priceHuf,priceEur,priceUsd,settings.default_warehouse]);
  res.status(201).json(result.rows[0]);
}));
app.patch("/api/products/:id", requirePermission("products.manage"), asyncRoute(async (req, res) => {
  const b=req.body||{};
  const sku=b.sku===undefined?null:String(b.sku).trim(),name=b.name===undefined?null:String(b.name).trim(),name2=b.name2===undefined?null:String(b.name2).trim(),unit=b.unit===undefined?null:String(b.unit).trim(),boxSize=b.boxSize===undefined?null:Number(b.boxSize),packageSize=b.packageSize===undefined?null:Number(b.packageSize),cost=b.cost===undefined?null:Number(b.cost),priceHuf=b.priceHuf===undefined&&b.price===undefined?null:Number(b.priceHuf??b.price),priceEur=b.priceEur===undefined?null:Number(b.priceEur),priceUsd=b.priceUsd===undefined?null:Number(b.priceUsd),warehouse=b.warehouse===undefined?null:String(b.warehouse).trim(),storageLocation=b.storageLocation===undefined?null:String(b.storageLocation).trim();
  if(sku===""||name===""||unit===""||(boxSize!==null&&(!Number.isSafeInteger(boxSize)||boxSize<=0))||(packageSize!==null&&(!Number.isSafeInteger(packageSize)||packageSize<=0))||[cost,priceHuf,priceEur,priceUsd].some(value=>value!==null&&(!Number.isFinite(value)||value<0)))return res.status(400).json({error:"invalid product data"});
  if(warehouse!==null&&warehouse.length>200)return res.status(400).json({error:"warehouse is too long"});
  if(storageLocation!==null&&storageLocation.length>200)return res.status(400).json({error:"storage location is too long"});
  const category=b.category===undefined?null:String(b.category).trim();
  if(category&&!(await pool.query("select 1 from product_categories where name=$1 and deleted_at is null",[category])).rowCount)return res.status(400).json({error:"category does not exist"});
  const result=await pool.query("update products set sku=coalesce($1,sku),barcode=coalesce($2,barcode),name=coalesce($3,name),name2=coalesce($4,name2),category=coalesce($5,category),supplier=coalesce($6,supplier),unit=coalesce($7,unit),box_size=coalesce($8,box_size),package_size=coalesce($9,package_size),cost=coalesce($10,cost),price=coalesce($11,price),price_eur=coalesce($12,price_eur),price_usd=coalesce($13,price_usd),storage_warehouse=coalesce($14,storage_warehouse),storage_location=coalesce($15,storage_location),updated_at=now() where id=$16 and deleted_at is null returning *",[sku,b.barcode===undefined?null:String(b.barcode).trim(),name,name2,b.category===undefined?null:String(b.category).trim(),b.supplier===undefined?null:String(b.supplier).trim(),unit,boxSize,packageSize,cost,priceHuf,priceEur,priceUsd,warehouse,storageLocation,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"product not found"});
  const statistics=await pool.query(productStatisticsSql,[req.params.id]);
  res.json({...result.rows[0],...statistics.rows[0]});
}));
app.patch("/api/products/:id/inventory", requirePermission("inventory.edit"), asyncRoute(async (req,res)=>{
  const body=req.body||{},stock=Number(body.stock),boxSize=Number(body.boxSize),unit=String(body.unit??"").trim(),warehouse=String(body.warehouse??"").trim(),storageLocation=String(body.storageLocation??"").trim();
  if(!Number.isSafeInteger(stock))return res.status(400).json({error:"stock must be an integer"});
  if(!Number.isSafeInteger(boxSize)||boxSize<=0)return res.status(400).json({error:"box size must be a positive integer"});
  if(!unit||unit.length>100)return res.status(400).json({error:"invalid product unit"});
  if(warehouse.length>200)return res.status(400).json({error:"warehouse is too long"});
  if(storageLocation.length>200)return res.status(400).json({error:"storage location is too long"});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const current=await client.query("select stock from products where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!current.rowCount){await client.query("rollback");return res.status(404).json({error:"product not found"})}
    const delta=stock-Number(current.rows[0].stock);
    const result=await client.query("update products set stock=$1,box_size=$2,unit=$3,storage_warehouse=$4,storage_location=$5,updated_at=now() where id=$6 returning *",[stock,boxSize,unit,warehouse,storageLocation,req.params.id]);
    if(delta!==0)await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'inventory_adjustment',$4,$5)",[req.params.id,warehouse||"主仓库",delta,`INV-ADJ-${crypto.randomUUID().slice(0,8)}`,req.user.username]);
    const statistics=await client.query(productStatisticsSql,[req.params.id]);
    await client.query("commit");
    res.json({...result.rows[0],...statistics.rows[0]});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));
app.patch("/api/products/:id/inventory-location", requirePermission("inventory.locations"), asyncRoute(async (req,res)=>{
  const storageLocation=String(req.body?.storageLocation??"").trim();
  if(storageLocation.length>200)return res.status(400).json({error:"storage location is too long"});
  const result=await pool.query("update products set storage_location=$1,updated_at=now() where id=$2 and deleted_at is null returning *",[storageLocation,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"product not found"});
  const statistics=await pool.query(productStatisticsSql,[req.params.id]);
  res.json({...result.rows[0],...statistics.rows[0]});
}));
app.put("/api/products/:id/image", requirePermission("products.images"), express.raw({ type: ["image/jpeg","image/png","image/webp"], limit: "5mb" }), asyncRoute(async (req,res)=>{
  const mimeType=String(req.headers["content-type"]||"").split(";")[0].toLowerCase();
  const extensions={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  if(!extensions[mimeType]||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:"only non-empty JPG, PNG and WebP images are supported"});
  const product=await pool.query("select id,image_url from products where id=$1 and deleted_at is null",[req.params.id]);
  if(!product.rowCount)return res.status(404).json({error:"product not found"});
  const fileName=`product-${req.params.id}-${crypto.randomUUID()}.${extensions[mimeType]}`;
  const filePath=path.join(uploadDirectory,fileName);
  await writeFile(filePath,req.body,{flag:"wx"});
  let updated;
  try{updated=await pool.query("update products set image_url=$1,updated_at=now() where id=$2 returning *",[`/uploads/${fileName}`,req.params.id])}
  catch(error){await unlink(filePath).catch(()=>{});throw error}
  const previous=product.rows[0].image_url;
  if(previous?.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(previous))).catch(()=>{});
  const statistics=await pool.query(productStatisticsSql,[req.params.id]);
  res.json({...updated.rows[0],...statistics.rows[0]});
}));
app.delete("/api/products/:id/image", requirePermission("products.images"), asyncRoute(async (req,res)=>{
  const product=await pool.query("select * from products where id=$1 and deleted_at is null",[req.params.id]);
  if(!product.rowCount)return res.status(404).json({error:"product not found"});
  const updated=await pool.query("update products set image_url='',updated_at=now() where id=$1 returning *",[req.params.id]);
  const previous=product.rows[0].image_url;
  if(previous?.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(previous))).catch(()=>{});
  const statistics=await pool.query(productStatisticsSql,[req.params.id]);
  res.json({...updated.rows[0],...statistics.rows[0]});
}));
app.delete("/api/products/batch-delete", requirePermission("products.delete"), asyncRoute(async (req,res)=>{
  const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(Number))];
  if(!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0))return res.status(400).json({error:"select between 1 and 500 valid products"});
  const client=await pool.connect();let imageUrls=[];
  try{
    await client.query("begin");
    const products=await client.query("select id,image_url from products where id=any($1::bigint[]) and deleted_at is null order by id for update",[ids]);
    if(products.rowCount!==ids.length){const error=new Error("one or more selected products do not exist or were already deleted");error.status=409;throw error}
    imageUrls=products.rows.map(product=>product.image_url).filter(Boolean);
    await client.query("update products set deleted_at=now(),deleted_by=$1,updated_at=now() where id=any($2::bigint[]) and deleted_at is null",[req.user.username,ids]);
    await client.query("commit");
    for(const imageUrl of imageUrls)if(imageUrl.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(imageUrl))).catch(()=>{});
    res.json({ids,count:ids.length});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));
app.delete("/api/products/:id", requirePermission("products.delete"), asyncRoute(async (req,res)=>{
  const product=await pool.query("update products set deleted_at=now(),deleted_by=$1,updated_at=now() where id=$2 and deleted_at is null returning id,image_url",[req.user.username,req.params.id]);
  if(!product.rowCount)return res.status(404).json({error:"product not found"});
  const imageUrl=product.rows[0].image_url;if(imageUrl?.startsWith("/uploads/"))await unlink(path.join(uploadDirectory,path.basename(imageUrl))).catch(()=>{});
  res.json({id:Number(product.rows[0].id)});
}));
app.get("/api/i18n/locales", asyncRoute(async (_req,res)=>{
  res.json((await pool.query("select locale,display_name,is_default from supported_locales where enabled=true order by is_default desc,locale")).rows);
}));
app.put("/api/products/:id/translations/:locale", requirePermission("products.manage"), asyncRoute(async (req,res)=>{
  const result=await pool.query("insert into product_translations(product_id,locale,name,description) values($1,$2,$3,$4) on conflict(product_id,locale) do update set name=excluded.name,description=excluded.description returning *",[req.params.id,req.params.locale,req.body.name,req.body.description||""]);
  res.json(result.rows[0]);
}));

app.get("/api/customers", requireAnyPermission("page.dashboard","page.customers","page.sales","page.scanSales","page.issueInvoice","page.reports"), asyncRoute(async (req, res) => {
  const q=`%${req.query.search||""}%`;
  const result=await pool.query(`select c.*,g.name customer_group_name,coalesce(g.discount_percent,0) group_discount_percent,coalesce((select array_agg(distinct trim(s.vehicle_plate)) from sales s where s.customer_id=c.id and s.deleted_at is null and nullif(trim(s.vehicle_plate),'') is not null),'{}'::text[]) vehicle_plates,coalesce(ss.sale_count,0)::int sale_count,ss.last_sale_at
    from customers c left join customer_groups g on g.id=c.customer_group_id and g.deleted_at is null
    left join (select customer_id,count(*)::int sale_count,max(created_at) last_sale_at from sales where deleted_at is null and customer_id is not null group by customer_id) ss on ss.customer_id=c.id
    where c.deleted_at is null and (c.name ilike $1 or c.phone ilike $1 or c.vehicle_plate ilike $1 or c.city ilike $1 or c.tax_number ilike $1 or c.notes ilike $1 or g.name ilike $1 or exists(select 1 from sales s where s.customer_id=c.id and s.deleted_at is null and s.vehicle_plate ilike $1))
    order by c.id desc`,[q]);
  res.json(result.rows);
}));
app.get("/api/customers/:id/last-sale-prices", requireAnyPermission("page.scanSales","page.sales"), asyncRoute(async (req,res)=>{
  const customerId=Number(req.params.id),currency=String(req.query.currency||"").toUpperCase(),excludeSaleId=req.query.excludeSaleId?Number(req.query.excludeSaleId):null;
  if(!Number.isSafeInteger(customerId)||customerId<=0)return res.status(400).json({error:"invalid customer"});
  if(!currencies.has(currency))return res.status(400).json({error:"unsupported sale currency"});
  if(excludeSaleId!==null&&(!Number.isSafeInteger(excludeSaleId)||excludeSaleId<=0))return res.status(400).json({error:"invalid excluded sale"});
  if(!(await pool.query("select 1 from customers where id=$1 and deleted_at is null",[customerId])).rowCount)return res.status(404).json({error:"customer not found"});
  res.json(await lastCustomerSalePrices(pool,customerId,currency,{excludeSaleId}));
}));
app.post("/api/customers", requirePermission("customers.manage"), asyncRoute(async (req,res)=>{
  const b=req.body||{},name=String(b.name||"").trim();
  if(!name)return res.status(400).json({error:"customer name is required"});
  const groupId=b.customerGroupId?Number(b.customerGroupId):null;
  if(groupId&&(!Number.isSafeInteger(groupId)||!(await pool.query("select 1 from customer_groups where id=$1 and deleted_at is null",[groupId])).rowCount))return res.status(400).json({error:"customer group does not exist"});
  const result=await pool.query("insert into customers(name,phone,vehicle_plate,city,address,customer_group,customer_group_id,country,postal_code,tax_number,email,notes) values($1,$2,$3,$4,$5,coalesce((select name from customer_groups where id=$6),''),$6,$7,$8,$9,$10,$11) returning *",[name,String(b.phone||"").trim(),String(b.vehiclePlate||"").trim().slice(0,50),String(b.city||"").trim(),String(b.address||"").trim(),groupId,String(b.country||"Magyarország").trim(),String(b.postalCode||"").trim(),String(b.taxNumber||"").trim(),String(b.email||"").trim(),String(b.notes||"").trim().slice(0,1000)]);
  res.status(201).json((await pool.query("select c.*,g.name customer_group_name,coalesce(g.discount_percent,0) group_discount_percent from customers c left join customer_groups g on g.id=c.customer_group_id where c.id=$1",[result.rows[0].id])).rows[0]);
}));
app.patch("/api/customers/:id", requirePermission("customers.manage"), asyncRoute(async (req,res)=>{
  const b=req.body||{},current=(await pool.query("select * from customers where id=$1 and deleted_at is null",[req.params.id])).rows[0];
  if(!current)return res.status(404).json({error:"customer not found"});
  const value=(camel,column,max=500)=>String(b[camel]??current[column]??"").trim().slice(0,max),name=value("name","name",200);
  if(!name)return res.status(400).json({error:"customer name is required"});
  const groupId=b.customerGroupId===undefined?current.customer_group_id:(b.customerGroupId?Number(b.customerGroupId):null);
  if(groupId&&(!Number.isSafeInteger(Number(groupId))||!(await pool.query("select 1 from customer_groups where id=$1 and deleted_at is null",[groupId])).rowCount))return res.status(400).json({error:"customer group does not exist"});
  await pool.query("update customers set name=$1,phone=$2,vehicle_plate=$3,city=$4,address=$5,customer_group=coalesce((select name from customer_groups where id=$6),''),customer_group_id=$6,country=$7,postal_code=$8,tax_number=$9,email=$10,notes=$11,updated_at=now() where id=$12 and deleted_at is null",[name,value("phone","phone",100),value("vehiclePlate","vehicle_plate",50),value("city","city",150),value("address","address"),groupId,value("country","country",100)||"Magyarország",value("postalCode","postal_code",30),value("taxNumber","tax_number",50),value("email","email",200),value("notes","notes",1000),req.params.id]);
  res.json((await pool.query("select c.*,g.name customer_group_name,coalesce(g.discount_percent,0) group_discount_percent from customers c left join customer_groups g on g.id=c.customer_group_id where c.id=$1",[req.params.id])).rows[0]);
}));
app.post("/api/customers/import", requireRole("admin"), asyncRoute(async(req,res)=>{
  const rows=Array.isArray(req.body?.customers)?req.body.customers:[];
  if(!rows.length||rows.length>5000)return res.status(400).json({error:"customer import must contain between 1 and 5000 rows"});
  const groups=(await pool.query("select id,name from customer_groups where deleted_at is null")).rows,groupByName=new Map(groups.map(group=>[group.name.toLocaleLowerCase(),group]));
  const customers=rows.map((item,index)=>({row:index+2,name:String(item?.name||"").trim(),phone:String(item?.phone||"").trim(),vehiclePlate:String(item?.vehiclePlate||"").trim().slice(0,50),postalCode:String(item?.postalCode||"").trim(),city:String(item?.city||"").trim(),address:String(item?.address||"").trim(),country:String(item?.country||"Magyarország").trim()||"Magyarország",taxNumber:String(item?.taxNumber||"").trim(),email:String(item?.email||"").trim(),group:String(item?.group||"").trim(),notes:String(item?.notes||"").trim().slice(0,1000)})),errors=[];
  for(const customer of customers){if(!customer.name)errors.push(`row ${customer.row}: customer name is required`);customer.groupId=customer.group?groupByName.get(customer.group.toLocaleLowerCase())?.id:null;if(customer.group&&!customer.groupId)errors.push(`row ${customer.row}: customer group does not exist (${customer.group})`)}
  if(errors.length)return res.status(400).json({error:errors.slice(0,20).join("; ")});
  const client=await pool.connect();
  try{await client.query("begin");for(const customer of customers)await client.query("insert into customers(name,phone,vehicle_plate,postal_code,city,address,country,tax_number,email,customer_group,customer_group_id,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[customer.name,customer.phone,customer.vehiclePlate,customer.postalCode,customer.city,customer.address,customer.country,customer.taxNumber,customer.email,customer.group,customer.groupId,customer.notes]);await client.query("commit");res.status(201).json({count:customers.length})}catch(error){await client.query("rollback");throw error}finally{client.release()}
}));
app.delete("/api/customers/:id", requirePermission("customers.delete"), asyncRoute(async (req,res)=>{
  const result=await pool.query("update customers set deleted_at=now(),deleted_by=$1,updated_at=now() where id=$2 and deleted_at is null returning id",[req.user.username,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"customer not found"});res.json({id:Number(result.rows[0].id)});
}));

app.get("/api/customer-groups",requireAnyPermission("page.customers","page.scanSales","page.reports"),asyncRoute(async(_req,res)=>{
  res.json((await pool.query("select g.*,count(c.id)::int customer_count from customer_groups g left join customers c on c.customer_group_id=g.id and c.deleted_at is null where g.deleted_at is null group by g.id order by lower(g.name)")).rows);
}));
app.post("/api/customer-groups",requirePermission("customers.manage"),asyncRoute(async(req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,200),discount=Number(req.body?.discountPercent??0),notes=String(req.body?.notes||"").trim().slice(0,1000);
  if(!name||!Number.isFinite(discount)||discount<0||discount>100)return res.status(400).json({error:"invalid customer group"});
  res.status(201).json((await pool.query("insert into customer_groups(name,discount_percent,notes) values($1,$2,$3) returning *",[name,discount,notes])).rows[0]);
}));
app.patch("/api/customer-groups/:id",requirePermission("customers.manage"),asyncRoute(async(req,res)=>{
  const current=(await pool.query("select * from customer_groups where id=$1 and deleted_at is null",[req.params.id])).rows[0];
  if(!current)return res.status(404).json({error:"customer group not found"});
  const name=String(req.body?.name??current.name).trim().slice(0,200),discount=Number(req.body?.discountPercent??current.discount_percent),notes=String(req.body?.notes??current.notes).trim().slice(0,1000);
  if(!name||!Number.isFinite(discount)||discount<0||discount>100)return res.status(400).json({error:"invalid customer group"});
  const updated=(await pool.query("update customer_groups set name=$1,discount_percent=$2,notes=$3,updated_at=now() where id=$4 returning *",[name,discount,notes,req.params.id])).rows[0];
  await pool.query("update customers set customer_group=$1,updated_at=now() where customer_group_id=$2 and deleted_at is null",[name,req.params.id]);
  res.json(updated);
}));
app.put("/api/customer-groups/:id/members",requirePermission("customers.manage"),asyncRoute(async(req,res)=>{
  const customerIds=[...new Set((Array.isArray(req.body?.customerIds)?req.body.customerIds:[]).map(Number))];
  if(customerIds.some(id=>!Number.isSafeInteger(id)||id<=0))return res.status(400).json({error:"invalid customer IDs"});
  const client=await pool.connect();
  try{await client.query("begin");const group=(await client.query("select id,name from customer_groups where id=$1 and deleted_at is null for update",[req.params.id])).rows[0];if(!group){const error=new Error("customer group not found");error.status=404;throw error}if(customerIds.length&&(await client.query("select count(*)::int count from customers where id=any($1::bigint[]) and deleted_at is null",[customerIds])).rows[0].count!==customerIds.length){const error=new Error("one or more customers do not exist");error.status=400;throw error}await client.query("update customers set customer_group_id=null,customer_group='',updated_at=now() where customer_group_id=$1 and deleted_at is null",[req.params.id]);if(customerIds.length)await client.query("update customers set customer_group_id=$1,customer_group=$2,updated_at=now() where id=any($3::bigint[]) and deleted_at is null",[req.params.id,group.name,customerIds]);await client.query("commit");res.json({id:Number(req.params.id),customerIds})}catch(error){await client.query("rollback");throw error}finally{client.release()}
}));
app.delete("/api/customer-groups/:id",requirePermission("customers.manage"),asyncRoute(async(req,res)=>{
  const client=await pool.connect();
  try{await client.query("begin");const result=await client.query("update customer_groups set deleted_at=now(),deleted_by=$1,updated_at=now() where id=$2 and deleted_at is null returning id",[req.user.username,req.params.id]);if(!result.rowCount){const error=new Error("customer group not found");error.status=404;throw error}await client.query("update customers set customer_group_id=null,customer_group='',updated_at=now() where customer_group_id=$1",[req.params.id]);await client.query("commit");res.json({id:Number(req.params.id)})}catch(error){await client.query("rollback");throw error}finally{client.release()}
}));

const purchaseItemsFromBody=body=>Array.isArray(body?.items)?body.items.map(item=>{const rawCost=String(item.cost??"").trim();return {productId:Number(item.productId),quantity:Number(item.quantity),cost:rawCost===""?null:Number(rawCost)}}):[];
const validatePurchaseItems=items=>items.length>=1&&items.length<=200&&!items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity<=0||(item.cost!==null&&(!Number.isFinite(item.cost)||item.cost<0)))&&new Set(items.map(item=>item.productId)).size===items.length;
const loadPurchaseDetail=async(db,id)=>{
  const purchase=(await db.query("select p.*,coalesce((select sum(pi.quantity) from purchase_items pi where pi.purchase_id=p.id),0)::int quantity,(select count(*)::int from purchase_items pi where pi.purchase_id=p.id) item_count from purchases p where p.id=$1 and p.deleted_at is null",[id])).rows[0];
  if(!purchase)return null;
  const items=await db.query("select pi.id,pi.product_id,pi.quantity,pi.cost,p.sku,p.barcode,p.name,p.name2,p.unit,p.image_url from purchase_items pi join products p on p.id=pi.product_id where pi.purchase_id=$1 order by pi.id",[id]);
  return {...purchase,items:items.rows};
};

app.get("/api/purchases", requirePermission("page.purchases"), asyncRoute(async (_req,res)=>res.json((await pool.query("select p.*,coalesce(sum(pi.quantity),0)::int quantity,count(pi.id)::int item_count from purchases p left join purchase_items pi on pi.purchase_id=p.id where p.deleted_at is null group by p.id order by p.created_at desc limit 500")).rows)));
app.get("/api/purchases/:id",requirePermission("page.purchases"),asyncRoute(async(req,res)=>{
  const purchase=await loadPurchaseDetail(pool,req.params.id);
  if(!purchase)return res.status(404).json({error:"purchase not found"});
  res.json(purchase);
}));
app.post("/api/purchases", requirePermission("purchases.create"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const supplier=String(body.supplier||"").trim();
  const settings=await getSystemSettings();
  const warehouse=String(body.warehouse||"").trim()||settings.default_warehouse;
  const items=purchaseItemsFromBody(body);
  if(!validatePurchaseItems(items))return res.status(400).json({error:"purchase contains invalid or duplicate items"});
  const total=items.reduce((sum,item)=>sum+item.quantity*(item.cost??0),0);
  const client=await pool.connect();
  try{await client.query("begin");
    const productIds=items.map(item=>item.productId);
    const products=await client.query("select id from products where id=any($1::bigint[]) and deleted_at is null for update",[productIds]);
    if(products.rowCount!==items.length){const error=new Error("one or more products do not exist");error.status=400;throw error}
    const order=await client.query("insert into purchases(order_no,supplier,warehouse,total,status,received_at) values($1,$2,$3,$4,$5,now()) returning *",[body.orderNo||`${settings.purchase_order_prefix}${Date.now()}`,supplier,warehouse,total,"已入库"]);
    for(const item of items){await client.query("insert into purchase_items(purchase_id,product_id,quantity,cost) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.cost??0]);await client.query("update products set stock=stock+$1,cost=coalesce($2,cost),updated_at=now() where id=$3",[item.quantity,item.cost,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'purchase',$4,$5)",[item.productId,warehouse,item.quantity,order.rows[0].order_no,req.user.username]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.put("/api/purchases/:id",requireRole("admin"),asyncRoute(async(req,res)=>{
  const body=req.body||{},supplier=String(body.supplier||"").trim(),settings=await getSystemSettings(),warehouse=String(body.warehouse||"").trim()||settings.default_warehouse,items=purchaseItemsFromBody(body);
  if(!validatePurchaseItems(items))return res.status(400).json({error:"purchase contains invalid or duplicate items"});
  const total=items.reduce((sum,item)=>sum+item.quantity*(item.cost??0),0),client=await pool.connect();
  try{
    await client.query("begin");
    const purchase=(await client.query("select * from purchases where id=$1 and deleted_at is null for update",[req.params.id])).rows[0];
    if(!purchase){const error=new Error("purchase not found");error.status=404;throw error}
    const previousItems=(await client.query("select product_id,quantity,cost from purchase_items where purchase_id=$1 order by product_id for update",[req.params.id])).rows;
    const allProductIds=[...new Set([...previousItems.map(item=>Number(item.product_id)),...items.map(item=>item.productId)])].sort((a,b)=>a-b);
    if(allProductIds.length)await client.query("select id from products where id=any($1::bigint[]) order by id for update",[allProductIds]);
    const activeProducts=await client.query("select id from products where id=any($1::bigint[]) and deleted_at is null",[items.map(item=>item.productId)]);
    if(activeProducts.rowCount!==items.length){const error=new Error("one or more products do not exist");error.status=400;throw error}
    if(purchase.status==="已入库")for(const item of previousItems){await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.product_id]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'purchase_edit_reverse',$4,$5)",[item.product_id,purchase.warehouse,-Number(item.quantity),purchase.order_no,req.user.username])}
    await client.query("delete from purchase_items where purchase_id=$1",[req.params.id]);
    for(const item of items)await client.query("insert into purchase_items(purchase_id,product_id,quantity,cost) values($1,$2,$3,$4)",[req.params.id,item.productId,item.quantity,item.cost??0]);
    if(purchase.status==="已入库")for(const item of items){await client.query("update products set stock=stock+$1,cost=case when $2::numeric>0 then $2 else cost end,updated_at=now() where id=$3",[item.quantity,item.cost??0,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'purchase_edit',$4,$5)",[item.productId,warehouse,item.quantity,purchase.order_no,req.user.username])}
    await client.query("update purchases set supplier=$1,warehouse=$2,total=$3,updated_at=now() where id=$4",[supplier,warehouse,total,req.params.id]);
    const updated=await loadPurchaseDetail(client,req.params.id);
    await client.query("commit");res.json(updated);
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));

app.patch("/api/purchases/:id/status",requirePermission("purchases.create"),asyncRoute(async(req,res)=>{
  const targetStatus=String(req.body?.status||"");
  if(!["已入库","未入库"].includes(targetStatus))return res.status(400).json({error:"invalid purchase status"});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const purchase=(await client.query("select * from purchases where id=$1 and deleted_at is null for update",[req.params.id])).rows[0];
    if(!purchase){const error=new Error("purchase not found");error.status=404;throw error}
    const currentStatus=purchase.status==="待审核"?"未入库":purchase.status;
    if(currentStatus!==targetStatus){
      const items=(await client.query("select product_id,quantity,cost from purchase_items where purchase_id=$1 order by product_id for update",[req.params.id])).rows;
      if(items.length)await client.query("select id from products where id=any($1::bigint[]) order by id for update",[items.map(item=>item.product_id)]);
      const receiving=targetStatus==="已入库";
      for(const item of items){
        await client.query(`update products set stock=stock+$1,cost=case when $2::numeric>0 and $3::boolean then $2 else cost end,updated_at=now() where id=$4`,[receiving?Number(item.quantity):-Number(item.quantity),item.cost,receiving,item.product_id]);
        await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,$4,$5,$6)",[item.product_id,purchase.warehouse,receiving?Number(item.quantity):-Number(item.quantity),receiving?"purchase_receive":"purchase_unreceive",purchase.order_no,req.user.username]);
      }
      await client.query("update purchases set status=$1,received_at=case when $1='已入库' then now() else null end,updated_at=now() where id=$2",[targetStatus,req.params.id]);
    }
    const updated=await loadPurchaseDetail(client,req.params.id);
    await client.query("commit");res.json(updated);
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));

app.delete("/api/purchases/:id", requirePermission("purchases.delete"), asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const purchase=await client.query("select id,order_no,warehouse,status from purchases where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!purchase.rowCount){const error=new Error("purchase not found");error.status=404;throw error}
    const items=await client.query("select product_id,quantity from purchase_items where purchase_id=$1 order by product_id for update",[req.params.id]);
    if(purchase.rows[0].status==="已入库")for(const item of items.rows){await client.query("select id from products where id=$1 for update",[item.product_id]);await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.product_id]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'purchase_delete',$4,$5)",[item.product_id,purchase.rows[0].warehouse,-Number(item.quantity),purchase.rows[0].order_no,req.user.username])}
    await client.query("update purchases set deleted_at=now(),deleted_by=$1 where id=$2",[req.user.username,req.params.id]);
    await client.query("commit");res.json({id:Number(req.params.id)});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));

app.get("/api/sales", requireAnyPermission("page.dashboard","page.sales","page.scanSales","page.collectorSales","page.issueInvoice","page.reports"), asyncRoute(async (req,res)=>{
  const startDate=String(req.query.startDate||"");
  const endDate=String(req.query.endDate||"");
  const datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const validDate=value=>datePattern.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  if((startDate&&!validDate(startDate))||(endDate&&!validDate(endDate)))return res.status(400).json({error:"invalid date range"});
  if(startDate&&endDate&&startDate>endDate)return res.status(400).json({error:"start date must not be after end date"});
  const params=startDate||endDate?[businessTimezone]:[],filters=["s.deleted_at is null"];
  if(startDate){params.push(startDate);filters.push(`s.created_at >= ($${params.length}::date at time zone $1)`)}
  if(endDate){params.push(endDate);filters.push(`s.created_at < (($${params.length}::date + 1) at time zone $1)`)}
  const where=` where ${filters.join(" and ")}`;
  const limit=startDate||endDate?"":" limit 500";
  const result=await pool.query(`select s.*,c.name customer,(select count(*)::int from sale_items si where si.sale_id=s.id) item_count,(select coalesce(sum(si.quantity),0)::int from sale_items si where si.sale_id=s.id) quantity,(select coalesce(string_agg(distinct p.sku,' '),'') from sale_items si join products p on p.id=si.product_id where si.sale_id=s.id) product_skus,(select coalesce(sum(sp.amount),0)::numeric from sale_payments sp where sp.sale_id=s.id) paid_total,exists(select 1 from invoices deleted_invoice where deleted_invoice.sale_id=s.id and deleted_invoice.deleted_at is not null) invoice_record_deleted from sales s left join customers c on c.id=s.customer_id${where} order by s.created_at desc${limit}`,params);
  res.json(result.rows);
}));
app.get("/api/sales/:id", requireAnyPermission("page.sales","page.scanSales","page.collectorSales","page.issueInvoice","page.invoiceList","page.reports"), asyncRoute(async (req,res)=>{
  const sale=await pool.query("select s.*,c.name customer,c.phone customer_phone,c.city customer_city,c.address customer_address,c.country customer_country,c.postal_code customer_postal_code,c.tax_number customer_tax_number,c.email customer_email from sales s left join customers c on c.id=s.customer_id where s.id=$1 and s.deleted_at is null",[req.params.id]);
  if(!sale.rowCount)return res.status(404).json({error:"sale not found"});
  const items=await pool.query("select si.id,si.product_id,si.quantity,si.original_price,si.discount_percent,si.price,p.sku,p.barcode,p.name,p.name2,p.unit,p.stock,p.image_url from sale_items si join products p on p.id=si.product_id where si.sale_id=$1 order by si.id",[req.params.id]);
  const payments=await pool.query("select id,amount,method,booked_on,category,note,created_by,created_at from sale_payments where sale_id=$1 order by created_at desc,id desc",[req.params.id]);
  const paidTotal=payments.rows.reduce((sum,payment)=>sum+Number(payment.amount),0);
  res.json({...sale.rows[0],paid_total:paidTotal,balance:Math.max(Number(sale.rows[0].total)-paidTotal,0),items:items.rows,payments:payments.rows});
}));

app.get("/api/invoices", requireAnyPermission("page.invoiceList","page.issueInvoice"), asyncRoute(async (_req,res)=>{
  const result=await pool.query("select i.*,s.order_no,coalesce(nullif(i.buyer_name,''),c.name) customer,p.invoice_number parent_invoice_number,case when i.document_type in ('invoice','replacement') and exists(select 1 from invoices x where x.parent_invoice_id=i.id and x.document_type='cancellation' and x.status='issued') then 'zeroed' when i.document_type in ('invoice','replacement') and exists(select 1 from invoices x where x.parent_invoice_id=i.id and x.document_type='storno' and x.status='issued') then 'voided' when i.document_type in ('invoice','replacement') and exists(select 1 from invoices x where x.parent_invoice_id=i.id and x.document_type='correction' and x.status='issued') then 'corrected' else i.status end lifecycle_status from invoices i join sales s on s.id=i.sale_id left join customers c on c.id=s.customer_id left join invoices p on p.id=i.parent_invoice_id where s.deleted_at is null order by i.created_at desc limit 500");
  res.json(result.rows);
}));

app.get("/api/invoices/:id", requirePermission("page.invoiceList"), asyncRoute(async (req,res)=>{
  const invoice=(await pool.query("select i.*,s.order_no,p.invoice_number parent_invoice_number from invoices i join sales s on s.id=i.sale_id left join invoices p on p.id=i.parent_invoice_id where i.id=$1 and i.deleted_at is null and s.deleted_at is null",[req.params.id])).rows[0];
  if(!invoice)return res.status(404).json({error:"invoice not found"});
  const items=await pool.query("select * from invoice_items where invoice_id=$1 order by id",[req.params.id]);
  const related=await pool.query("select id,document_type,invoice_number,status,created_at from invoices where parent_invoice_id=$1 and deleted_at is null order by created_at,id",[req.params.id]);
  res.json({...invoice,items:items.rows,related:related.rows});
}));

app.get("/api/invoices/:id/pdf", requirePermission("invoices.download"), asyncRoute(async (req,res)=>{
  const invoice=(await pool.query("select invoice_number,pdf_path,status from invoices where id=$1 and deleted_at is null",[req.params.id])).rows[0];
  if(!invoice)return res.status(404).json({error:"invoice not found"});
  if(invoice.status!=="issued"||!invoice.pdf_path)return res.status(409).json({error:"invoice PDF is not available"});
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`inline; filename="${String(invoice.invoice_number||"invoice").replace(/[^A-Za-z0-9._-]/g,"_")}.pdf"`);
  res.sendFile(path.join(invoiceDirectory,path.basename(invoice.pdf_path)));
}));

app.delete("/api/invoices/:id", requirePermission("invoices.delete"), asyncRoute(async (req,res)=>{
  const result=await pool.query("update invoices set deleted_at=now(),deleted_by=$1,updated_at=now() where id=$2 and deleted_at is null returning id,invoice_number",[req.user.username,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"invoice not found"});
  res.json({id:Number(result.rows[0].id),invoiceNumber:result.rows[0].invoice_number,externalInvoiceUnchanged:true});
}));

app.post("/api/sales/:id/invoice", requirePermission("invoices.issue"), asyncRoute(async (req,res)=>{
  const agentKey=String(process.env.SZAMLAZZ_AGENT_KEY||"").trim();
  if(!agentKey)return res.status(503).json({error:"SZAMLAZZ_AGENT_KEY is not configured"});
  const b=req.body||{},paymentMethod=String(b.paymentMethod||"cash"),fulfillmentDate=String(b.fulfillmentDate||""),dueDate=String(b.dueDate||""),priceFactor=Number(b.priceFactor??1),exchangeRateBank=String(b.exchangeRateBank||"MNB").trim().slice(0,100),exchangeRate=Number(b.exchangeRate);
  if(!new Set(["cash","bank_transfer"]).has(paymentMethod)||!validIsoDate(fulfillmentDate)||!validIsoDate(dueDate)||dueDate<fulfillmentDate||!Number.isFinite(priceFactor)||priceFactor<=0||priceFactor>100)return res.status(400).json({error:"invalid invoice settings"});
  const sale=(await pool.query("select s.*,c.name customer_name,c.phone customer_phone,c.city customer_city,c.address customer_address,c.country customer_country,c.postal_code customer_postal_code,c.tax_number customer_tax_number,c.email customer_email from sales s left join customers c on c.id=s.customer_id where s.id=$1 and s.deleted_at is null",[req.params.id])).rows[0];
  if(!sale)return res.status(404).json({error:"sale not found"});
  if((await pool.query("select 1 from invoices where sale_id=$1 and deleted_at is not null limit 1",[sale.id])).rowCount)return res.status(409).json({error:"the ERP invoice record was deleted, but the external invoice still exists; another invoice cannot be issued"});
  if(!sale.customer_id)return res.status(409).json({error:"select a customer before issuing an invoice"});
  const customer={id:sale.customer_id,name:sale.customer_name,phone:sale.customer_phone,city:sale.customer_city,address:sale.customer_address,country:sale.customer_country,postal_code:sale.customer_postal_code,tax_number:sale.customer_tax_number,email:sale.customer_email};
  if(!customer.name||!customer.postal_code||!customer.city||!customer.address)return res.status(409).json({error:"customer invoice name, postal code, city and address are required"});
  if(!currencies.has(sale.currency))return res.status(409).json({error:"unsupported invoice currency"});
  if(sale.currency!=="HUF"&&(!Number.isFinite(exchangeRate)||exchangeRate<=0||!exchangeRateBank))return res.status(400).json({error:"foreign-currency invoices require a positive exchange rate and bank"});
  const rows=(await pool.query("select si.id sale_item_id,si.product_id,si.quantity,si.price,p.sku,p.name,p.unit from sale_items si join products p on p.id=si.product_id where si.sale_id=$1 order by si.id",[req.params.id])).rows;
  if(!rows.length||rows.some(item=>Number(item.quantity)<=0))return res.status(409).json({error:"only sales containing positive quantities can be invoiced"});
  const customPrices=new Map((Array.isArray(b.items)?b.items:[]).map(item=>[Number(item.saleItemId),Number(item.netUnitPrice)]));
  if([...customPrices].some(([id,price])=>!Number.isSafeInteger(id)||!Number.isFinite(price)||price<0))return res.status(400).json({error:"invalid custom invoice price"});
  const items=rows.map(row=>{
    const source=customPrices.has(Number(row.sale_item_id))?customPrices.get(Number(row.sale_item_id)):Number(row.price)*priceFactor;
    const netUnitPrice=Number(source.toFixed(2)),netTotal=invoiceRound(Number(row.quantity)*netUnitPrice,sale.currency),vatTotal=invoiceRound(netTotal*.27,sale.currency),grossTotal=invoiceRound(netTotal+vatTotal,sale.currency);
    return {...row,quantity:Number(row.quantity),netUnitPrice,netTotal,vatTotal,grossTotal};
  });
  const netTotal=invoiceRound(items.reduce((sum,item)=>sum+item.netTotal,0),sale.currency),vatTotal=invoiceRound(items.reduce((sum,item)=>sum+item.vatTotal,0),sale.currency),grossTotal=invoiceRound(items.reduce((sum,item)=>sum+item.grossTotal,0),sale.currency);
  if(netTotal<=0)return res.status(409).json({error:"invoice total must be positive"});
  let replacesInvoiceId=Number(b.replacesInvoiceId)||null;
  let documentType="invoice",parentInvoice=null;
  if(replacesInvoiceId){
    parentInvoice=(await pool.query("select * from invoices where id=$1 and sale_id=$2 and document_type in ('invoice','replacement')",[replacesInvoiceId,sale.id])).rows[0];
    if(!parentInvoice||parentInvoice.status!=="issued")return res.status(409).json({error:"replacement requires an issued invoice"});
    const storno=(await pool.query("select 1 from invoices where parent_invoice_id=$1 and document_type in ('storno','cancellation') and status='issued'",[parentInvoice.id])).rowCount;
    if(!storno)return res.status(409).json({error:"invoice must be voided before it can be reissued"});
    documentType="replacement";
  }else{
    const active=(await pool.query("select invoice_number from invoices i where sale_id=$1 and document_type in ('invoice','replacement') and status='issued' and not exists(select 1 from invoices x where x.parent_invoice_id=i.id and x.document_type in ('storno','cancellation') and x.status='issued') order by i.id desc limit 1",[sale.id])).rows[0];
    if(active)return res.status(409).json({error:`invoice already issued: ${active.invoice_number}`});
    const latestVoided=(await pool.query("select i.* from invoices i where i.sale_id=$1 and i.document_type in ('invoice','replacement') and i.status='issued' and exists(select 1 from invoices x where x.parent_invoice_id=i.id and x.document_type in ('storno','cancellation') and x.status='issued') order by i.id desc limit 1",[sale.id])).rows[0];
    if(latestVoided){replacesInvoiceId=Number(latestVoided.id);parentInvoice=latestVoided;documentType="replacement"}
  }
  const externalId=replacesInvoiceId?`yunlian-sale-${sale.id}-replacement-${replacesInvoiceId}`:`yunlian-sale-${sale.id}`,existing=(await pool.query("select * from invoices where external_id=$1",[externalId])).rows[0];
  if(existing?.status==="issued")return res.status(409).json({error:`invoice already issued: ${existing.invoice_number}`});
  const activeProcessing=existing?.status==="processing"&&Date.now()-new Date(existing.updated_at).getTime()<2*60*1000;
  if(activeProcessing)return res.status(409).json({error:"invoice creation is already in progress"});
  const shouldRecover=Boolean(existing);
  const values=[paymentMethod,fulfillmentDate,dueDate,sale.currency,sale.currency==="HUF"?null:exchangeRate,exchangeRateBank,priceFactor,netTotal,vatTotal,grossTotal],buyerValues=[customer.name,customer.country||"Magyarország",customer.postal_code,customer.city,customer.address,customer.tax_number||"",customer.email||""];
  const invoice=existing?(await pool.query("update invoices set status='processing',payment_method=$1,fulfillment_date=$2,due_date=$3,currency=$4,exchange_rate=$5,exchange_rate_bank=$6,price_factor=$7,net_total=$8,vat_total=$9,gross_total=$10,buyer_name=$11,buyer_country=$12,buyer_postal_code=$13,buyer_city=$14,buyer_address=$15,buyer_tax_number=$16,buyer_email=$17,error_code='',error_message='',updated_at=now() where id=$18 returning *",[...values,...buyerValues,existing.id])).rows[0]:(await pool.query("insert into invoices(sale_id,external_id,document_type,parent_invoice_id,payment_method,fulfillment_date,due_date,currency,exchange_rate,exchange_rate_bank,price_factor,net_total,vat_total,gross_total,created_by,buyer_name,buyer_country,buyer_postal_code,buyer_city,buyer_address,buyer_tax_number,buyer_email) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *",[sale.id,externalId,documentType,parentInvoice?.id||null,...values,req.user.username,...buyerValues])).rows[0];
  try{
    const xml=createInvoiceXml({agentKey,externalId,sale,customer,items,paymentMethod,fulfillmentDate,dueDate,exchangeRate,exchangeRateBank,note:documentType==="replacement"?`ERP újraszámlázás / 重开发票: ${parentInvoice.invoice_number}; rendelés: ${sale.order_no}`:""});
    const issued=shouldRecover?(await queryInvoicePdf(agentKey,externalId)||await sendInvoiceXml(xml)):await sendInvoiceXml(xml),fileName=`invoice-${invoice.id}-${crypto.randomUUID()}.pdf`;
    await writeFile(path.join(invoiceDirectory,fileName),issued.pdf,{flag:"wx"});
    const client=await pool.connect();
    try{
      await client.query("begin");
      await client.query("delete from invoice_items where invoice_id=$1",[invoice.id]);
      for(const item of items)await client.query("insert into invoice_items(invoice_id,sale_item_id,product_id,sku,name,unit,quantity,net_unit_price,vat_rate,net_total,vat_total,gross_total) values($1,$2,$3,$4,$5,$6,$7,$8,27,$9,$10,$11)",[invoice.id,item.sale_item_id,item.product_id,item.sku,item.name,item.unit||"db",item.quantity,item.netUnitPrice,item.netTotal,item.vatTotal,item.grossTotal]);
      const updated=await client.query("update invoices set status='issued',invoice_number=$1,pdf_path=$2,issued_at=now(),updated_at=now() where id=$3 returning *",[issued.invoiceNumber,fileName,invoice.id]);
      await client.query("commit");res.status(201).json(updated.rows[0]);
    }catch(error){await client.query("rollback");throw error}finally{client.release()}
  }catch(error){await pool.query("update invoices set status='failed',error_code=$1,error_message=$2,updated_at=now() where id=$3",[String(error.providerCode||""),String(error.message||"invoice creation failed").slice(0,2000),invoice.id]);throw error}
}));

app.post("/api/invoices/:id/storno", requirePermission("invoices.manage"), asyncRoute(async (req,res)=>{
  const agentKey=String(process.env.SZAMLAZZ_AGENT_KEY||"").trim();
  if(!agentKey)return res.status(503).json({error:"SZAMLAZZ_AGENT_KEY is not configured"});
  const reason=String(req.body?.reason||"").trim().slice(0,1000);
  if(reason.length<3)return res.status(400).json({error:"storno reason is required"});
  const source=(await pool.query("select i.*,s.order_no from invoices i join sales s on s.id=i.sale_id where i.id=$1 and i.deleted_at is null and s.deleted_at is null and i.document_type in ('invoice','replacement')",[req.params.id])).rows[0];
  if(!source||source.status!=="issued")return res.status(409).json({error:"only an issued invoice can be voided"});
  const correction=(await pool.query("select c.* from invoices c where c.parent_invoice_id=$1 and c.document_type='correction' and c.status='issued' order by c.id desc limit 1",[source.id])).rows[0];
  if(correction){
    const externalId=`yunlian-cancellation-${source.id}`,existing=(await pool.query("select * from invoices where external_id=$1",[externalId])).rows[0];
    if(existing?.status==="issued")return res.status(201).json(existing);
    if(existing?.status==="processing"&&Date.now()-new Date(existing.updated_at).getTime()<2*60*1000)return res.status(409).json({error:"cancellation correction is already in progress"});
    const chainItems=(await pool.query("select ii.* from invoice_items ii join invoices d on d.id=ii.invoice_id where d.id=$1 or (d.parent_invoice_id=$1 and d.document_type='correction' and d.status='issued') order by d.id,ii.id",[source.id])).rows;
    if(!chainItems.length)return res.status(409).json({error:"invoice chain items are missing"});
    const items=chainItems.map(item=>({...item,name:`Érvénytelenítés: ${item.name}`,quantity:-Number(item.quantity),netUnitPrice:Number(item.net_unit_price),vatRate:Number(item.vat_rate),netTotal:-Number(item.net_total),vatTotal:-Number(item.vat_total),grossTotal:-Number(item.gross_total)}));
    const netTotal=invoiceRound(items.reduce((sum,item)=>sum+item.netTotal,0),source.currency),vatTotal=invoiceRound(items.reduce((sum,item)=>sum+item.vatTotal,0),source.currency),grossTotal=invoiceRound(items.reduce((sum,item)=>sum+item.grossTotal,0),source.currency);
    const buyerValues=[correction.buyer_name,correction.buyer_country,correction.buyer_postal_code,correction.buyer_city,correction.buyer_address,correction.buyer_tax_number,correction.buyer_email];
    const cancellation=existing?(await pool.query("update invoices set status='processing',reason=$1,net_total=$2,vat_total=$3,gross_total=$4,error_code='',error_message='',updated_at=now() where id=$5 returning *",[reason,netTotal,vatTotal,grossTotal,existing.id])).rows[0]:(await pool.query("insert into invoices(sale_id,external_id,document_type,parent_invoice_id,payment_method,fulfillment_date,due_date,currency,exchange_rate,exchange_rate_bank,price_factor,net_total,vat_total,gross_total,reason,buyer_name,buyer_country,buyer_postal_code,buyer_city,buyer_address,buyer_tax_number,buyer_email,created_by) values($1,$2,'cancellation',$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *",[source.sale_id,externalId,source.id,source.payment_method,source.fulfillment_date,source.due_date,source.currency,source.exchange_rate,source.exchange_rate_bank,netTotal,vatTotal,grossTotal,reason,...buyerValues,req.user.username])).rows[0];
    try{
      const recovered=existing?await queryInvoicePdf(agentKey,externalId):null;
      const customer={id:source.sale_id,name:correction.buyer_name,country:correction.buyer_country,postal_code:correction.buyer_postal_code,city:correction.buyer_city,address:correction.buyer_address,tax_number:correction.buyer_tax_number,email:correction.buyer_email,phone:""},sale={currency:source.currency,order_no:source.order_no};
      const issued=recovered||await sendInvoiceXml(createInvoiceXml({agentKey,externalId,sale,customer,items,paymentMethod:source.payment_method,fulfillmentDate:source.fulfillment_date,dueDate:source.due_date,exchangeRate:source.exchange_rate,exchangeRateBank:source.exchange_rate_bank,correctedInvoiceNumber:source.invoice_number,note:`${source.invoice_number} nullázó helyesbítése / 发票归零作废。Ok / 原因: ${reason}`})),fileName=`invoice-${cancellation.id}-${crypto.randomUUID()}.pdf`;
      await writeFile(path.join(invoiceDirectory,fileName),issued.pdf,{flag:"wx"});
      const client=await pool.connect();
      try{await client.query("begin");await client.query("delete from invoice_items where invoice_id=$1",[cancellation.id]);for(const item of items)await client.query("insert into invoice_items(invoice_id,sale_item_id,product_id,sku,name,unit,quantity,net_unit_price,vat_rate,net_total,vat_total,gross_total) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[cancellation.id,item.sale_item_id,item.product_id,item.sku,item.name,item.unit,item.quantity,item.netUnitPrice,item.vatRate,item.netTotal,item.vatTotal,item.grossTotal]);const updated=await client.query("update invoices set status='issued',invoice_number=$1,pdf_path=$2,issued_at=now(),updated_at=now() where id=$3 returning *",[issued.invoiceNumber,fileName,cancellation.id]);await client.query("commit");return res.status(201).json(updated.rows[0])}catch(error){await client.query("rollback");throw error}finally{client.release()}
    }catch(error){await pool.query("update invoices set status='failed',error_code=$1,error_message=$2,updated_at=now() where id=$3",[String(error.providerCode||""),String(error.message||"cancellation correction failed").slice(0,2000),cancellation.id]);throw error}
  }
  const externalId=`yunlian-storno-${source.id}`,existing=(await pool.query("select * from invoices where external_id=$1",[externalId])).rows[0];
  if(existing?.status==="issued")return res.status(409).json({error:`invoice already voided: ${existing.invoice_number}`});
  if(existing?.status==="processing"&&Date.now()-new Date(existing.updated_at).getTime()<2*60*1000)return res.status(409).json({error:"storno is already in progress"});
  const copied=[source.payment_method,source.fulfillment_date,source.due_date,source.currency,source.exchange_rate,source.exchange_rate_bank,source.price_factor,-Number(source.net_total),-Number(source.vat_total),-Number(source.gross_total),reason,source.buyer_name,source.buyer_country,source.buyer_postal_code,source.buyer_city,source.buyer_address,source.buyer_tax_number,source.buyer_email];
  const storno=existing?(await pool.query("update invoices set status='processing',reason=$1,error_code='',error_message='',updated_at=now() where id=$2 returning *",[reason,existing.id])).rows[0]:(await pool.query("insert into invoices(sale_id,external_id,document_type,parent_invoice_id,payment_method,fulfillment_date,due_date,currency,exchange_rate,exchange_rate_bank,price_factor,net_total,vat_total,gross_total,reason,buyer_name,buyer_country,buyer_postal_code,buyer_city,buyer_address,buyer_tax_number,buyer_email,created_by) values($1,$2,'storno',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *",[source.sale_id,externalId,source.id,...copied,req.user.username])).rows[0];
  try{
    const recovered=existing?await queryInvoicePdf(agentKey,externalId):null;
    const issueDate=new Intl.DateTimeFormat("sv-SE",{timeZone:businessTimezone}).format(new Date());
    const issued=recovered||await sendStornoXml(createStornoXml({agentKey,externalId,invoiceNumber:source.invoice_number,issueDate})),fileName=`invoice-${storno.id}-${crypto.randomUUID()}.pdf`;
    await writeFile(path.join(invoiceDirectory,fileName),issued.pdf,{flag:"wx"});
    const client=await pool.connect();
    try{await client.query("begin");await client.query("delete from invoice_items where invoice_id=$1",[storno.id]);await client.query("insert into invoice_items(invoice_id,sale_item_id,product_id,sku,name,unit,quantity,net_unit_price,vat_rate,net_total,vat_total,gross_total) select $1,sale_item_id,product_id,sku,name,unit,-quantity,net_unit_price,vat_rate,-net_total,-vat_total,-gross_total from invoice_items where invoice_id=$2",[storno.id,source.id]);const updated=await client.query("update invoices set status='issued',invoice_number=$1,pdf_path=$2,issued_at=now(),updated_at=now() where id=$3 returning *",[issued.invoiceNumber,fileName,storno.id]);await client.query("commit");res.status(201).json(updated.rows[0])}catch(error){await client.query("rollback");throw error}finally{client.release()}
  }catch(error){await pool.query("update invoices set status='failed',error_code=$1,error_message=$2,updated_at=now() where id=$3",[String(error.providerCode||""),String(error.message||"storno failed").slice(0,2000),storno.id]);throw error}
}));

app.post("/api/invoices/:id/corrections", requirePermission("invoices.manage"), asyncRoute(async (req,res)=>{
  const agentKey=String(process.env.SZAMLAZZ_AGENT_KEY||"").trim();
  if(!agentKey)return res.status(503).json({error:"SZAMLAZZ_AGENT_KEY is not configured"});
  const reason=String(req.body?.reason||"").trim().slice(0,1000);
  if(reason.length<3)return res.status(400).json({error:"correction reason is required"});
  const source=(await pool.query("select i.*,s.order_no,s.customer_id from invoices i join sales s on s.id=i.sale_id where i.id=$1 and i.deleted_at is null and s.deleted_at is null and i.document_type in ('invoice','replacement')",[req.params.id])).rows[0];
  if(!source||source.status!=="issued")return res.status(409).json({error:"only an issued invoice can be corrected"});
  if((await pool.query("select 1 from invoices where parent_invoice_id=$1 and document_type in ('storno','cancellation') and status='issued'",[source.id])).rowCount)return res.status(409).json({error:"a voided invoice cannot be corrected"});
  const existing=(await pool.query("select * from invoices where parent_invoice_id=$1 and document_type='correction' order by id desc limit 1",[source.id])).rows[0];
  if(existing?.status==="issued")return res.status(409).json({error:"this invoice has already been corrected and cannot be corrected again"});
  if(existing?.status==="processing"&&Date.now()-new Date(existing.updated_at).getTime()<2*60*1000)return res.status(409).json({error:"correction is already in progress"});
  const sourceItems=(await pool.query("select * from invoice_items where invoice_id=$1 order by id",[source.id])).rows;
  if(!sourceItems.length)return res.status(409).json({error:"invoice items are missing"});
  const buyerInput=req.body?.buyer||{},buyer={name:String(buyerInput.name??source.buyer_name).trim().slice(0,200),country:String(buyerInput.country??source.buyer_country).trim().slice(0,100),postalCode:String(buyerInput.postalCode??source.buyer_postal_code).trim().slice(0,30),city:String(buyerInput.city??source.buyer_city).trim().slice(0,120),address:String(buyerInput.address??source.buyer_address).trim().slice(0,300),taxNumber:String(buyerInput.taxNumber??source.buyer_tax_number).trim().slice(0,50),email:String(buyerInput.email??source.buyer_email).trim().slice(0,200)};
  if(!buyer.name||!buyer.postalCode||!buyer.city||!buyer.address)return res.status(400).json({error:"corrected buyer name, postal code, city and address are required"});
  const buyerChanged=buyer.name!==source.buyer_name||buyer.country!==source.buyer_country||buyer.postalCode!==source.buyer_postal_code||buyer.city!==source.buyer_city||buyer.address!==source.buyer_address||buyer.taxNumber!==source.buyer_tax_number||buyer.email!==source.buyer_email;
  const requested=new Map((Array.isArray(req.body?.items)?req.body.items:[]).map(item=>[Number(item.invoiceItemId),{quantity:Number(item.quantity),netUnitPrice:Number(item.netUnitPrice)}]));
  if(requested.size!==sourceItems.length||[...requested.values()].some(item=>!Number.isSafeInteger(item.quantity)||item.quantity<0||!Number.isFinite(item.netUnitPrice)||item.netUnitPrice<0))return res.status(400).json({error:"invalid corrected invoice items"});
  const correctionItems=[];
  for(const old of sourceItems){const next=requested.get(Number(old.id));if(!next)return res.status(400).json({error:"corrected invoice item is missing"});const oldQuantity=Number(old.quantity),oldPrice=Number(old.net_unit_price);if(next.quantity===oldQuantity&&Math.abs(next.netUnitPrice-oldPrice)<0.005)continue;const negativeNet=invoiceRound(-oldQuantity*oldPrice,source.currency),negativeVat=invoiceRound(negativeNet*.27,source.currency),nextNet=invoiceRound(next.quantity*next.netUnitPrice,source.currency),nextVat=invoiceRound(nextNet*.27,source.currency);correctionItems.push({...old,quantity:-oldQuantity,netUnitPrice:oldPrice,netTotal:negativeNet,vatTotal:negativeVat,grossTotal:invoiceRound(negativeNet+negativeVat,source.currency),name:`Korrekció (-): ${old.name}`},{...old,quantity:next.quantity,netUnitPrice:Number(next.netUnitPrice.toFixed(2)),netTotal:nextNet,vatTotal:nextVat,grossTotal:invoiceRound(nextNet+nextVat,source.currency),name:`Korrekció (+): ${old.name}`})}
  if(!correctionItems.length&&buyerChanged){const old=sourceItems[0];correctionItems.push({...old,sku:"TECH-CORRECTION",name:"Vevőadat helyesbítés / 客户资料更正",quantity:0,netUnitPrice:0,vatRate:0,netTotal:0,vatTotal:0,grossTotal:0})}
  if(!correctionItems.length)return res.status(409).json({error:"no invoice data was changed"});
  const netTotal=invoiceRound(correctionItems.reduce((sum,item)=>sum+item.netTotal,0),source.currency),vatTotal=invoiceRound(correctionItems.reduce((sum,item)=>sum+item.vatTotal,0),source.currency),grossTotal=invoiceRound(netTotal+vatTotal,source.currency),externalId=`yunlian-correction-${source.id}-1`;
  const customer={id:source.customer_id,name:buyer.name,country:buyer.country,postal_code:buyer.postalCode,city:buyer.city,address:buyer.address,tax_number:buyer.taxNumber,email:buyer.email,phone:""},sale={currency:source.currency,order_no:source.order_no};
  const buyerValues=[buyer.name,buyer.country,buyer.postalCode,buyer.city,buyer.address,buyer.taxNumber,buyer.email];
  const correction=existing?(await pool.query("update invoices set status='processing',reason=$1,net_total=$2,vat_total=$3,gross_total=$4,buyer_name=$5,buyer_country=$6,buyer_postal_code=$7,buyer_city=$8,buyer_address=$9,buyer_tax_number=$10,buyer_email=$11,error_code='',error_message='',updated_at=now() where id=$12 returning *",[reason,netTotal,vatTotal,grossTotal,...buyerValues,existing.id])).rows[0]:(await pool.query("insert into invoices(sale_id,external_id,document_type,parent_invoice_id,payment_method,fulfillment_date,due_date,currency,exchange_rate,exchange_rate_bank,price_factor,net_total,vat_total,gross_total,reason,buyer_name,buyer_country,buyer_postal_code,buyer_city,buyer_address,buyer_tax_number,buyer_email,created_by) values($1,$2,'correction',$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *",[source.sale_id,externalId,source.id,source.payment_method,source.fulfillment_date,source.due_date,source.currency,source.exchange_rate,source.exchange_rate_bank,netTotal,vatTotal,grossTotal,reason,...buyerValues,req.user.username])).rows[0];
  try{
    const recovered=existing?await queryInvoicePdf(agentKey,externalId):null;
    const issued=recovered||await sendInvoiceXml(createInvoiceXml({agentKey,externalId,sale,customer,items:correctionItems,paymentMethod:source.payment_method,fulfillmentDate:source.fulfillment_date,dueDate:source.due_date,exchangeRate:source.exchange_rate,exchangeRateBank:source.exchange_rate_bank,correctedInvoiceNumber:source.invoice_number,note:`${source.invoice_number} helyesbítése / 发票更正。Ok / 原因: ${reason}`})),fileName=`invoice-${correction.id}-${crypto.randomUUID()}.pdf`;
    await writeFile(path.join(invoiceDirectory,fileName),issued.pdf,{flag:"wx"});
    const client=await pool.connect();
    try{await client.query("begin");await client.query("delete from invoice_items where invoice_id=$1",[correction.id]);for(const item of correctionItems)await client.query("insert into invoice_items(invoice_id,sale_item_id,product_id,sku,name,unit,quantity,net_unit_price,vat_rate,net_total,vat_total,gross_total) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[correction.id,item.sale_item_id,item.product_id,item.sku,item.name,item.unit,item.quantity,item.netUnitPrice,item.vatRate??Number(item.vat_rate??27),item.netTotal,item.vatTotal,item.grossTotal]);const updated=await client.query("update invoices set status='issued',invoice_number=$1,pdf_path=$2,issued_at=now(),updated_at=now() where id=$3 returning *",[issued.invoiceNumber,fileName,correction.id]);await client.query("commit");res.status(201).json(updated.rows[0])}catch(error){await client.query("rollback");throw error}finally{client.release()}
  }catch(error){await pool.query("update invoices set status='failed',error_code=$1,error_message=$2,updated_at=now() where id=$3",[String(error.providerCode||""),String(error.message||"correction failed").slice(0,2000),correction.id]);throw error}
}));

app.get("/api/picking-sales", requirePermission("page.pickingLists"), asyncRoute(async (req,res)=>{
  const startDate=String(req.query.startDate||""),endDate=String(req.query.endDate||""),datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const validDate=value=>datePattern.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  if((startDate&&!validDate(startDate))||(endDate&&!validDate(endDate))||(startDate&&endDate&&startDate>endDate))return res.status(400).json({error:"invalid date range"});
  const params=startDate||endDate?[businessTimezone]:[],filters=["s.deleted_at is null"];
  if(startDate){params.push(startDate);filters.push(`s.created_at >= ($${params.length}::date at time zone $1)`)}
  if(endDate){params.push(endDate);filters.push(`s.created_at < (($${params.length}::date + 1) at time zone $1)`)}
  const where=` where ${filters.join(" and ")}`,limit=startDate||endDate?"":" limit 500";
  const result=await pool.query(`select s.id,s.order_no,s.created_at,s.created_by,s.notes,s.delivery_phone,s.vehicle_plate,s.delivery_address,s.delivery_date,c.name customer,(select count(*)::int from sale_items si where si.sale_id=s.id) item_count,(select coalesce(sum(si.quantity),0)::int from sale_items si where si.sale_id=s.id) quantity from sales s left join customers c on c.id=s.customer_id${where} order by s.created_at desc${limit}`,params);
  res.json(result.rows);
}));

app.get("/api/picking-sales/:id", requirePermission("page.pickingLists"), asyncRoute(async (req,res)=>{
  const sale=await pool.query("select s.id,s.order_no,s.created_at,s.created_by,s.notes,s.delivery_phone,s.vehicle_plate,s.delivery_address,s.delivery_date,c.name customer,c.phone customer_phone,c.city customer_city,c.address customer_address from sales s left join customers c on c.id=s.customer_id where s.id=$1 and s.deleted_at is null",[req.params.id]);
  if(!sale.rowCount)return res.status(404).json({error:"sale not found"});
  const items=await pool.query("select si.id,si.product_id,si.quantity,p.sku,p.barcode,p.name,p.name2,p.storage_location from sale_items si join products p on p.id=si.product_id where si.sale_id=$1 order by si.id",[req.params.id]);
  res.json({...sale.rows[0],items:items.rows});
}));

app.post("/api/sales/:id/payments", requirePermission("sales.settle"), asyncRoute(async (req,res)=>{
  const body=req.body||{},amountText=String(body.amount??""),amount=Number(body.amount),method=String(body.method||""),bookedOn=String(body.bookedOn||""),note=String(body.note||"").trim().slice(0,1000);
  const datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const parsedDate=new Date(`${bookedOn}T00:00:00Z`);
  const validDate=datePattern.test(bookedOn)&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===bookedOn;
  if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"payment amount must be a positive value with at most two decimals"});
  if(!new Set(["cash","bank_transfer"]).has(method))return res.status(400).json({error:"unsupported payment method"});
  if(!validDate)return res.status(400).json({error:"invalid booking date"});
  const client=await pool.connect();
  try{await client.query("begin");
    const sale=await client.query("select id,total,currency,settled from sales where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const total=Number(sale.rows[0].total);
    if(total<=0){const error=new Error("only sales with a positive total can receive payments");error.status=409;throw error}
    const paid=Number((await client.query("select coalesce(sum(amount),0)::numeric total from sale_payments where sale_id=$1",[req.params.id])).rows[0].total);
    const remaining=Math.max(total-paid,0);
    if(amount>remaining+0.0001){const error=new Error("payment exceeds the outstanding balance");error.status=409;throw error}
    const payment=await client.query("insert into sale_payments(sale_id,amount,method,booked_on,category,note,created_by) values($1,$2,$3,$4,'sales_income',$5,$6) returning *",[req.params.id,amount,method,bookedOn,note,req.user.username]);
    const paidTotal=paid+amount,settled=paidTotal>=total-0.0001;
    await client.query("update sales set settled=$1 where id=$2",[settled,req.params.id]);
    await client.query("commit");
    res.status(201).json({payment:payment.rows[0],paid_total:paidTotal,balance:Math.max(total-paidTotal,0),settled,currency:sale.rows[0].currency});
  }catch(error){await client.query("rollback");throw error}finally{client.release()}
}));
app.post("/api/sales", requirePermission("sales.create"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const settings=await getSystemSettings();
  const notes=String(body.notes||"").trim().slice(0,1000);
  const deliveryPhone=String(body.deliveryPhone||"").trim().slice(0,100),vehiclePlate=String(body.vehiclePlate||"").trim().slice(0,50),deliveryAddress=String(body.deliveryAddress||"").trim().slice(0,500);
  const currency=String(body.currency||settings.default_currency).toUpperCase(),customerId=body.customerId?Number(body.customerId):null;
  const {manualDiscountPercent,pricingMode}=salePricingOptions(body);
  const items=Array.isArray(body.items)?body.items.map(item=>({productId:Number(item.productId),quantity:Number(item.quantity)})):[];
  if(!currencies.has(currency))return res.status(400).json({error:"unsupported sale currency"});
  if(customerId!==null&&(!Number.isSafeInteger(customerId)||customerId<=0))return res.status(400).json({error:"invalid customer"});
  if(pricingMode==="last_customer"&&customerId===null)return res.status(400).json({error:"last-customer pricing requires a customer"});
  if(!items.length||items.length>200)return res.status(400).json({error:"sale must contain between 1 and 200 items"});
  if(items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity===0))return res.status(400).json({error:"sale contains an invalid item"});
  if(new Set(items.map(item=>item.productId)).size!==items.length)return res.status(400).json({error:"duplicate products are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const discountPercent=await customerDiscountForSale(client,customerId);
    const productRows=await client.query("select id,price,price_eur,price_usd,stock from products where id=any($1::bigint[]) and deleted_at is null for update",[items.map(item=>item.productId)]);
    if(productRows.rowCount!==items.length){const error=new Error("one or more products do not exist");error.status=400;throw error}
    const productById=new Map(productRows.rows.map(product=>[Number(product.id),product]));
    const previousPriceRows=pricingMode==="last_customer"?await lastCustomerSalePrices(client,customerId,currency,{productIds:items.map(item=>item.productId)}):[],previousPriceByProduct=new Map(previousPriceRows.map(row=>[Number(row.product_id),Number(row.price)]));
    const pricedItems=items.map(item=>{const product=productById.get(item.productId),originalPrice=salesPriceForCurrency(product,currency,settings),standardPrice=applySalesDiscount(originalPrice,currency,discountPercent),basePrice=previousPriceByProduct.get(item.productId)??standardPrice,price=applySalesDiscount(basePrice,currency,manualDiscountPercent),effectiveDiscountPercent=originalPrice===0?0:Number(((1-price/originalPrice)*100).toFixed(4));return {...item,originalPrice,effectiveDiscountPercent,price}});
    if(!settings.allow_overselling){const unavailable=pricedItems.find(item=>Number(productById.get(item.productId).stock)-item.quantity<0);if(unavailable){const error=new Error(`insufficient stock for product ${unavailable.productId}; overselling is disabled`);error.status=409;throw error}}
    const total=pricedItems.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const orderNo=await nextSalesOrderNumber(client,settings.sales_order_prefix);
    const order=await client.query("insert into sales(order_no,customer_id,total,status,created_by,notes,currency,delivery_phone,vehicle_plate,delivery_address,customer_discount_percent,manual_discount_percent,pricing_mode) values($1,$2,$3,'已完成',$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *",[orderNo,customerId,total,req.user.username,notes,currency,deliveryPhone,vehiclePlate,deliveryAddress,discountPercent,manualDiscountPercent,pricingMode]);
    for(const item of pricedItems){await client.query("insert into sale_items(sale_id,product_id,quantity,original_price,discount_percent,price) values($1,$2,$3,$4,$5,$6)",[order.rows[0].id,item.productId,item.quantity,item.originalPrice,item.effectiveDiscountPercent,item.price]);await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'sale',$4,$5)",[item.productId,settings.default_warehouse,-item.quantity,order.rows[0].order_no,req.user.username]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.put("/api/sales/:id", requirePermission("sales.edit"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const settings=await getSystemSettings();
  const notes=String(body.notes||"").trim().slice(0,1000);
  const deliveryPhone=String(body.deliveryPhone||"").trim().slice(0,100),vehiclePlate=String(body.vehiclePlate||"").trim().slice(0,50),deliveryAddress=String(body.deliveryAddress||"").trim().slice(0,500);
  const currency=String(body.currency||settings.default_currency).toUpperCase(),customerId=body.customerId?Number(body.customerId):null;
  const {manualDiscountPercent,pricingMode}=salePricingOptions(body);
  const items=Array.isArray(body.items)?body.items.map(item=>({productId:Number(item.productId),quantity:Number(item.quantity)})):[];
  if(!currencies.has(currency))return res.status(400).json({error:"unsupported sale currency"});
  if(customerId!==null&&(!Number.isSafeInteger(customerId)||customerId<=0))return res.status(400).json({error:"invalid customer"});
  if(pricingMode==="last_customer"&&customerId===null)return res.status(400).json({error:"last-customer pricing requires a customer"});
  if(!items.length||items.length>200)return res.status(400).json({error:"sale must contain between 1 and 200 items"});
  if(items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity===0))return res.status(400).json({error:"sale contains an invalid item"});
  if(new Set(items.map(item=>item.productId)).size!==items.length)return res.status(400).json({error:"duplicate products are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const settings=await getSystemSettings(client);
    const discountPercent=await customerDiscountForSale(client,customerId);
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const invoice=await client.query("select 1 from invoices where sale_id=$1 limit 1",[req.params.id]);
    if(invoice.rowCount){const error=new Error("sales with invoice records cannot be edited");error.status=409;throw error}
    const payments=await client.query("select 1 from sale_payments where sale_id=$1 limit 1",[req.params.id]);
    if(payments.rowCount){const error=new Error("sales with payment records cannot be edited");error.status=409;throw error}
    const returns=await client.query("select 1 from sale_returns where sale_id=$1 limit 1",[req.params.id]);
    if(returns.rowCount){const error=new Error("sales with legacy return records cannot be edited");error.status=409;throw error}
    const oldItems=await client.query("select product_id,quantity from sale_items where sale_id=$1 order by product_id for update",[req.params.id]);
    const productIds=[...new Set([...oldItems.rows.map(item=>Number(item.product_id)),...items.map(item=>item.productId)])].sort((a,b)=>a-b);
    const productRows=[];
    for(const productId of productIds){const product=await client.query("select id,price,price_eur,price_usd,stock from products where id=$1 and deleted_at is null for update",[productId]);if(!product.rowCount){const error=new Error(`product ${productId} does not exist`);error.status=400;throw error}productRows.push(product.rows[0])}
    const productById=new Map(productRows.map(product=>[Number(product.id),product]));
    const previousPriceRows=pricingMode==="last_customer"?await lastCustomerSalePrices(client,customerId,currency,{productIds:items.map(item=>item.productId),excludeSaleId:Number(req.params.id)}):[],previousPriceByProduct=new Map(previousPriceRows.map(row=>[Number(row.product_id),Number(row.price)]));
    const pricedItems=items.map(item=>{const product=productById.get(item.productId),originalPrice=salesPriceForCurrency(product,currency,settings),standardPrice=applySalesDiscount(originalPrice,currency,discountPercent),basePrice=previousPriceByProduct.get(item.productId)??standardPrice,price=applySalesDiscount(basePrice,currency,manualDiscountPercent),effectiveDiscountPercent=originalPrice===0?0:Number(((1-price/originalPrice)*100).toFixed(4));return {...item,originalPrice,effectiveDiscountPercent,price}});
    const total=pricedItems.reduce((sum,item)=>sum+item.quantity*item.price,0);
    if(sale.rows[0].stock_deducted){
      const stockChanges=new Map();
      oldItems.rows.forEach(item=>stockChanges.set(Number(item.product_id),(stockChanges.get(Number(item.product_id))||0)+Number(item.quantity)));
      pricedItems.forEach(item=>stockChanges.set(item.productId,(stockChanges.get(item.productId)||0)-item.quantity));
      for(const [productId,quantity] of [...stockChanges].sort((a,b)=>a[0]-b[0])){if(quantity===0)continue;const product=productById.get(productId);if(!settings.allow_overselling&&Number(product.stock)+quantity<0){const error=new Error(`insufficient stock for product ${productId}; overselling is disabled`);error.status=409;throw error}await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[quantity,productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'sale_edit',$4,$5)",[productId,settings.default_warehouse,quantity,sale.rows[0].order_no,req.user.username])}
    }
    await client.query("delete from sale_items where sale_id=$1",[req.params.id]);
    for(const item of pricedItems)await client.query("insert into sale_items(sale_id,product_id,quantity,original_price,discount_percent,price) values($1,$2,$3,$4,$5,$6)",[req.params.id,item.productId,item.quantity,item.originalPrice,item.effectiveDiscountPercent,item.price]);
    const updated=await client.query("update sales set customer_id=$1,total=$2,notes=$3,currency=$4,delivery_phone=$5,vehicle_plate=$6,delivery_address=$7,customer_discount_percent=$8,manual_discount_percent=$9,pricing_mode=$10 where id=$11 returning *",[customerId,total,notes,currency,deliveryPhone,vehiclePlate,deliveryAddress,discountPercent,manualDiscountPercent,pricingMode,req.params.id]);
    await client.query("commit");res.json(updated.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.delete("/api/sales/:id", requirePermission("sales.delete"), asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    if((await client.query("select 1 from invoices where sale_id=$1 limit 1",[req.params.id])).rowCount){const error=new Error("sales with ERP or Számlázz.hu invoice records cannot be deleted");error.status=409;throw error}
    if(sale.rows[0].stock_deducted){
      const settings=await getSystemSettings(client),lines=await client.query("select si.product_id,coalesce(sum(si.quantity),0)::int quantity,coalesce((select sum(sri.quantity) from sale_return_items sri join sale_returns sr on sr.id=sri.return_id join sale_items source on source.id=sri.sale_item_id where sr.sale_id=$1 and source.product_id=si.product_id),0)::int returned_quantity from sale_items si where si.sale_id=$1 group by si.product_id order by si.product_id",[req.params.id]);
      for(const line of lines.rows){const delta=Number(line.quantity)-Number(line.returned_quantity);if(delta===0)continue;await client.query("select id from products where id=$1 for update",[line.product_id]);await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[delta,line.product_id]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'sale_delete',$4,$5)",[line.product_id,settings.default_warehouse,delta,sale.rows[0].order_no,req.user.username])}
    }
    await client.query("update sales set deleted_at=now(),deleted_by=$1 where id=$2",[req.user.username,req.params.id]);
    await client.query("commit");res.json({id:Number(req.params.id)});
  }catch(error){await client.query("rollback").catch(()=>{});throw error}finally{client.release()}
}));

app.post("/api/sales/:id/returns", requirePermission("sales.edit"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const requested=Array.isArray(body.items)?body.items.map(item=>({saleItemId:Number(item.saleItemId),quantity:Number(item.quantity)})).filter(item=>item.quantity>0):[];
  if(!requested.length||requested.length>200) return res.status(400).json({error:"return must contain between 1 and 200 items"});
  if(requested.some(item=>!Number.isSafeInteger(item.saleItemId)||item.saleItemId<=0||!Number.isSafeInteger(item.quantity)||item.quantity<=0)) return res.status(400).json({error:"return contains an invalid item"});
  if(new Set(requested.map(item=>item.saleItemId)).size!==requested.length) return res.status(400).json({error:"duplicate return items are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const settings=await getSystemSettings(client);
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const saleItems=await client.query("select id,product_id,quantity,price from sale_items where sale_id=$1 for update",[req.params.id]);
    const returned=await client.query("select sri.sale_item_id,coalesce(sum(sri.quantity),0)::int quantity from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1 group by sri.sale_item_id",[req.params.id]);
    const returnedByItem=new Map(returned.rows.map(item=>[Number(item.sale_item_id),Number(item.quantity)]));
    const saleItemById=new Map(saleItems.rows.map(item=>[Number(item.id),item]));
    const items=requested.map(item=>{const sold=saleItemById.get(item.saleItemId);if(!sold){const error=new Error("return item does not belong to this sale");error.status=400;throw error}if((returnedByItem.get(item.saleItemId)||0)+item.quantity>Number(sold.quantity)){const error=new Error("return quantity exceeds the remaining sold quantity");error.status=409;throw error}return {...item,productId:Number(sold.product_id),price:Number(sold.price)}});
    const total=items.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const returnNo=body.returnNo||`Vr${Date.now()}`;
    const created=await client.query("insert into sale_returns(return_no,sale_id,total,reason,created_by) values($1,$2,$3,$4,$5) returning *",[returnNo,req.params.id,total,String(body.reason||"").trim(),req.user.username]);
    for(const item of items){await client.query("insert into sale_return_items(return_id,sale_item_id,product_id,quantity,price) values($1,$2,$3,$4,$5)",[created.rows[0].id,item.saleItemId,item.productId,item.quantity,item.price]);if(sale.rows[0].stock_deducted){await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'sale_return',$4,$5)",[item.productId,settings.default_warehouse,item.quantity,returnNo,req.user.username]);}}
    const totals=await client.query("select (select coalesce(sum(quantity),0) from sale_items where sale_id=$1)::int sold,(select coalesce(sum(sri.quantity),0) from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1)::int returned",[req.params.id]);
    await client.query("update sales set status=$1 where id=$2",[totals.rows[0].returned>=totals.rows[0].sold?"已退货":"部分退货",req.params.id]);
    await client.query("commit");res.status(201).json(created.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.patch("/api/sales/:id/notes", requirePermission("sales.edit"), asyncRoute(async (req,res)=>{
  const notes=String(req.body?.notes||"").trim().slice(0,1000);
  const result=await pool.query("update sales set notes=$1 where id=$2 and deleted_at is null returning *",[notes,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"sale not found"});
  res.json(result.rows[0]);
}));

app.patch("/api/sales/:id/status", requirePermission("sales.status"), asyncRoute(async (req,res)=>{
  const fields={stockDeducted:"stock_deducted",delivered:"delivered"};
  const changes=Object.entries(fields).filter(([key])=>typeof req.body?.[key]==="boolean");
  if(!changes.length)return res.status(400).json({error:"no valid status supplied"});
  const client=await pool.connect();
  try{await client.query("begin");
    const settings=await getSystemSettings(client);
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 and deleted_at is null for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const stockChange=changes.find(([key])=>key==="stockDeducted");
    if(stockChange&&req.body[stockChange[0]]!==sale.rows[0].stock_deducted){
      const lines=await client.query("select si.id,si.product_id,si.quantity,coalesce(sum(sri.quantity),0)::int returned_quantity from sale_items si left join sale_return_items sri on sri.sale_item_id=si.id where si.sale_id=$1 group by si.id order by si.product_id",[req.params.id]);
      const remainingByProduct=new Map();
      for(const line of lines.rows){const remaining=Number(line.quantity)-Number(line.returned_quantity);remainingByProduct.set(Number(line.product_id),(remainingByProduct.get(Number(line.product_id))||0)+remaining)}
      const deduct=req.body[stockChange[0]];
      for(const [productId,quantity] of [...remainingByProduct].sort((a,b)=>a[0]-b[0])){if(quantity===0)continue;const product=await client.query("select stock from products where id=$1 for update",[productId]);if(!product.rowCount){const error=new Error(`product ${productId} not found`);error.status=409;throw error}const delta=deduct?-quantity:quantity;if(!settings.allow_overselling&&Number(product.rows[0].stock)+delta<0){const error=new Error(`insufficient stock for product ${productId}; overselling is disabled`);error.status=409;throw error}await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[delta,productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,$4,$5,$6)",[productId,settings.default_warehouse,delta,deduct?"sale_status_deduct":"sale_status_restore",sale.rows[0].order_no,req.user.username]);}
    }
    const values=changes.map(([key])=>req.body[key]);
    const assignments=changes.map(([,column],index)=>`${column}=$${index+1}`);
    values.push(req.params.id);
    const result=await client.query(`update sales set ${assignments.join(",")} where id=$${values.length} returning *`,values);
    await client.query("commit");res.json(result.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

const reportQueryValues=req=>{
  const startDate=String(req.query.startDate||""),endDate=String(req.query.endDate||""),currency=String(req.query.currency||"HUF").toUpperCase();
  if(!validIsoDate(startDate)||!validIsoDate(endDate)||startDate>endDate||!currencies.has(currency)){const error=new Error("invalid report filters");error.status=400;throw error}
  return {startDate,endDate,currency};
};
const reportEntityIdValue=(value,label)=>{
  const text=String(value??"").trim();
  if(!text)return null;
  if(!/^[1-9]\d*$/.test(text)){const error=new Error(`invalid ${label} filter`);error.status=400;throw error}
  return text;
};
const reportDateValue=value=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime())){const parts=Object.fromEntries(new Intl.DateTimeFormat("en",{timeZone:businessTimezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`}
  return String(value||"").slice(0,10);
};

app.get("/api/reports/sales",requirePermission("page.reports"),asyncRoute(async(req,res)=>{
  const {startDate,endDate,currency}=reportQueryValues(req),salesperson=String(req.query.salesperson||"").trim(),customerId=reportEntityIdValue(req.query.customerId,"customer"),productId=reportEntityIdValue(req.query.productId,"product"),category=String(req.query.category||"").trim(),settlement=String(req.query.settlement||"").trim();
  if(settlement&&!new Set(["unpaid","partial","paid"]).has(settlement))return res.status(400).json({error:"invalid settlement filter"});
  const params=[businessTimezone,startDate,endDate,currency,salesperson||null,customerId,productId,category||null,settlement||null];
  const eventSql=`with sale_paid as (select sale_id,coalesce(sum(amount),0)::numeric paid from sale_payments group by sale_id),events as (
    select concat('sale:',si.id) row_key,(s.created_at at time zone $1)::date occurred_on,
      case when si.quantity<0 then 'negative_sale' else 'sale' end event_type,s.id sale_id,s.order_no reference_no,
      s.currency,s.created_by salesperson,s.customer_id,coalesce(c.name,'') customer,p.id product_id,p.sku,p.name product_name,p.category,
      si.quantity::int quantity,(si.quantity*si.price)::numeric amount,s.created_at
    from sale_items si join sales s on s.id=si.sale_id join products p on p.id=si.product_id left join customers c on c.id=s.customer_id left join sale_paid sp on sp.sale_id=s.id
    where s.deleted_at is null and s.created_at >= ($2::date at time zone $1) and s.created_at < (($3::date+1) at time zone $1)
      and s.currency=$4 and ($5::text is null or s.created_by=$5) and ($6::bigint is null or s.customer_id=$6)
      and ($7::bigint is null or p.id=$7) and ($8::text is null or p.category=$8)
      and ($9::text is null or case when coalesce(sp.paid,0)<=0 then 'unpaid' when coalesce(sp.paid,0)>=greatest(s.total,0) then 'paid' else 'partial' end=$9)
    union all
    select concat('return:',sri.id),(sr.created_at at time zone $1)::date,'sale_return',s.id,sr.return_no,
      s.currency,s.created_by,s.customer_id,coalesce(c.name,''),p.id,p.sku,p.name,p.category,
      -sri.quantity::int,(-sri.quantity*sri.price)::numeric,sr.created_at
    from sale_return_items sri join sale_returns sr on sr.id=sri.return_id join sales s on s.id=sr.sale_id join products p on p.id=sri.product_id left join customers c on c.id=s.customer_id left join sale_paid sp on sp.sale_id=s.id
    where s.deleted_at is null and sr.created_at >= ($2::date at time zone $1) and sr.created_at < (($3::date+1) at time zone $1)
      and s.currency=$4 and ($5::text is null or s.created_by=$5) and ($6::bigint is null or s.customer_id=$6)
      and ($7::bigint is null or p.id=$7) and ($8::text is null or p.category=$8)
      and ($9::text is null or case when coalesce(sp.paid,0)<=0 then 'unpaid' when coalesce(sp.paid,0)>=greatest(s.total,0) then 'paid' else 'partial' end=$9)
  ) select * from events order by occurred_on desc,created_at desc,row_key desc`;
  const [eventResult,settlementResult,salespeopleResult]=await Promise.all([
    pool.query(eventSql,params),
    pool.query(`with selected as (select s.id,s.total from sales s where s.deleted_at is null and s.created_at >= ($2::date at time zone $1) and s.created_at < (($3::date+1) at time zone $1) and s.currency=$4 and ($5::text is null or s.created_by=$5) and ($6::bigint is null or s.customer_id=$6) and ($7::bigint is null or exists(select 1 from sale_items si where si.sale_id=s.id and si.product_id=$7)) and ($8::text is null or exists(select 1 from sale_items si join products p on p.id=si.product_id where si.sale_id=s.id and p.category=$8)) and ($9::text is null or case when coalesce((select sum(sp.amount) from sale_payments sp where sp.sale_id=s.id),0)<=0 then 'unpaid' when coalesce((select sum(sp.amount) from sale_payments sp where sp.sale_id=s.id),0)>=greatest(s.total,0) then 'paid' else 'partial' end=$9)), paid as (select sp.sale_id,sum(sp.amount)::numeric amount from sale_payments sp join selected s on s.id=sp.sale_id group by sp.sale_id) select coalesce(sum(paid.amount),0)::numeric paid,coalesce(sum(greatest(selected.total-coalesce(paid.amount,0),0)),0)::numeric due from selected left join paid on paid.sale_id=selected.id`,params),
    pool.query("select distinct created_by from sales where deleted_at is null order by created_by")
  ]);
  const events=eventResult.rows,summary={grossSales:0,refundAmount:0,netSales:0,netQuantity:0,orderCount:0,returnCount:0,paid:Number(settlementResult.rows[0].paid),due:Number(settlementResult.rows[0].due),averageOrder:0},orders=new Set(),returns=new Set(),trend=new Map(),productsMap=new Map(),customersMap=new Map(),detailMap=new Map();
  for(const row of events){const occurredOn=reportDateValue(row.occurred_on),amount=Number(row.amount),quantity=Number(row.quantity),isReturn=amount<0;summary.netSales+=amount;summary.netQuantity+=quantity;if(isReturn){summary.refundAmount+=Math.abs(amount);returns.add(row.reference_no)}else{summary.grossSales+=amount;orders.add(row.sale_id)}const day=trend.get(occurredOn)||{date:occurredOn,amount:0,quantity:0};day.amount+=amount;day.quantity+=quantity;trend.set(occurredOn,day);const product=productsMap.get(row.product_id)||{id:Number(row.product_id),sku:row.sku,name:row.product_name,category:row.category,amount:0,quantity:0};product.amount+=amount;product.quantity+=quantity;productsMap.set(row.product_id,product);if(row.customer_id!==null&&row.customer_id!==undefined){const customer=customersMap.get(String(row.customer_id))||{id:row.customer_id,name:row.customer||"—",amount:0,quantity:0};customer.amount+=amount;customer.quantity+=quantity;customersMap.set(String(row.customer_id),customer)}const detailKey=`${row.event_type}:${row.reference_no}`,detail=detailMap.get(detailKey)||{id:detailKey,date:occurredOn,type:row.event_type,referenceNo:row.reference_no,saleId:Number(row.sale_id),customer:row.customer,salesperson:row.salesperson,amount:0,quantity:0};detail.amount+=amount;detail.quantity+=quantity;detailMap.set(detailKey,detail)}
  summary.orderCount=orders.size;summary.returnCount=returns.size;summary.averageOrder=summary.orderCount?summary.grossSales/summary.orderCount:0;
  const ranked=map=>[...map.values()].sort((a,b)=>b.amount-a.amount).slice(0,10);
  res.json({currency,summary,trend:[...trend.values()].sort((a,b)=>a.date.localeCompare(b.date)),products:ranked(productsMap),customers:ranked(customersMap),details:[...detailMap.values()].sort((a,b)=>b.date.localeCompare(a.date)),meta:{salespeople:salespeopleResult.rows.map(row=>row.created_by)}});
}));

app.get("/api/reports/finance",requirePermission("page.reports"),asyncRoute(async(req,res)=>{
  const {startDate,endDate,currency}=reportQueryValues(req),method=String(req.query.method||""),direction=String(req.query.direction||""),category=String(req.query.category||"");
  if(method&&!new Set(["cash","bank_transfer","unspecified"]).has(method)||direction&&!new Set(["income","expense"]).has(direction))return res.status(400).json({error:"invalid finance report filters"});
  const result=await pool.query(`with ledger as (
    select concat('sale_payment:',sp.id) row_key,sp.booked_on occurred_on,'income'::text direction,sp.category,sp.method payment_method,s.currency,sp.amount::numeric amount,s.order_no reference_no,coalesce(c.name,'') counterparty,sp.note,sp.created_by,'sale_payment'::text source_type
    from sale_payments sp join sales s on s.id=sp.sale_id left join customers c on c.id=s.customer_id where s.deleted_at is null
    union all select concat('sale_return:',sr.id),(sr.created_at at time zone $1)::date,'expense','sales_refund','unspecified',s.currency,abs(sr.total)::numeric,sr.return_no,coalesce(c.name,''),sr.reason,sr.created_by,'sale_return'
    from sale_returns sr join sales s on s.id=sr.sale_id left join customers c on c.id=s.customer_id where s.deleted_at is null and sr.total<>0
    union all select concat('negative_sale:',s.id),(s.created_at at time zone $1)::date,'expense','sales_refund','unspecified',s.currency,abs(s.total)::numeric,s.order_no,coalesce(c.name,''),s.notes,s.created_by,'negative_sale'
    from sales s left join customers c on c.id=s.customer_id where s.deleted_at is null and s.total<0
    union all select concat('manual:',ft.id),ft.occurred_on,ft.direction,ft.category,ft.payment_method,ft.currency,ft.amount::numeric,''::text,''::text,ft.note,ft.created_by,'manual'
    from finance_transactions ft
  ) select * from ledger where occurred_on between $2::date and $3::date and currency=$4 and ($5::text is null or payment_method=$5) and ($6::text is null or direction=$6) and ($7::text is null or category=$7) order by occurred_on desc,row_key desc`,[businessTimezone,startDate,endDate,currency,method||null,direction||null,category||null]);
  const rows=result.rows.map(row=>({...row,occurred_on:reportDateValue(row.occurred_on)})),summary={income:0,expense:0,net:0,cashIncome:0,cashExpense:0,cashNet:0,bankIncome:0,bankExpense:0,bankNet:0},trend=new Map(),categoryMap=new Map();
  for(const row of rows){const amount=Number(row.amount),income=row.direction==="income";summary[income?"income":"expense"]+=amount;if(row.payment_method==="cash")summary[income?"cashIncome":"cashExpense"]+=amount;if(row.payment_method==="bank_transfer")summary[income?"bankIncome":"bankExpense"]+=amount;const day=trend.get(row.occurred_on)||{date:row.occurred_on,income:0,expense:0,net:0};day[income?"income":"expense"]+=amount;trend.set(row.occurred_on,day);const item=categoryMap.get(row.category)||{category:row.category,income:0,expense:0,net:0};item[income?"income":"expense"]+=amount;categoryMap.set(row.category,item)}
  summary.net=summary.income-summary.expense;summary.cashNet=summary.cashIncome-summary.cashExpense;summary.bankNet=summary.bankIncome-summary.bankExpense;for(const row of trend.values())row.net=row.income-row.expense;for(const row of categoryMap.values())row.net=row.income-row.expense;
  res.json({currency,summary,trend:[...trend.values()].sort((a,b)=>a.date.localeCompare(b.date)),categories:[...categoryMap.values()].sort((a,b)=>(b.income+b.expense)-(a.income+a.expense)),details:rows});
}));

app.get("/api/reports/customers",requirePermission("page.reports"),asyncRoute(async(req,res)=>{
  const {startDate,endDate,currency}=reportQueryValues(req),customerId=reportEntityIdValue(req.query.customerId,"customer");
  const params=[businessTimezone,startDate,endDate,currency,customerId];
  const rows=await pool.query(`with selected_customers as (select * from customers c where c.deleted_at is null and ($5::bigint is null or c.id=$5)),orders as (
    select s.customer_id,count(*)::int order_count,coalesce(sum(s.total),0)::numeric gross_sales,coalesce(sum((select sum(si.quantity) from sale_items si where si.sale_id=s.id)),0)::int quantity
    from sales s join selected_customers c on c.id=s.customer_id where s.deleted_at is null and s.currency=$4 and s.created_at >= ($2::date at time zone $1) and s.created_at < (($3::date+1) at time zone $1) group by s.customer_id
  ),returns as (select s.customer_id,coalesce(sum(sr.total),0)::numeric refund_amount from sale_returns sr join sales s on s.id=sr.sale_id join selected_customers c on c.id=s.customer_id where s.deleted_at is null and s.currency=$4 and sr.created_at >= ($2::date at time zone $1) and sr.created_at < (($3::date+1) at time zone $1) group by s.customer_id),payments as (
    select s.customer_id,coalesce(sum(sp.amount),0)::numeric paid_amount from sale_payments sp join sales s on s.id=sp.sale_id join selected_customers c on c.id=s.customer_id where s.deleted_at is null and s.currency=$4 and sp.booked_on between $2::date and $3::date group by s.customer_id
  ),due as (select s.customer_id,coalesce(sum(greatest(s.total-coalesce((select sum(sp.amount) from sale_payments sp where sp.sale_id=s.id),0),0)),0)::numeric due_amount from sales s join selected_customers c on c.id=s.customer_id where s.deleted_at is null and s.currency=$4 and s.created_at >= ($2::date at time zone $1) and s.created_at < (($3::date+1) at time zone $1) group by s.customer_id),last_orders as (select customer_id,max(created_at) last_order_at from sales where deleted_at is null group by customer_id)
    select c.id,c.name,coalesce(g.name,c.customer_group,'') customer_group,c.city,c.country,c.created_at,(c.created_at at time zone $1)::date created_on,coalesce(o.order_count,0)::int order_count,coalesce(o.gross_sales,0)::numeric gross_sales,coalesce(r.refund_amount,0)::numeric refund_amount,(coalesce(o.gross_sales,0)-coalesce(r.refund_amount,0))::numeric net_sales,coalesce(o.quantity,0)::int quantity,coalesce(p.paid_amount,0)::numeric paid_amount,coalesce(d.due_amount,0)::numeric due_amount,l.last_order_at
    from selected_customers c left join customer_groups g on g.id=c.customer_group_id and g.deleted_at is null left join orders o on o.customer_id=c.id left join returns r on r.customer_id=c.id left join payments p on p.customer_id=c.id left join due d on d.customer_id=c.id left join last_orders l on l.customer_id=c.id
    where coalesce(o.order_count,0)>0 or coalesce(p.paid_amount,0)>0 or c.created_at >= ($2::date at time zone $1) and c.created_at < (($3::date+1) at time zone $1) order by net_sales desc,c.name`,params);
  const allCount=await pool.query("select count(*)::int count from customers where deleted_at is null and ($1::bigint is null or id=$1)",[customerId]);
  const data=rows.rows.map(row=>({...row,created_on:reportDateValue(row.created_on),order_count:Number(row.order_count),gross_sales:Number(row.gross_sales),refund_amount:Number(row.refund_amount),net_sales:Number(row.net_sales),quantity:Number(row.quantity),paid_amount:Number(row.paid_amount),due_amount:Number(row.due_amount)})),summary={totalCustomers:Number(allCount.rows[0].count),purchasingCustomers:data.filter(row=>row.order_count>0).length,newCustomers:data.filter(row=>row.created_on>=startDate&&row.created_on<=endDate).length,repeatCustomers:data.filter(row=>row.order_count>=2).length,netSales:data.reduce((sum,row)=>sum+row.net_sales,0),paid:data.reduce((sum,row)=>sum+row.paid_amount,0),due:data.reduce((sum,row)=>sum+row.due_amount,0)};
  res.json({currency,summary,customers:data});
}));

app.get("/api/reports/summary", requirePermission("page.reports"), asyncRoute(async (_req,res)=>{
  const [sales,returns,purchases,stock]=await Promise.all([
    pool.query("select coalesce(sum(total) filter(where currency='HUF'),0)::numeric total_huf,coalesce(sum(total) filter(where currency='EUR'),0)::numeric total_eur,coalesce(sum(total) filter(where currency='USD'),0)::numeric total_usd from sales where deleted_at is null"),
    pool.query("select coalesce(sum(sr.total) filter(where s.currency='HUF'),0)::numeric total_huf,coalesce(sum(sr.total) filter(where s.currency='EUR'),0)::numeric total_eur,coalesce(sum(sr.total) filter(where s.currency='USD'),0)::numeric total_usd from sale_returns sr join sales s on s.id=sr.sale_id where s.deleted_at is null"),
    pool.query("select coalesce(sum(total),0)::numeric total from purchases where deleted_at is null and status='已入库'"),
    pool.query("select coalesce(sum(stock),0)::int total from products where deleted_at is null"),
  ]);
  const result={purchase_total:purchases.rows[0].total,stock_total:stock.rows[0].total};
  for(const currency of ["huf","eur","usd"])result[`sales_total_${currency}`]=Number(sales.rows[0][`total_${currency}`])-Number(returns.rows[0][`total_${currency}`]);
  res.json(result);
}));

app.use((err,_req,res,_next)=>{console.error(err);if(err.code==="23505")return res.status(409).json({error:"记录已存在"});res.status(err.status||500).json({error:err.message||"server error"})});

async function start() {
  await mkdir(uploadDirectory,{recursive:true});
  await mkdir(invoiceDirectory,{recursive:true});
  await runMigrations(pool);
  await ensureAdminUser();
  app.listen(port,"0.0.0.0",()=>console.log(`ERP API listening on ${port}`));
}
start().catch(error=>{console.error("API startup failed",error);process.exit(1)});
