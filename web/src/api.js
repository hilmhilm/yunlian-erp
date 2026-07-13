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
