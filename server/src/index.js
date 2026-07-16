import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const businessTimezone = process.env.BUSINESS_TIMEZONE || "Europe/Budapest";
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

const scrypt = promisify(crypto.scrypt);
const roles = new Set(["admin", "purchasing", "warehouse", "sales", "finance"]);
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
  req.user = result.rows[0]; next();
};
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireRole = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "forbidden" });

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
  res.json({ token: sign({ sub: user.username, role: user.role }), user: { id:user.id,username:user.username,displayName:user.display_name,role:user.role } });
}));

app.use("/api", asyncRoute(auth));

app.get("/api/auth/me", (req,res)=>res.json({ user: { id:req.user.id,username:req.user.username,displayName:req.user.display_name,role:req.user.role } }));

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

app.get("/api/dashboard", asyncRoute(async (_req, res) => {
  const [products, customers, sales, returns, purchases] = await Promise.all([
    pool.query("select count(*)::int count, coalesce(sum(stock),0)::int stock from products"),
    pool.query("select count(*)::int count from customers"),
    pool.query("select count(*)::int count,coalesce(sum(total) filter(where currency='HUF'),0)::numeric total_huf,coalesce(sum(total) filter(where currency='EUR'),0)::numeric total_eur,coalesce(sum(total) filter(where currency='USD'),0)::numeric total_usd from sales where created_at::date=current_date"),
    pool.query("select coalesce(sum(sr.total) filter(where s.currency='HUF'),0)::numeric total_huf,coalesce(sum(sr.total) filter(where s.currency='EUR'),0)::numeric total_eur,coalesce(sum(sr.total) filter(where s.currency='USD'),0)::numeric total_usd from sale_returns sr join sales s on s.id=sr.sale_id where sr.created_at::date=current_date"),
    pool.query("select count(*)::int count, coalesce(sum(total),0)::numeric total from purchases where created_at::date=current_date")
  ]);
  const saleTotals={...sales.rows[0]};
  for(const currency of ["huf","eur","usd"])saleTotals[`total_${currency}`]=Number(saleTotals[`total_${currency}`])-Number(returns.rows[0][`total_${currency}`]);
  res.json({ products: products.rows[0], customers: customers.rows[0], sales: saleTotals, purchases: purchases.rows[0] });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const q = `%${req.query.search || ""}%`;
  const result = await pool.query("select * from products where sku ilike $1 or barcode ilike $1 or name ilike $1 order by id desc limit 500", [q]);
  res.json(result.rows);
}));
app.get("/api/products/:id", asyncRoute(async (req,res)=>{
  const product=await pool.query("select * from products where id=$1",[req.params.id]);
  if(!product.rowCount)return res.status(404).json({error:"product not found"});
  const movements=await pool.query("select id,warehouse,quantity,movement_type,reference_no,created_by,created_at from inventory_movements where product_id=$1 order by created_at desc,id desc limit 20",[req.params.id]);
  res.json({...product.rows[0],movements:movements.rows});
}));
app.post("/api/products", requireRole("admin","purchasing","warehouse"), asyncRoute(async (req, res) => {
  const b=req.body||{},sku=String(b.sku||"").trim(),name=String(b.name||"").trim(),boxSize=Number(b.boxSize??1),cost=Number(b.cost??0),priceHuf=Number(b.priceHuf??b.price??0),priceEur=Number(b.priceEur??0),priceUsd=Number(b.priceUsd??0);
  if(!sku||!name||!Number.isSafeInteger(boxSize)||boxSize<=0||[cost,priceHuf,priceEur,priceUsd].some(value=>!Number.isFinite(value)||value<0))return res.status(400).json({error:"invalid product data"});
  const result = await pool.query("insert into products(sku,barcode,name,category,supplier,unit,box_size,cost,price,price_eur,price_usd,stock) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0) returning *", [sku,String(b.barcode||"").trim(),name,String(b.category||"").trim(),String(b.supplier||"").trim(),String(b.unit||"个").trim()||"个",boxSize,cost,priceHuf,priceEur,priceUsd]);
  res.status(201).json(result.rows[0]);
}));
app.patch("/api/products/:id", requireRole("admin","purchasing","warehouse"), asyncRoute(async (req, res) => {
  const b=req.body||{};
  const sku=b.sku===undefined?null:String(b.sku).trim(),name=b.name===undefined?null:String(b.name).trim(),unit=b.unit===undefined?null:String(b.unit).trim(),boxSize=b.boxSize===undefined?null:Number(b.boxSize),cost=b.cost===undefined?null:Number(b.cost),priceHuf=b.priceHuf===undefined&&b.price===undefined?null:Number(b.priceHuf??b.price),priceEur=b.priceEur===undefined?null:Number(b.priceEur),priceUsd=b.priceUsd===undefined?null:Number(b.priceUsd);
  if(sku===""||name===""||unit===""||(boxSize!==null&&(!Number.isSafeInteger(boxSize)||boxSize<=0))||[cost,priceHuf,priceEur,priceUsd].some(value=>value!==null&&(!Number.isFinite(value)||value<0)))return res.status(400).json({error:"invalid product data"});
  const result=await pool.query("update products set sku=coalesce($1,sku),barcode=coalesce($2,barcode),name=coalesce($3,name),category=coalesce($4,category),supplier=coalesce($5,supplier),unit=coalesce($6,unit),box_size=coalesce($7,box_size),cost=coalesce($8,cost),price=coalesce($9,price),price_eur=coalesce($10,price_eur),price_usd=coalesce($11,price_usd),updated_at=now() where id=$12 returning *",[sku,b.barcode===undefined?null:String(b.barcode).trim(),name,b.category===undefined?null:String(b.category).trim(),b.supplier===undefined?null:String(b.supplier).trim(),unit,boxSize,cost,priceHuf,priceEur,priceUsd,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:"product not found"});
  res.json(result.rows[0]);
}));
app.get("/api/i18n/locales", asyncRoute(async (_req,res)=>{
  res.json((await pool.query("select locale,display_name,is_default from supported_locales where enabled=true order by is_default desc,locale")).rows);
}));
app.put("/api/products/:id/translations/:locale", requireRole("admin","purchasing"), asyncRoute(async (req,res)=>{
  const result=await pool.query("insert into product_translations(product_id,locale,name,description) values($1,$2,$3,$4) on conflict(product_id,locale) do update set name=excluded.name,description=excluded.description returning *",[req.params.id,req.params.locale,req.body.name,req.body.description||""]);
  res.json(result.rows[0]);
}));

