const SESSION_KEY = "erp-session";

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  }
  return data;
}

export function getStoredSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session?.token && session?.user?.username ? session : null;
  } catch {
    return null;
  }
}

export function storeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("erp-user");
}

export async function login(username, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseResponse(response);
}

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...options, headers });
  return parseResponse(response);
}

const normalizeProduct = (product) => ({
  ...product,
  boxSize: Number(product.box_size ?? product.boxSize ?? 1),
  cost: Number(product.cost || 0),
  price: Number(product.price || 0),
  stock: Number(product.stock || 0),
});

const formatDate = (value) => value ? new Date(value).toLocaleString([], {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}) : "";

const normalizeCustomer = (customer) => ({
  ...customer,
  group: customer.customer_group ?? customer.group ?? "",
});

const normalizePurchase = (purchase) => ({
  ...purchase,
  databaseId: purchase.id,
  id: purchase.order_no ?? purchase.id,
  date: formatDate(purchase.created_at),
  quantity: Number(purchase.quantity || 0),
  total: Number(purchase.total || 0),
});

const normalizeSale = (sale) => ({
  ...sale,
  databaseId: sale.id,
  id: sale.order_no ?? sale.id,
  date: formatDate(sale.created_at),
  qty: Number(sale.quantity || 0),
  total: Number(sale.total || 0),
  customer: sale.customer || "",
  salesperson: sale.created_by || "",
  itemCount: Number(sale.item_count || 0),
  stockDeducted: Boolean(sale.stock_deducted),
  delivered: Boolean(sale.delivered),
  settled: Boolean(sale.settled),
});

const normalizeSaleDetail = (sale) => ({
  ...normalizeSale(sale),
  items: (sale.items || []).map(item => ({
    ...item,
    productId: Number(item.product_id),
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
  })),
});

const normalizeUser = (user) => ({
  ...user,
  displayName: user.display_name ?? user.displayName ?? "",
  lastLoginAt: user.last_login_at ?? user.lastLoginAt ?? null,
});

export async function fetchProducts(token, search = "") {
  const products = await request(`/products?search=${encodeURIComponent(search)}`, { token });
  return products.map(normalizeProduct);
}

export async function createProduct(token, product) {
  const created = await request("/products", {
    token,
    method: "POST",
    body: JSON.stringify(product),
  });
  return normalizeProduct(created);
}

export async function fetchCustomers(token, search = "") {
  const customers = await request(`/customers?search=${encodeURIComponent(search)}`, { token });
  return customers.map(normalizeCustomer);
}

export async function createCustomer(token, customer) {
  return normalizeCustomer(await request("/customers", {
    token, method: "POST", body: JSON.stringify(customer),
  }));
}

export async function fetchPurchases(token) {
  return (await request("/purchases", { token })).map(normalizePurchase);
}

export async function createPurchase(token, purchase) {
  return normalizePurchase(await request("/purchases", {
    token, method: "POST", body: JSON.stringify(purchase),
  }));
}

export async function fetchSales(token, { startDate = "", endDate = "" } = {}) {
  const query = new URLSearchParams();
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : "";
  return (await request(`/sales${suffix}`, { token })).map(normalizeSale);
}

export async function createSale(token, sale) {
  return normalizeSale(await request("/sales", {
    token, method: "POST", body: JSON.stringify(sale),
  }));
}

export async function fetchSale(token, id) {
  return normalizeSaleDetail(await request(`/sales/${id}`, { token }));
}

export async function updateSaleStatus(token, saleId, changes) {
  return normalizeSale(await request(`/sales/${saleId}/status`, {
    token, method: "PATCH", body: JSON.stringify(changes),
  }));
}

export async function fetchDashboard(token) {
  const data = await request("/dashboard", { token });
  return {
    products: { count: Number(data.products.count || 0), stock: Number(data.products.stock || 0) },
    customers: { count: Number(data.customers.count || 0) },
    sales: { count: Number(data.sales.count || 0), total: Number(data.sales.total || 0) },
    purchases: { count: Number(data.purchases.count || 0), total: Number(data.purchases.total || 0) },
  };
}

export async function fetchReportSummary(token) {
  const data = await request("/reports/summary", { token });
  return {
    salesTotal: Number(data.sales_total || 0),
    purchaseTotal: Number(data.purchase_total || 0),
    stockTotal: Number(data.stock_total || 0),
  };
}

export async function fetchUsers(token) {
  return (await request("/users", { token })).map(normalizeUser);
}

export async function fetchCurrentUser(token) {
  const data = await request("/auth/me", { token });
  return normalizeUser(data.user);
}

export async function createUser(token, user) {
  return normalizeUser(await request("/users", {
    token, method: "POST", body: JSON.stringify(user),
  }));
}

export async function updateUser(token, id, changes) {
  return normalizeUser(await request(`/users/${id}`, {
    token, method: "PATCH", body: JSON.stringify(changes),
  }));
}
