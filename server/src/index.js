import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.JWT_SECRET || "change-this-secret";
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "erp",
  password: process.env.PGPASSWORD || "erp",
  database: process.env.PGDATABASE || "erp",
});

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "2mb" }));

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
};
const verify = (token = "") => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp > Date.now() ? payload : null;
};
const auth = (req, res, next) => {
  const payload = verify(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  req.user = payload; next();
};
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", asyncRoute(async (_req, res) => {
  const db = await pool.query("select now() as now");
  res.json({ ok: true, database: db.rows[0].now });
}));

app.post("/api/auth/login", (req, res) => {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  if (req.body.username !== username || req.body.password !== password) return res.status(401).json({ error: "用户名或密码错误" });
  res.json({ token: sign({ sub: username, role: "admin" }), user: { username, role: "admin" } });
});

app.use("/api", auth);

app.get("/api/dashboard", asyncRoute(async (_req, res) => {
  const [products, customers, sales, purchases] = await Promise.all([
    pool.query("select count(*)::int count, coalesce(sum(stock),0)::int stock from products"),
    pool.query("select count(*)::int count from customers"),
    pool.query("select count(*)::int count, coalesce(sum(total),0)::numeric total from sales where created_at::date=current_date"),
    pool.query("select count(*)::int count, coalesce(sum(total),0)::numeric total from purchases where created_at::date=current_date")
  ]);
  res.json({ products: products.rows[0], customers: customers.rows[0], sales: sales.rows[0], purchases: purchases.rows[0] });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const q = `%${req.query.search || ""}%`;
  const result = await pool.query("select * from products where sku ilike $1 or barcode ilike $1 or name ilike $1 order by id desc limit 500", [q]);
  res.json(result.rows);
}));
app.post("/api/products", asyncRoute(async (req, res) => {
  const b = req.body;
  const result = await pool.query("insert into products(sku,barcode,name,category,supplier,unit,box_size,cost,price,stock) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [b.sku,b.barcode,b.name,b.category,b.supplier||"",b.unit||"个",b.boxSize||1,b.cost||0,b.price||0,b.stock||0]);
  res.status(201).json(result.rows[0]);
}));
app.patch("/api/products/:id", asyncRoute(async (req, res) => {
  const b=req.body;
  const result=await pool.query("update products set name=coalesce($1,name),category=coalesce($2,category),supplier=coalesce($3,supplier),cost=coalesce($4,cost),price=coalesce($5,price),updated_at=now() where id=$6 returning *",[b.name,b.category,b.supplier,b.cost,b.price,req.params.id]);
  res.json(result.rows[0]);
}));
app.get("/api/i18n/locales", asyncRoute(async (_req,res)=>{
  res.json((await pool.query("select locale,display_name,is_default from supported_locales where enabled=true order by is_default desc,locale")).rows);
}));
app.put("/api/products/:id/translations/:locale", asyncRoute(async (req,res)=>{
  const result=await pool.query("insert into product_translations(product_id,locale,name,description) values($1,$2,$3,$4) on conflict(product_id,locale) do update set name=excluded.name,description=excluded.description returning *",[req.params.id,req.params.locale,req.body.name,req.body.description||""]);
  res.json(result.rows[0]);
}));

app.get("/api/customers", asyncRoute(async (req, res) => {
  const q=`%${req.query.search||""}%`;
  const result=await pool.query("select * from customers where name ilike $1 or phone ilike $1 or city ilike $1 order by id desc limit 500",[q]);
  res.json(result.rows);
}));
app.post("/api/customers", asyncRoute(async (req,res)=>{
  const b=req.body;
  const result=await pool.query("insert into customers(name,phone,city,address,customer_group) values($1,$2,$3,$4,$5) returning *",[b.name,b.phone||"",b.city||"",b.address||"",b.group||"零售"]);
  res.status(201).json(result.rows[0]);
}));

app.get("/api/purchases", asyncRoute(async (_req,res)=>res.json((await pool.query("select * from purchases order by created_at desc limit 500")).rows)));
app.post("/api/purchases", asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{await client.query("begin");const b=req.body;
    const order=await client.query("insert into purchases(order_no,supplier,warehouse,total,status) values($1,$2,$3,$4,$5) returning *",[b.orderNo||`Vin${Date.now()}`,b.supplier,b.warehouse||"主仓库",b.total||0,b.status||"已入库"]);
    for(const item of b.items||[]){await client.query("insert into purchase_items(purchase_id,product_id,quantity,cost) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.cost]);await client.query("update products set stock=stock+$1,cost=$2,updated_at=now() where id=$3",[item.quantity,item.cost,item.productId]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.get("/api/sales", asyncRoute(async (_req,res)=>res.json((await pool.query("select s.*,c.name customer from sales s left join customers c on c.id=s.customer_id order by s.created_at desc limit 500")).rows)));
app.post("/api/sales", asyncRoute(async (req,res)=>{
  const client=await pool.connect();
  try{await client.query("begin");const b=req.body;
    const order=await client.query("insert into sales(order_no,customer_id,total,status,created_by) values($1,$2,$3,'已完成',$4) returning *",[b.orderNo||`Vs${Date.now()}`,b.customerId||null,b.total||0,req.user.sub]);
    for(const item of b.items||[]){const locked=await client.query("select stock from products where id=$1 for update",[item.productId]);if(!locked.rowCount||locked.rows[0].stock<item.quantity)throw new Error(`商品 ${item.productId} 库存不足`);await client.query("insert into sale_items(sale_id,product_id,quantity,price) values($1,$2,$3,$4)",[order.rows[0].id,item.productId,item.quantity,item.price]);await client.query("update products set stock=stock-$1,updated_at=now() where id=$2",[item.quantity,item.productId]);}
    await client.query("commit");res.status(201).json(order.rows[0]);
  }catch(e){await client.query("rollback");throw e}finally{client.release()}
}));

app.get("/api/reports/summary", asyncRoute(async (_req,res)=>{
  const result=await pool.query("select (select coalesce(sum(total),0) from sales) sales_total,(select coalesce(sum(total),0) from purchases) purchase_total,(select coalesce(sum(stock),0) from products) stock_total");
  res.json(result.rows[0]);
}));

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:err.message||"server error"})});
app.listen(port,"0.0.0.0",()=>console.log(`ERP API listening on ${port}`));
