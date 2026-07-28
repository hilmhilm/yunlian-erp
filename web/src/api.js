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
  name2: product.name2 || "",
  boxSize: Number(product.box_size ?? product.boxSize ?? 1),
  packageSize: Number(product.package_size ?? product.packageSize ?? 1),
  cost: Number(product.cost || 0),
  price: Number(product.price || 0),
  priceHuf: Number(product.price ?? product.priceHuf ?? 0),
  priceEur: Number(product.price_eur ?? product.priceEur ?? 0),
  priceUsd: Number(product.price_usd ?? product.priceUsd ?? 0),
  stock: Number(product.stock || 0),
  purchaseQuantity: Number(product.purchase_quantity ?? product.purchaseQuantity ?? 0),
  salesQuantity: Number(product.sales_quantity ?? product.salesQuantity ?? 0),
  inboundAt: product.inbound_at ?? product.inboundAt ?? null,
  createdAt: product.created_at ?? product.createdAt ?? null,
  updatedAt: product.updated_at ?? product.updatedAt ?? null,
  imageUrl: product.image_url ?? product.imageUrl ?? "",
  warehouse: product.storage_warehouse ?? product.warehouse ?? "",
  storageLocation: product.storage_location ?? product.storageLocation ?? "",
  movements: (product.movements || []).map(movement => ({
    ...movement,
    quantity: Number(movement.quantity || 0),
    movementType: movement.movement_type,
    referenceNo: movement.reference_no,
    createdBy: movement.created_by,
    date: formatDate(movement.created_at),
  })),
});

const normalizeCategory = (category) => ({
  ...category,
  parentId: category.parent_id ?? category.parentId ?? null,
  name2: category.name2 || "",
  imageUrl: category.image_url ?? category.imageUrl ?? "",
  productCount: Number(category.product_count ?? category.productCount ?? 0),
  createdAt: category.created_at ?? category.createdAt ?? null,
  updatedAt: category.updated_at ?? category.updatedAt ?? null,
});

const formatDate = (value) => value ? new Date(value).toLocaleString([], {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}) : "";

const normalizeCustomer = (customer) => ({
  ...customer,
  customerGroupId: Number(customer.customer_group_id ?? customer.customerGroupId) || null,
  group: customer.customer_group_name ?? customer.customer_group ?? customer.group ?? "",
  groupDiscountPercent: Number(customer.group_discount_percent ?? customer.groupDiscountPercent ?? 0),
  notes: customer.notes || "",
  postalCode: customer.postal_code ?? customer.postalCode ?? "",
  taxNumber: customer.tax_number ?? customer.taxNumber ?? "",
  vehiclePlate: customer.vehicle_plate ?? customer.vehiclePlate ?? "",
  vehiclePlates: Array.isArray(customer.vehicle_plates ?? customer.vehiclePlates) ? (customer.vehicle_plates ?? customer.vehiclePlates).filter(Boolean) : [],
  country: customer.country || "Magyarország",
  email: customer.email || "",
});

const normalizeCustomerGroup = group => ({
  ...group,
  discountPercent:Number(group.discount_percent ?? group.discountPercent ?? 0),
  customerCount:Number(group.customer_count ?? group.customerCount ?? 0),
  notes:group.notes||"",
});

const normalizePurchase = (purchase) => ({
  ...purchase,
  databaseId: Number(purchase.id),
  id: purchase.order_no ?? purchase.id,
  date: formatDate(purchase.created_at),
  quantity: Number(purchase.quantity || 0),
  total: Number(purchase.total || 0),
  itemCount:Number(purchase.item_count||purchase.items?.length||0),
  status:purchase.status==="待审核"?"未入库":purchase.status,
  items:(purchase.items||[]).map(item=>({
    ...item,
    id:Number(item.id),
    productId:Number(item.product_id??item.productId),
    quantity:Number(item.quantity||0),
    cost:Number(item.cost||0),
    imageUrl:item.image_url??item.imageUrl??"",
    name2:item.name2||"",
  })),
});

