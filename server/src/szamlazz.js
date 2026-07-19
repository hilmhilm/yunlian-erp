const endpoint = "https://www.szamlazz.hu/szamla/";

const escapeXml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const header = (response, name) => {
  const value = response.headers.get(name);
  if (!value) return "";
  try { return decodeURIComponent(value.replaceAll("+", " ")); } catch { return value; }
};

function itemXml(item) {
  return `<tetel><megnevezes>${escapeXml(item.name)}</megnevezes><azonosito>${escapeXml(item.sku)}</azonosito><mennyiseg>${item.quantity}</mennyiseg><mennyisegiEgyseg>${escapeXml(item.unit || "db")}</mennyisegiEgyseg><nettoEgysegar>${item.netUnitPrice}</nettoEgysegar><afakulcs>27</afakulcs><nettoErtek>${item.netTotal}</nettoErtek><afaErtek>${item.vatTotal}</afaErtek><bruttoErtek>${item.grossTotal}</bruttoErtek></tetel>`;
}

export function createInvoiceXml({ agentKey, externalId, sale, customer, items, paymentMethod, fulfillmentDate, dueDate, exchangeRate, exchangeRateBank }) {
  const foreignCurrency = sale.currency !== "HUF";
  const taxpayerType = customer.tax_number ? 1 : -1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd"><beallitasok><szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs><eszamla>true</eszamla><szamlaLetoltes>true</szamlaLetoltes><valaszVerzio>1</valaszVerzio><szamlaKulsoAzon>${escapeXml(externalId)}</szamlaKulsoAzon></beallitasok><fejlec><teljesitesDatum>${fulfillmentDate}</teljesitesDatum><fizetesiHataridoDatum>${dueDate}</fizetesiHataridoDatum><fizmod>${paymentMethod === "cash" ? "Készpénz" : "Átutalás"}</fizmod><penznem>${sale.currency}</penznem><szamlaNyelve>hu</szamlaNyelve><megjegyzes>${escapeXml(`ERP销售单 / ERP rendelés: ${sale.order_no}`)}</megjegyzes>${foreignCurrency ? `<arfolyamBank>${escapeXml(exchangeRateBank)}</arfolyamBank><arfolyam>${exchangeRate}</arfolyam>` : ""}<rendelesSzam>${escapeXml(sale.order_no)}</rendelesSzam><elolegszamla>false</elolegszamla><vegszamla>false</vegszamla><helyesbitoszamla>false</helyesbitoszamla><dijbekero>false</dijbekero><fizetve>${paymentMethod === "cash" ? "true" : "false"}</fizetve></fejlec><elado></elado><vevo><nev>${escapeXml(customer.name)}</nev><orszag>${escapeXml(customer.country || "Magyarország")}</orszag><irsz>${escapeXml(customer.postal_code)}</irsz><telepules>${escapeXml(customer.city)}</telepules><cim>${escapeXml(customer.address)}</cim>${customer.email ? `<email>${escapeXml(customer.email)}</email>` : ""}<sendEmail>false</sendEmail><adoalany>${taxpayerType}</adoalany>${customer.tax_number ? `<adoszam>${escapeXml(customer.tax_number)}</adoszam>` : ""}<azonosito>yunlian-customer-${customer.id}</azonosito>${customer.phone ? `<telefonszam>${escapeXml(customer.phone)}</telefonszam>` : ""}</vevo><tetelek>${items.map(itemXml).join("")}</tetelek></xmlszamla>`;
}

export async function sendInvoiceXml(xml, timeoutMs = 30000) {
  const form = new FormData();
  form.append("action-xmlagentxmlfile", new Blob([xml], { type: "application/xml" }), "invoice.xml");
  const response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
  const errorMessage = header(response, "szlahu_error");
  const errorCode = header(response, "szlahu_error_code");
  const invoiceNumber = header(response, "szlahu_szamlaszam");
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || errorMessage || !invoiceNumber || !contentType.toLowerCase().includes("pdf")) {
    const fallback = body.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
    const error = new Error(errorMessage || fallback || `Szamlazz.hu request failed (${response.status})`);
    error.status = 502;
    error.providerCode = errorCode;
    throw error;
  }
  if (body.length > 20 * 1024 * 1024) {
    const error = new Error("Szamlazz.hu returned an unexpectedly large PDF");
    error.status = 502;
    throw error;
  }
  return { invoiceNumber, pdf: body };
}

export async function queryInvoicePdf(agentKey, externalId, timeoutMs = 30000) {
  const xml=`<?xml version="1.0" encoding="UTF-8"?><xmlszamlapdf xmlns="http://www.szamlazz.hu/xmlszamlapdf" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlapdf https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd"><szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs><szamlaszam></szamlaszam><valaszVerzio>1</valaszVerzio><szamlaKulsoAzon>${escapeXml(externalId)}</szamlaKulsoAzon></xmlszamlapdf>`;
  const form=new FormData();
  form.append("action-szamla_agent_pdf",new Blob([xml],{type:"application/xml"}),"invoice-query.xml");
  const response=await fetch(endpoint,{method:"POST",body:form,signal:AbortSignal.timeout(timeoutMs)});
  const body=Buffer.from(await response.arrayBuffer()),invoiceNumber=header(response,"szlahu_szamlaszam"),contentType=response.headers.get("content-type")||"";
  if(!response.ok||header(response,"szlahu_error")||!invoiceNumber||!contentType.toLowerCase().includes("pdf"))return null;
  return {invoiceNumber,pdf:body};
}