app.get("/api/customers", requireRole("admin","sales","finance"), asyncRoute(async (req, res) => {
  const q=`%${req.query.search||""}%`;
  const result=await pool.query("select * from customers where name ilike $1 or phone ilike $1 or city ilike $1 order by id desc limit 500",[q]);
  res.json(result.rows);
}));
app.post("/api/customers", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const b=req.body;
  const result=await pool.query("insert into customers(name,phone,city,address,customer_group) values($1,$2,$3,$4,$5) returning *",[b.name,b.phone||"",b.city||"",b.address||"",b.group||"零售"]);
  res.status(201).json(result.rows[0]);
}));

app.get("/api/purchases", requireRole("admin","purchasing","warehouse","finance"), asyncRoute(async (_req,res)=>res.json((await pool.query("select p.*,coalesce(sum(pi.quantity),0)::int quantity from purchases p left join purchase_items pi on pi.purchase_id=p.id group by p.id order by p.created_at desc limit 500")).rows)));
app.post("/api/purchases", requireRole("admin","purchasing","warehouse"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const supplier=String(body.supplier||"").trim();
  const warehouse=String(body.warehouse||"主仓库").trim();
  const items=Array.isArray(body.items)?body.items.map(item=>({productId:Number(item.productId),quantity:Number(item.quantity),cost:Number(item.cost)})):[];
  if(!supplier) return res.status(400).json({error:"supplier is required"});
  if(!warehouse) return res.status(400).json({error:"warehouse is required"});
  if(!items.length||items.length>200) return res.status(400).json({error:"purchase must contain between 1 and 200 items"});
  if(items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity<=0||!Number.isFinite(item.cost)||item.cost<0)) return res.status(400).json({error:"purchase contains an invalid item"});
  if(new Set(items.map(item=>item.productId)).size!==items.length) return res.status(400).json({error:"duplicate products are not allowed"});
  const total=items.reduce((sum,item)=>sum+item.quantity*item.cost,0);
  const client=await pool.connect();
  try{await client.query("begin");
    const productIds=items.map(item=>item.productId);
    const products=await client.query("select id from products where id=any($1::bigint[]) for update",[productIds]);
    if(products.rowCount!==items.length){const error=new Error("one or more products do not exist");error.status=400;throw error}
    const order=await client.query("insert into purchases(order_no,supplier,warehouse,total,status) values($1,$2,$3,$4,$5) returning *",[body.orderNo||`Vin${Date.now()}`,supplier,warehouse,total,"已入库"]);
    for(const item of items){await client.query("insert into purchase_items(purchase_id,product_id,quantity,cost) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.cost]);await client.query("update products set stock=stock+$1,cost=$2,updated_at=now() where id=$3",[item.quantity,item.cost,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,$2,$3,'purchase',$4,$5)",[item.productId,warehouse,item.quantity,order.rows[0].order_no,req.user.username]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.get("/api/sales", requireRole("admin","sales","finance"), asyncRoute(async (req,res)=>{
  const startDate=String(req.query.startDate||"");
  const endDate=String(req.query.endDate||"");
  const datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const validDate=value=>datePattern.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  if((startDate&&!validDate(startDate))||(endDate&&!validDate(endDate)))return res.status(400).json({error:"invalid date range"});
  if(startDate&&endDate&&startDate>endDate)return res.status(400).json({error:"start date must not be after end date"});
  const params=startDate||endDate?[businessTimezone]:[],filters=[];
  if(startDate){params.push(startDate);filters.push(`s.created_at >= ($${params.length}::date at time zone $1)`)}
  if(endDate){params.push(endDate);filters.push(`s.created_at < (($${params.length}::date + 1) at time zone $1)`)}
  const where=filters.length?` where ${filters.join(" and ")}`:"";
  const limit=filters.length?"":" limit 500";
  const result=await pool.query(`select s.*,c.name customer,(select count(*)::int from sale_items si where si.sale_id=s.id) item_count,(select coalesce(sum(si.quantity),0)::int from sale_items si where si.sale_id=s.id) quantity,(select coalesce(sum(sp.amount),0)::numeric from sale_payments sp where sp.sale_id=s.id) paid_total from sales s left join customers c on c.id=s.customer_id${where} order by s.created_at desc${limit}`,params);
  res.json(result.rows);
}));
app.get("/api/sales/:id", requireRole("admin","sales","finance"), asyncRoute(async (req,res)=>{
  const sale=await pool.query("select s.*,c.name customer,c.phone customer_phone,c.city customer_city,c.address customer_address from sales s left join customers c on c.id=s.customer_id where s.id=$1",[req.params.id]);
  if(!sale.rowCount)return res.status(404).json({error:"sale not found"});
  const items=await pool.query("select si.id,si.product_id,si.quantity,si.price,p.sku,p.barcode,p.name,p.stock from sale_items si join products p on p.id=si.product_id where si.sale_id=$1 order by si.id",[req.params.id]);
  const payments=await pool.query("select id,amount,method,booked_on,category,note,created_by,created_at from sale_payments where sale_id=$1 order by created_at desc,id desc",[req.params.id]);
  const paidTotal=payments.rows.reduce((sum,payment)=>sum+Number(payment.amount),0);
  res.json({...sale.rows[0],paid_total:paidTotal,balance:Math.max(Number(sale.rows[0].total)-paidTotal,0),items:items.rows,payments:payments.rows});
}));

app.post("/api/sales/:id/payments", requireRole("admin","sales","finance"), asyncRoute(async (req,res)=>{
  const body=req.body||{},amountText=String(body.amount??""),amount=Number(body.amount),method=String(body.method||""),bookedOn=String(body.bookedOn||""),note=String(body.note||"").trim().slice(0,1000);
  const datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const parsedDate=new Date(`${bookedOn}T00:00:00Z`);
  const validDate=datePattern.test(bookedOn)&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===bookedOn;
  if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"payment amount must be a positive value with at most two decimals"});
  if(!new Set(["cash","bank_transfer"]).has(method))return res.status(400).json({error:"unsupported payment method"});
  if(!validDate)return res.status(400).json({error:"invalid booking date"});
  const client=await pool.connect();
  try{await client.query("begin");
    const sale=await client.query("select id,total,currency,settled from sales where id=$1 for update",[req.params.id]);
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
app.post("/api/sales", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const notes=String(body.notes||"").trim().slice(0,1000);
  const deliveryPhone=String(body.deliveryPhone||"").trim().slice(0,100),vehiclePlate=String(body.vehiclePlate||"").trim().slice(0,50),deliveryAddress=String(body.deliveryAddress||"").trim().slice(0,500);
  const currency=String(body.currency||"HUF").toUpperCase();
  const currencies=new Set(["HUF","EUR","USD"]);
  const items=Array.isArray(body.items)?body.items.map(item=>({productId:Number(item.productId),quantity:Number(item.quantity)})):[];
  if(!currencies.has(currency))return res.status(400).json({error:"unsupported sale currency"});
  if(!items.length||items.length>200)return res.status(400).json({error:"sale must contain between 1 and 200 items"});
  if(items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity===0))return res.status(400).json({error:"sale contains an invalid item"});
  if(new Set(items.map(item=>item.productId)).size!==items.length)return res.status(400).json({error:"duplicate products are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const productRows=await client.query("select id,price,price_eur,price_usd from products where id=any($1::bigint[]) for update",[items.map(item=>item.productId)]);
    if(productRows.rowCount!==items.length){const error=new Error("one or more products do not exist");error.status=400;throw error}
    const productById=new Map(productRows.rows.map(product=>[Number(product.id),product]));
    const priceColumn={HUF:"price",EUR:"price_eur",USD:"price_usd"}[currency];
    const pricedItems=items.map(item=>({...item,price:Number(productById.get(item.productId)[priceColumn])}));
    const total=pricedItems.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const order=await client.query("insert into sales(order_no,customer_id,total,status,created_by,notes,currency,delivery_phone,vehicle_plate,delivery_address) values($1,$2,$3,'已完成',$4,$5,$6,$7,$8,$9) returning *",[body.orderNo||`Vs${Date.now()}`,body.customerId||null,total,req.user.username,notes,currency,deliveryPhone,vehiclePlate,deliveryAddress]);
    for(const item of pricedItems){await client.query("insert into sale_items(sale_id,product_id,quantity,price) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.price]);await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,'sale',$3,$4)",[item.productId,-item.quantity,order.rows[0].order_no,req.user.username]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.put("/api/sales/:id", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const notes=String(body.notes||"").trim().slice(0,1000);
  const deliveryPhone=String(body.deliveryPhone||"").trim().slice(0,100),vehiclePlate=String(body.vehiclePlate||"").trim().slice(0,50),deliveryAddress=String(body.deliveryAddress||"").trim().slice(0,500);
  const currency=String(body.currency||"HUF").toUpperCase();
  const currencies=new Set(["HUF","EUR","USD"]);
  const items=Array.isArray(body.items)?body.items.map(item=>({productId:Number(item.productId),quantity:Number(item.quantity)})):[];
  if(!currencies.has(currency))return res.status(400).json({error:"unsupported sale currency"});
  if(!items.length||items.length>200)return res.status(400).json({error:"sale must contain between 1 and 200 items"});
  if(items.some(item=>!Number.isSafeInteger(item.productId)||item.productId<=0||!Number.isSafeInteger(item.quantity)||item.quantity===0))return res.status(400).json({error:"sale contains an invalid item"});
  if(new Set(items.map(item=>item.productId)).size!==items.length)return res.status(400).json({error:"duplicate products are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const payments=await client.query("select 1 from sale_payments where sale_id=$1 limit 1",[req.params.id]);
    if(payments.rowCount){const error=new Error("sales with payment records cannot be edited");error.status=409;throw error}
    const returns=await client.query("select 1 from sale_returns where sale_id=$1 limit 1",[req.params.id]);
    if(returns.rowCount){const error=new Error("sales with legacy return records cannot be edited");error.status=409;throw error}
    const oldItems=await client.query("select product_id,quantity from sale_items where sale_id=$1 order by product_id for update",[req.params.id]);
    const productIds=[...new Set([...oldItems.rows.map(item=>Number(item.product_id)),...items.map(item=>item.productId)])].sort((a,b)=>a-b);
    const productRows=[];
    for(const productId of productIds){const product=await client.query("select id,price,price_eur,price_usd from products where id=$1 for update",[productId]);if(!product.rowCount){const error=new Error(`product ${productId} does not exist`);error.status=400;throw error}productRows.push(product.rows[0])}
    const productById=new Map(productRows.map(product=>[Number(product.id),product]));
    const priceColumn={HUF:"price",EUR:"price_eur",USD:"price_usd"}[currency];
    const pricedItems=items.map(item=>({...item,price:Number(productById.get(item.productId)[priceColumn])}));
    const total=pricedItems.reduce((sum,item)=>sum+item.quantity*item.price,0);
    if(sale.rows[0].stock_deducted){
      const stockChanges=new Map();
      oldItems.rows.forEach(item=>stockChanges.set(Number(item.product_id),(stockChanges.get(Number(item.product_id))||0)+Number(item.quantity)));
      pricedItems.forEach(item=>stockChanges.set(item.productId,(stockChanges.get(item.productId)||0)-item.quantity));
      for(const [productId,quantity] of [...stockChanges].sort((a,b)=>a[0]-b[0])){if(quantity===0)continue;await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[quantity,productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,'sale_edit',$3,$4)",[productId,quantity,sale.rows[0].order_no,req.user.username])}
    }
    await client.query("delete from sale_items where sale_id=$1",[req.params.id]);
    for(const item of pricedItems)await client.query("insert into sale_items(sale_id,product_id,quantity,price) values($1,$2,$3,$4)",[req.params.id,item.productId,item.quantity,item.price]);
    const updated=await client.query("update sales set customer_id=$1,total=$2,notes=$3,currency=$4,delivery_phone=$5,vehicle_plate=$6,delivery_address=$7 where id=$8 returning *",[body.customerId||null,total,notes,currency,deliveryPhone,vehiclePlate,deliveryAddress,req.params.id]);
    await client.query("commit");res.json(updated.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.post("/api/sales/:id/returns", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const body=req.body||{};
  const requested=Array.isArray(body.items)?body.items.map(item=>({saleItemId:Number(item.saleItemId),quantity:Number(item.quantity)})).filter(item=>item.quantity>0):[];
  if(!requested.length||requested.length>200) return res.status(400).json({error:"return must contain between 1 and 200 items"});
  if(requested.some(item=>!Number.isSafeInteger(item.saleItemId)||item.saleItemId<=0||!Number.isSafeInteger(item.quantity)||item.quantity<=0)) return res.status(400).json({error:"return contains an invalid item"});
  if(new Set(requested.map(item=>item.saleItemId)).size!==requested.length) return res.status(400).json({error:"duplicate return items are not allowed"});
  const client=await pool.connect();
  try{await client.query("begin");
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const saleItems=await client.query("select id,product_id,quantity,price from sale_items where sale_id=$1 for update",[req.params.id]);
    const returned=await client.query("select sri.sale_item_id,coalesce(sum(sri.quantity),0)::int quantity from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1 group by sri.sale_item_id",[req.params.id]);
    const returnedByItem=new Map(returned.rows.map(item=>[Number(item.sale_item_id),Number(item.quantity)]));
    const saleItemById=new Map(saleItems.rows.map(item=>[Number(item.id),item]));
    const items=requested.map(item=>{const sold=saleItemById.get(item.saleItemId);if(!sold){const error=new Error("return item does not belong to this sale");error.status=400;throw error}if((returnedByItem.get(item.saleItemId)||0)+item.quantity>Number(sold.quantity)){const error=new Error("return quantity exceeds the remaining sold quantity");error.status=409;throw error}return {...item,productId:Number(sold.product_id),price:Number(sold.price)}});
    const total=items.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const returnNo=body.returnNo||`Vr${Date.now()}`;
    const created=await client.query("insert into sale_returns(return_no,sale_id,total,reason,created_by) values($1,$2,$3,$4,$5) returning *",[returnNo,req.params.id,total,String(body.reason||"").trim(),req.user.username]);
    for(const item of items){await client.query("insert into sale_return_items(return_id,sale_item_id,product_id,quantity,price) values($1,$2,$3,$4,$5)",[created.rows[0].id,item.saleItemId,item.productId,item.quantity,item.price]);if(sale.rows[0].stock_deducted){await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,'sale_return',$3,$4)",[item.productId,item.quantity,returnNo,req.user.username]);}}
    const totals=await client.query("select (select coalesce(sum(quantity),0) from sale_items where sale_id=$1)::int sold,(select coalesce(sum(sri.quantity),0) from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1)::int returned",[req.params.id]);
    await client.query("update sales set status=$1 where id=$2",[totals.rows[0].returned>=totals.rows[0].sold?"已退货":"部分退货",req.params.id]);
    await client.query("commit");res.status(201).json(created.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.patch("/api/sales/:id/status", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const fields={stockDeducted:"stock_deducted",delivered:"delivered"};
  const changes=Object.entries(fields).filter(([key])=>typeof req.body?.[key]==="boolean");
  if(!changes.length)return res.status(400).json({error:"no valid status supplied"});
  const client=await pool.connect();
  try{await client.query("begin");
    const sale=await client.query("select id,order_no,stock_deducted from sales where id=$1 for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const stockChange=changes.find(([key])=>key==="stockDeducted");
    if(stockChange&&req.body[stockChange[0]]!==sale.rows[0].stock_deducted){
      const lines=await client.query("select si.id,si.product_id,si.quantity,coalesce(sum(sri.quantity),0)::int returned_quantity from sale_items si left join sale_return_items sri on sri.sale_item_id=si.id where si.sale_id=$1 group by si.id order by si.product_id",[req.params.id]);
      const remainingByProduct=new Map();
      for(const line of lines.rows){const remaining=Number(line.quantity)-Number(line.returned_quantity);remainingByProduct.set(Number(line.product_id),(remainingByProduct.get(Number(line.product_id))||0)+remaining)}
      const deduct=req.body[stockChange[0]];
      for(const [productId,quantity] of [...remainingByProduct].sort((a,b)=>a[0]-b[0])){if(quantity===0)continue;const product=await client.query("select stock from products where id=$1 for update",[productId]);if(!product.rowCount){const error=new Error(`product ${productId} not found`);error.status=409;throw error}const delta=deduct?-quantity:quantity;await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[delta,productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,$3,$4,$5)",[productId,delta,deduct?"sale_status_deduct":"sale_status_restore",sale.rows[0].order_no,req.user.username]);}
    }
    const values=changes.map(([key])=>req.body[key]);
    const assignments=changes.map(([,column],index)=>`${column}=$${index+1}`);
    values.push(req.params.id);
    const result=await client.query(`update sales set ${assignments.join(",")} where id=$${values.length} returning *`,values);
    await client.query("commit");res.json(result.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.get("/api/reports/summary", requireRole("admin","finance"), asyncRoute(async (_req,res)=>{
  const [sales,returns,purchases,stock]=await Promise.all([
    pool.query("select coalesce(sum(total) filter(where currency='HUF'),0)::numeric total_huf,coalesce(sum(total) filter(where currency='EUR'),0)::numeric total_eur,coalesce(sum(total) filter(where currency='USD'),0)::numeric total_usd from sales"),
    pool.query("select coalesce(sum(sr.total) filter(where s.currency='HUF'),0)::numeric total_huf,coalesce(sum(sr.total) filter(where s.currency='EUR'),0)::numeric total_eur,coalesce(sum(sr.total) filter(where s.currency='USD'),0)::numeric total_usd from sale_returns sr join sales s on s.id=sr.sale_id"),
    pool.query("select coalesce(sum(total),0)::numeric total from purchases"),
    pool.query("select coalesce(sum(stock),0)::int total from products"),
  ]);
  const result={purchase_total:purchases.rows[0].total,stock_total:stock.rows[0].total};
  for(const currency of ["huf","eur","usd"])result[`sales_total_${currency}`]=Number(sales.rows[0][`total_${currency}`])-Number(returns.rows[0][`total_${currency}`]);
  res.json(result);
}));

app.use((err,_req,res,_next)=>{console.error(err);if(err.code==="23505")return res.status(409).json({error:"记录已存在"});res.status(err.status||500).json({error:err.message||"server error"})});

async function start() {
  await runMigrations(pool);
  await ensureAdminUser();
  app.listen(port,"0.0.0.0",()=>console.log(`ERP API listening on ${port}`));
}
start().catch(error=>{console.error("API startup failed",error);process.exit(1)});