const normalizeSale = (sale) => ({
  ...sale,
  databaseId: Number(sale.id),
  id: sale.order_no ?? sale.id,
  date: formatDate(sale.created_at),
  qty: Number(sale.quantity || 0),
  total: Number(sale.total || 0),
  customerId: Number(sale.customer_id ?? sale.customerId) || null,
  customer: sale.customer || "",
  salesperson: sale.created_by || "",
  itemCount: Number(sale.item_count || 0),
  currency: sale.currency || "HUF",
  notes: sale.notes || "",
  deliveryPhone: sale.delivery_phone ?? sale.deliveryPhone ?? "",
  vehiclePlate: sale.vehicle_plate ?? sale.vehiclePlate ?? "",
  deliveryAddress: sale.delivery_address ?? sale.deliveryAddress ?? "",
  deliveryDate: sale.delivery_date ?? sale.deliveryDate ?? "",
  customerPhone: sale.customer_phone ?? sale.customerPhone ?? "",
  customerCity: sale.customer_city ?? sale.customerCity ?? "",
  customerAddress: sale.customer_address ?? sale.customerAddress ?? "",
  customerCountry: sale.customer_country ?? sale.customerCountry ?? "Magyarország",
  customerPostalCode: sale.customer_postal_code ?? sale.customerPostalCode ?? "",
  customerTaxNumber: sale.customer_tax_number ?? sale.customerTaxNumber ?? "",
  customerEmail: sale.customer_email ?? sale.customerEmail ?? "",
  customerDiscountPercent: Number(sale.customer_discount_percent ?? sale.customerDiscountPercent ?? 0),
  paidTotal: Number(sale.paid_total ?? sale.paidTotal ?? 0),
  balance: Number(sale.balance ?? Math.max(Number(sale.total || 0)-Number(sale.paid_total ?? sale.paidTotal ?? 0),0)),
  stockDeducted: Boolean(sale.stock_deducted),
  delivered: Boolean(sale.delivered),
  settled: Boolean(sale.settled),
  invoiceId: Number(sale.invoice_id ?? sale.invoiceId) || null,
  invoiceStatus: sale.invoice_status ?? sale.invoiceStatus ?? "",
  invoiceNumber: sale.invoice_number ?? sale.invoiceNumber ?? "",
  invoiceRecordDeleted: Boolean(sale.invoice_record_deleted ?? sale.invoiceRecordDeleted),
});

const normalizeInvoice = invoice => ({
  ...invoice,
  saleId: Number(invoice.sale_id ?? invoice.saleId),
  orderNo: invoice.order_no ?? invoice.orderNo ?? "",
  invoiceNumber: invoice.invoice_number ?? invoice.invoiceNumber ?? "",
  documentType: invoice.document_type ?? invoice.documentType ?? "invoice",
  lifecycleStatus: invoice.lifecycle_status ?? invoice.lifecycleStatus ?? invoice.status ?? "processing",
  parentInvoiceId: Number(invoice.parent_invoice_id ?? invoice.parentInvoiceId) || null,
  parentInvoiceNumber: invoice.parent_invoice_number ?? invoice.parentInvoiceNumber ?? "",
  paymentMethod: invoice.payment_method ?? invoice.paymentMethod ?? "cash",
  fulfillmentDate: invoice.fulfillment_date ?? invoice.fulfillmentDate ?? "",
  dueDate: invoice.due_date ?? invoice.dueDate ?? "",
  netTotal: Number(invoice.net_total ?? invoice.netTotal ?? 0),
  vatTotal: Number(invoice.vat_total ?? invoice.vatTotal ?? 0),
  grossTotal: Number(invoice.gross_total ?? invoice.grossTotal ?? 0),
  priceFactor: Number(invoice.price_factor ?? invoice.priceFactor ?? 1),
  errorMessage: invoice.error_message ?? invoice.errorMessage ?? "",
  reason: invoice.reason ?? "",
  buyerName: invoice.buyer_name ?? invoice.buyerName ?? "",
  buyerCountry: invoice.buyer_country ?? invoice.buyerCountry ?? "",
  buyerPostalCode: invoice.buyer_postal_code ?? invoice.buyerPostalCode ?? "",
  buyerCity: invoice.buyer_city ?? invoice.buyerCity ?? "",
  buyerAddress: invoice.buyer_address ?? invoice.buyerAddress ?? "",
  buyerTaxNumber: invoice.buyer_tax_number ?? invoice.buyerTaxNumber ?? "",
  buyerEmail: invoice.buyer_email ?? invoice.buyerEmail ?? "",
  createdAt: invoice.created_at ?? invoice.createdAt ?? null,
  issuedAt: invoice.issued_at ?? invoice.issuedAt ?? null,
  erpDeleted: Boolean(invoice.deleted_at ?? invoice.erpDeleted),
});

