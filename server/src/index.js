import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
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
  const [products, customers, sales, purchases] = await Promise.all([
    pool.query("select count(*)::int count, coalesce(sum(stock),0)::int stock from products"),
    pool.query("select count(*)::int count from customers"),
    pool.query("select (select count(*) from sales where created_at::date=current_date)::int count, ((select coalesce(sum(total),0) from sales where created_at::date=current_date)-(select coalesce(sum(total),0) from sale_returns where created_at::date=current_date))::numeric total"),
    pool.query("select count(*)::int count, coalesce(sum(total),0)::numeric total from purchases where created_at::date=current_date")
  ]);
  res.json({ products: products.rows[0], customers: customers.rows[0], sales: sales.rows[0], purchases: purchases.rows[0] });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const q = `%${req.query.search || ""}%`;
  const result = await pool.query("select * from products where sku ilike $1 or barcode ilike $1 or name ilike $1 order by id desc limit 500", [q]);
  res.json(result.rows);
}));
app.post("/api/products", requireRole("admin","purchasing","warehouse"), asyncRoute(async (req, res) => {
  const b = req.body;
  const result = await pool.query("insert into products(sku,barcode,name,category,supplier,unit,box_size,cost,price,stock) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [b.sku,b.barcode,b.name,b.category,b.supplier||"",b.unit||"个",b.boxSize||1,b.cost||0,b.price||0,b.stock||0]);
  res.status(201).json(result.rows[0]);
}));
app.patch("/api/products/:id", requireRole("admin","purchasing","warehouse"), asyncRoute(async (req, res) => {
  const b=req.body;
  const result=await pool.query("update products set name=coalesce($1,name),category=coalesce($2,category),supplier=coalesce($3,supplier),cost=coalesce($4,cost),price=coalesce($5,price),updated_at=now() where id=$6 returning *",[b.name,b.category,b.supplier,b.cost,b.price,req.params.id]);
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

app.get("/api/sales", requireRole("admin","sales","finance"), asyncRoute(async (_req,res)=>res.json((await pool.query("select s.*,c.name customer,coalesce(sum(si.quantity),0)::int quantity from sales s left join customers c on c.id=s.customer_id left join sale_items si on si.sale_id=s.id group by s.id,c.name order by s.created_at desc limit 500")).rows)));
app.get("/api/sales/:id", requireRole("admin","sales","finance"), asyncRoute(async (req,res)=>{
  const sale=await pool.query("select s.*,c.name customer,coalesce((select sum(sr.total) from sale_returns sr where sr.sale_id=s.id),0) returned_total from sales s left join customers c on c.id=s.customer_id where s.id=$1",[req.params.id]);
  if(!sale.rowCount)return res.status(404).json({error:"sale not found"});
  const [items,returns]=await Promise.all([
    pool.query("select si.id,si.product_id,si.quantity,si.price,p.sku,p.name,coalesce(sum(sri.quantity),0)::int returned_quantity from sale_items si join products p on p.id=si.product_id left join sale_return_items sri on sri.sale_item_id=si.id where si.sale_id=$1 group by si.id,p.sku,p.name order by si.id",[req.params.id]),
    pool.query("select id,return_no,total,reason,created_by,created_at from sale_returns where sale_id=$1 order by created_at desc,id desc",[req.params.id]),
  ]);
  res.json({...sale.rows[0],items:items.rows,returns:returns.rows});
}));
app.post("/api/sales", requireRole("admin","sales"), asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{await client.query("begin");const b=req.body;
    const order=await client.query("insert into sales(order_no,customer_id,total,status,created_by) values($1,$2,$3,'已完成',$4) returning *",[b.orderNo||`Vs${Date.now()}`,b.customerId||null,b.total||0,req.user.username]);
    for(const item of b.items||[]){const locked=await client.query("select stock from products where id=$1 for update",[item.productId]);if(!locked.rowCount||locked.rows[0].stock<item.quantity)throw new Error(`商品 ${item.productId} 库存不足`);await client.query("insert into sale_items(sale_id,product_id,quantity,price) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.price]);await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,'sale',$3,$4)",[item.productId,-item.quantity,order.rows[0].order_no,req.user.username]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
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
    const sale=await client.query("select id,order_no from sales where id=$1 for update",[req.params.id]);
    if(!sale.rowCount){const error=new Error("sale not found");error.status=404;throw error}
    const saleItems=await client.query("select id,product_id,quantity,price from sale_items where sale_id=$1 for update",[req.params.id]);
    const returned=await client.query("select sri.sale_item_id,coalesce(sum(sri.quantity),0)::int quantity from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1 group by sri.sale_item_id",[req.params.id]);
    const returnedByItem=new Map(returned.rows.map(item=>[Number(item.sale_item_id),Number(item.quantity)]));
    const saleItemById=new Map(saleItems.rows.map(item=>[Number(item.id),item]));
    const items=requested.map(item=>{const sold=saleItemById.get(item.saleItemId);if(!sold){const error=new Error("return item does not belong to this sale");error.status=400;throw error}if((returnedByItem.get(item.saleItemId)||0)+item.quantity>Number(sold.quantity)){const error=new Error("return quantity exceeds the remaining sold quantity");error.status=409;throw error}return {...item,productId:Number(sold.product_id),price:Number(sold.price)}});
    const total=items.reduce((sum,item)=>sum+item.quantity*item.price,0);
    const returnNo=body.returnNo||`Vr${Date.now()}`;
    const created=await client.query("insert into sale_returns(return_no,sale_id,total,reason,created_by) values($1,$2,$3,$4,$5) returning *",[returnNo,req.params.id,total,String(body.reason||"").trim(),req.user.username]);
    for(const item of items){await client.query("insert into sale_return_items(return_id,sale_item_id,product_id,quantity,price) values($1,$2,$3,$4,$5)",[created.rows[0].id,item.saleItemId,item.productId,item.quantity,item.price]);await client.query("update products set stock=stock+$1,updated_at=now() where id=$2",[item.quantity,item.productId]);await client.query("insert into inventory_movements(product_id,warehouse,quantity,movement_type,reference_no,created_by) values($1,'主仓库',$2,'sale_return',$3,$4)",[item.productId,item.quantity,returnNo,req.user.username]);}
    const totals=await client.query("select (select coalesce(sum(quantity),0) from sale_items where sale_id=$1)::int sold,(select coalesce(sum(sri.quantity),0) from sale_return_items sri join sale_returns sr on sr.id=sri.return_id where sr.sale_id=$1)::int returned",[req.params.id]);
    await client.query("update sales set status=$1 where id=$2",[totals.rows[0].returned>=totals.rows[0].sold?"已退货":"部分退货",req.params.id]);
    await client.query("commit");res.status(201).json(created.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.get("/api/reports/summary", requireRole("admin","finance"), asyncRoute(async (_req,res)=>{
  const result=await pool.query("select ((select coalesce(sum(total),0) from sales)-(select coalesce(sum(total),0) from sale_returns)) sales_total,(select coalesce(sum(total),0) from purchases) purchase_total,(select coalesce(sum(stock),0) from products) stock_total");
  res.json(result.rows[0]);
}));

app.use((err,_req,res,_next)=>{console.error(err);if(err.code==="23505")return res.status(409).json({error:"记录已存在"});res.status(err.status||500).json({error:err.message||"server error"})});

async function start() {
  await runMigrations(pool);
  await ensureAdminUser();
  app.listen(port,"0.0.0.0",()=>console.log(`ERP API listening on ${port}`));
}
start().catch(error=>{console.error("API startup failed",error);process.exit(1)});