const normalizeSaleDetail = (sale) => ({
  ...normalizeSale(sale),
  items: (sale.items || []).map(item => ({
    ...item,
    productId: Number(item.product_id),
    name2: item.name2 || "",
    imageUrl: item.image_url ?? item.imageUrl ?? "",
    storageLocation: item.storage_location ?? item.storageLocation ?? "",
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
  })),
  payments: (sale.payments || []).map(payment => ({
    ...payment,
    amount: Number(payment.amount || 0),
    method: payment.method,
    bookedOn: payment.booked_on,
    createdBy: payment.created_by,
    createdAt: payment.created_at,
  })),
});

const normalizeUser = (user) => ({
  ...user,
  displayName: user.display_name ?? user.displayName ?? "",
  lastLoginAt: user.last_login_at ?? user.lastLoginAt ?? null,
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
});

const normalizeSettings = (settings = {}) => ({
  companyName: settings.company_name ?? settings.companyName ?? "云链 ERP",
  taxNumber: settings.tax_number ?? settings.taxNumber ?? "",
  registrationNumber: settings.registration_number ?? settings.registrationNumber ?? "",
  companyAddress: settings.company_address ?? settings.companyAddress ?? "",
  companyPhone: settings.company_phone ?? settings.companyPhone ?? "",
  companyEmail: settings.company_email ?? settings.companyEmail ?? "",
  companyWebsite: settings.company_website ?? settings.companyWebsite ?? "",
  eurHufRate: Number(settings.eur_huf_rate ?? settings.eurHufRate ?? 357.351),
  usdHufRate: Number(settings.usd_huf_rate ?? settings.usdHufRate ?? 313.465),
  defaultCurrency: settings.default_currency ?? settings.defaultCurrency ?? "HUF",
  allowOverselling: Boolean(settings.allow_overselling ?? settings.allowOverselling ?? true),
  lowStockThreshold: Number(settings.low_stock_threshold ?? settings.lowStockThreshold ?? 20),
  defaultWarehouse: settings.default_warehouse ?? settings.defaultWarehouse ?? "主仓库",
  salesOrderPrefix: settings.sales_order_prefix ?? settings.salesOrderPrefix ?? "Vs",
  purchaseOrderPrefix: settings.purchase_order_prefix ?? settings.purchaseOrderPrefix ?? "Vin",
});

export async function fetchProducts(token, search = "", categoryId = "") {
  const query = new URLSearchParams({ search });
  if(categoryId)query.set("categoryId",categoryId);
  const products = await request(`/products?${query}`, { token });
  return products.map(normalizeProduct);
}

export async function fetchProductCategories(token) {
  return request("/products/categories", { token });
}

export async function fetchCategories(token) {
  return (await request("/categories", { token })).map(normalizeCategory);
}

export async function createCategory(token, category) {
  return normalizeCategory(await request("/categories", {
    token, method: "POST", body: JSON.stringify(category),
  }));
}

export async function importCategories(token, categories) {
  return request("/categories/import", {
    token, method: "POST", body: JSON.stringify({ categories }),
  });
}

export async function updateCategory(token, id, category) {
  return normalizeCategory(await request(`/categories/${id}`, {
    token, method: "PATCH", body: JSON.stringify(category),
  }));
}

export async function uploadCategoryImage(token, id, file) {
  return normalizeCategory(await request(`/categories/${id}/image`, {
    token,
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  }));
}

export async function deleteCategoryImage(token, id) {
  return normalizeCategory(await request(`/categories/${id}/image`, {
    token, method: "DELETE",
  }));
}

export async function deleteCategory(token, id) {
  return request(`/categories/${id}`, { token, method: "DELETE" });
}

export async function createProduct(token, product) {
  const created = await request("/products", {
    token,
    method: "POST",
    body: JSON.stringify(product),
  });
  return normalizeProduct(created);
}

export async function importProducts(token, products) {
  const result = await request("/products/import", {
    token,
    method: "POST",
    body: JSON.stringify({ products }),
  });
  return { ...result, products: (result.products || []).map(normalizeProduct) };
}

export async function fetchProduct(token, id) {
  return normalizeProduct(await request(`/products/${id}`, { token }));
}

export async function fetchProductSales(token,id) {
  return (await request(`/products/${id}/sales`,{token})).map(row=>({
    ...row,
    databaseId:Number(row.id),
    id:row.order_no??row.id,
    date:formatDate(row.created_at),
    customer:row.customer||"",
    salesperson:row.created_by||"",
    currency:row.currency||"HUF",
    quantity:Number(row.quantity||0),
    price:Number(row.price||0),
    lineTotal:Number(row.line_total||0),
    stockDeducted:Boolean(row.stock_deducted),
    delivered:Boolean(row.delivered),
  }));
}

export async function fetchProductPurchases(token,id) {
  return (await request(`/products/${id}/purchases`,{token})).map(row=>({
    ...row,
    databaseId:Number(row.id),
    id:row.order_no??row.id,
    createdAt:row.created_at??null,
    receivedAt:row.received_at??null,
    supplier:row.supplier||"",
    warehouse:row.warehouse||"",
    status:row.status||"未入库",
    quantity:Number(row.quantity||0),
    cost:Number(row.cost||0),
    lineTotal:Number(row.line_total||0),
  }));
}

export async function updateProduct(token, id, product) {
  return normalizeProduct(await request(`/products/${id}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(product),
  }));
}

export async function updateInventory(token, id, inventory) {
  return normalizeProduct(await request(`/products/${id}/inventory`, {
    token,
    method: "PATCH",
    body: JSON.stringify(inventory),
  }));
}

export async function updateInventoryLocation(token, id, storageLocation) {
  return normalizeProduct(await request(`/products/${id}/inventory-location`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ storageLocation }),
  }));
}

export async function uploadProductImage(token, id, file) {
  return normalizeProduct(await request(`/products/${id}/image`, {
    token,
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  }));
}

export async function deleteProductImage(token, id) {
  return normalizeProduct(await request(`/products/${id}/image`, {
    token, method: "DELETE",
  }));
}

export async function deleteProduct(token, id) {
  return request(`/products/${id}`, { token, method: "DELETE" });
}

export async function deleteProducts(token, ids) {
  return request("/products/batch-delete", {
    token, method: "DELETE", body: JSON.stringify({ ids }),
  });
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

export async function updateCustomer(token, id, customer) {
  return normalizeCustomer(await request(`/customers/${id}`, {
    token, method: "PATCH", body: JSON.stringify(customer),
  }));
}

export async function deleteCustomer(token, id) {
  return request(`/customers/${id}`, { token, method: "DELETE" });
}

export async function importCustomers(token, customers) {
  return request("/customers/import", {token,method:"POST",body:JSON.stringify({customers})});
}

export async function fetchCustomerGroups(token) {
  return (await request("/customer-groups",{token})).map(normalizeCustomerGroup);
}

export async function createCustomerGroup(token, group) {
  return normalizeCustomerGroup(await request("/customer-groups",{token,method:"POST",body:JSON.stringify(group)}));
}

export async function updateCustomerGroup(token,id,group) {
  return normalizeCustomerGroup(await request(`/customer-groups/${id}`,{token,method:"PATCH",body:JSON.stringify(group)}));
}

export async function updateCustomerGroupMembers(token,id,customerIds) {
  return request(`/customer-groups/${id}/members`,{token,method:"PUT",body:JSON.stringify({customerIds})});
}

export async function deleteCustomerGroup(token,id) {
  return request(`/customer-groups/${id}`,{token,method:"DELETE"});
}

export async function fetchPurchases(token) {
  return (await request("/purchases", { token })).map(normalizePurchase);
}

export async function createPurchase(token, purchase) {
  return normalizePurchase(await request("/purchases", {
    token, method: "POST", body: JSON.stringify(purchase),
  }));
}

export async function fetchPurchase(token,id) {
  return normalizePurchase(await request(`/purchases/${id}`,{token}));
}

export async function updatePurchase(token,id,purchase) {
  return normalizePurchase(await request(`/purchases/${id}`,{token,method:"PUT",body:JSON.stringify(purchase)}));
}

export async function updatePurchaseStatus(token,id,status) {
  return normalizePurchase(await request(`/purchases/${id}/status`,{token,method:"PATCH",body:JSON.stringify({status})}));
}

export async function deletePurchase(token, id) {
  return request(`/purchases/${id}`, { token, method: "DELETE" });
}

export async function fetchSales(token, { startDate = "", endDate = "" } = {}) {
  const query = new URLSearchParams();
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : "";
  return (await request(`/sales${suffix}`, { token })).map(normalizeSale);
}

export async function fetchPickingSales(token, { startDate = "", endDate = "" } = {}) {
  const query = new URLSearchParams();
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  const suffix = query.size ? `?${query}` : "";
  return (await request(`/picking-sales${suffix}`, { token })).map(normalizeSale);
}

export async function fetchPickingSale(token, id) {
  return normalizeSaleDetail(await request(`/picking-sales/${id}`, { token }));
}

export async function createSale(token, sale) {
  return normalizeSale(await request("/sales", {
    token, method: "POST", body: JSON.stringify(sale),
  }));
}

export async function updateSale(token, saleId, sale) {
  return normalizeSale(await request(`/sales/${saleId}`, {
    token, method: "PUT", body: JSON.stringify(sale),
  }));
}

export async function deleteSale(token, saleId) {
  return request(`/sales/${saleId}`, { token, method: "DELETE" });
}

export async function fetchSale(token, id) {
  return normalizeSaleDetail(await request(`/sales/${id}`, { token }));
}

export async function updateSaleStatus(token, saleId, changes) {
  return normalizeSale(await request(`/sales/${saleId}/status`, {
    token, method: "PATCH", body: JSON.stringify(changes),
  }));
}

export async function updateSaleNotes(token, saleId, notes) {
  return normalizeSale(await request(`/sales/${saleId}/notes`, {
    token, method: "PATCH", body: JSON.stringify({ notes }),
  }));
}

export async function createSalePayment(token, saleId, payment) {
  return request(`/sales/${saleId}/payments`, {
    token, method: "POST", body: JSON.stringify(payment),
  });
}

export async function fetchInvoices(token) {
  return (await request("/invoices", { token })).map(normalizeInvoice);
}

export async function fetchInvoice(token, invoiceId) {
  const invoice=normalizeInvoice(await request(`/invoices/${invoiceId}`,{token}));
  return {...invoice,items:(invoice.items||[]).map(item=>({...item,id:Number(item.id),quantity:Number(item.quantity),netUnitPrice:Number(item.net_unit_price??item.netUnitPrice??0)})),related:(invoice.related||[]).map(normalizeInvoice)};
}

export async function deleteInvoice(token, invoiceId) {
  return request(`/invoices/${invoiceId}`, { token, method: "DELETE" });
}

export async function createInvoice(token, saleId, invoice) {
  return normalizeInvoice(await request(`/sales/${saleId}/invoice`, {
    token, method: "POST", body: JSON.stringify(invoice),
  }));
}

export async function stornoInvoice(token, invoiceId, reason) {
  return normalizeInvoice(await request(`/invoices/${invoiceId}/storno`,{token,method:"POST",body:JSON.stringify({reason})}));
}

export async function correctInvoice(token, invoiceId, correction) {
  return normalizeInvoice(await request(`/invoices/${invoiceId}/corrections`,{token,method:"POST",body:JSON.stringify(correction)}));
}

export async function fetchInvoicePdf(token, invoiceId) {
  const response=await fetch(`/api/invoices/${invoiceId}/pdf`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(data.error||`Request failed (${response.status})`,response.status)}
  return response.blob();
}

export async function fetchDashboard(token) {
  const data = await request("/dashboard", { token });
  return {
    products: { count: Number(data.products.count || 0), stock: Number(data.products.stock || 0) },
    customers: { count: Number(data.customers.count || 0) },
    sales: { count: Number(data.sales.count || 0), totals: { HUF:Number(data.sales.total_huf??data.sales.total??0),EUR:Number(data.sales.total_eur||0),USD:Number(data.sales.total_usd||0) } },
    purchases: { count: Number(data.purchases.count || 0), total: Number(data.purchases.total || 0) },
    trend: Array.isArray(data.trend) ? data.trend.map(row=>({date:String(row.date||""),count:Number(row.count||0)})) : [],
  };
}

export async function fetchReportSummary(token) {
  const data = await request("/reports/summary", { token });
  return {
    salesTotals: { HUF:Number(data.sales_total_huf??data.sales_total??0),EUR:Number(data.sales_total_eur||0),USD:Number(data.sales_total_usd||0) },
    purchaseTotal: Number(data.purchase_total || 0),
    stockTotal: Number(data.stock_total || 0),
  };
}

const numericReportFields=new Set(["amount","quantity","grossSales","refundAmount","netSales","paid","due","averageOrder","income","expense","net","cashIncome","cashExpense","cashNet","bankIncome","bankExpense","bankNet","orderCount","returnCount","totalCustomers","purchasingCustomers","newCustomers","repeatCustomers","paidAmount","dueAmount","new_customers","purchasing_customers"]);
const normalizeReportRow=row=>Object.fromEntries(Object.entries(row||{}).map(([key,value])=>{
  const camel=key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
  return [camel,numericReportFields.has(key)||numericReportFields.has(camel)?Number(value||0):value];
}));

export async function fetchBusinessReport(token,type,filters={}) {
  const query=new URLSearchParams();
  Object.entries(filters).forEach(([key,value])=>{if(value!==""&&value!==null&&value!==undefined)query.set(key,String(value))});
  const data=await request(`/reports/${type}?${query}`,{token});
  return {
    ...data,
    summary:normalizeReportRow(data.summary),
    trend:(data.trend||[]).map(normalizeReportRow),
    products:(data.products||[]).map(normalizeReportRow),
    customers:(data.customers||[]).map(normalizeReportRow),
    categories:(data.categories||[]).map(normalizeReportRow),
    details:(data.details||[]).map(normalizeReportRow),
  };
}

const normalizeFinanceTransaction = row => ({
  ...row,
  rowKey: row.row_key ?? row.rowKey,
  occurredOn: row.occurred_on ?? row.occurredOn,
  paymentMethod: row.payment_method ?? row.paymentMethod,
  referenceNo: row.reference_no ?? row.referenceNo ?? "",
  sourceType: row.source_type ?? row.sourceType,
  createdBy: row.created_by ?? row.createdBy,
  createdAt: row.created_at ?? row.createdAt,
  amount: Number(row.amount || 0),
});

export async function fetchFinanceTransactions(token, { startDate = "", endDate = "" } = {}) {
  const query=new URLSearchParams();
  if(startDate)query.set("startDate",startDate);
  if(endDate)query.set("endDate",endDate);
  const data=await request(`/finance-transactions${query.size?`?${query}`:""}`,{token});
  return {rows:(data.rows||[]).map(normalizeFinanceTransaction),summary:data.summary||{}};
}

export async function createFinanceTransaction(token, transaction) {
  return normalizeFinanceTransaction(await request("/finance-transactions",{
    token,method:"POST",body:JSON.stringify(transaction),
  }));
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

export async function deleteUser(token, id) {
  return request(`/users/${id}`, { token, method: "DELETE" });
}

export async function fetchRolePermissions(token) {
  return request("/role-permissions", { token });
}

export async function updateRolePermissions(token, role, permissions) {
  return request(`/role-permissions/${role}`, {
    token, method: "PUT", body: JSON.stringify({ permissions }),
  });
}

export async function fetchSettings(token) {
  return normalizeSettings(await request("/settings", { token }));
}

export async function fetchMnbExchangeRates(token) {
  const rates = await request("/mnb-exchange-rates", { token });
  return {
    date: String(rates.date || ""),
    eurHuf: Number(rates.eurHuf),
    usdHuf: Number(rates.usdHuf),
    fetchedAt: rates.fetchedAt || null,
    stale: Boolean(rates.stale),
  };
}

export async function updateSettings(token, settings) {
  return normalizeSettings(await request("/settings", {
    token,
    method: "PATCH",
    body: JSON.stringify({
      company_name: settings.companyName,
      tax_number: settings.taxNumber,
      registration_number: settings.registrationNumber,
      company_address: settings.companyAddress,
      company_phone: settings.companyPhone,
      company_email: settings.companyEmail,
      company_website: settings.companyWebsite,
      eur_huf_rate: settings.eurHufRate,
      usd_huf_rate: settings.usdHufRate,
      default_currency: settings.defaultCurrency,
      allow_overselling: settings.allowOverselling,
      low_stock_threshold: settings.lowStockThreshold,
      default_warehouse: settings.defaultWarehouse,
      sales_order_prefix: settings.salesOrderPrefix,
      purchase_order_prefix: settings.purchaseOrderPrefix,
    }),
  }));
}

export async function fetchAuditLogs(token, { startDate = "", endDate = "", module = "", search = "" } = {}) {
  const query=new URLSearchParams();
  if(startDate)query.set("startDate",startDate);
  if(endDate)query.set("endDate",endDate);
  if(module)query.set("module",module);
  if(search)query.set("search",search);
  return (await request(`/audit-logs${query.size?`?${query}`:""}`,{token})).map(log=>({
    ...log,
    createdAt:log.created_at??log.createdAt,
    userRole:log.user_role??log.userRole,
    entityType:log.entity_type??log.entityType,
    entityId:log.entity_id??log.entityId,
    httpMethod:log.http_method??log.httpMethod,
    requestPath:log.request_path??log.requestPath,
    statusCode:Number(log.status_code??log.statusCode??0),
    ipAddress:log.ip_address??log.ipAddress??"",
  }));
}
