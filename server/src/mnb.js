const MNB_ENDPOINT = process.env.MNB_EXCHANGE_RATE_URL || "http://www.mnb.hu/arfolyamok.asmx";
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const SOAP_ACTION = "http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetCurrentExchangeRates";
const SOAP_BODY = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetCurrentExchangeRates xmlns="http://www.mnb.hu/webservices/" />
  </soap:Body>
</soap:Envelope>`;

let cache = null;
let cacheExpiresAt = 0;
let pendingRequest = null;

const decodeXmlEntities = value => String(value)
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

export function parseMnbCurrentExchangeRates(responseXml) {
  const result = String(responseXml).match(/<(?:\w+:)?GetCurrentExchangeRatesResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?GetCurrentExchangeRatesResult>/i);
  if (!result) throw new Error("MNB response does not contain exchange rates");
  const ratesXml = decodeXmlEntities(result[1]);
  const date = ratesXml.match(/<Day\b[^>]*\bdate="([^"]+)"/i)?.[1] || "";
  const rates = {};
  for (const match of ratesXml.matchAll(/<Rate\b([^>]*)>([^<]+)<\/Rate>/gi)) {
    const currency = match[1].match(/\bcurr="([^"]+)"/i)?.[1]?.toUpperCase();
    const unit = Number(match[1].match(/\bunit="([^"]+)"/i)?.[1] || 1);
    const value = Number(match[2].trim().replace(/\s/g, "").replace(",", "."));
    if (currency && Number.isFinite(unit) && unit > 0 && Number.isFinite(value)) rates[currency] = value / unit;
  }
  if (!date || !Number.isFinite(rates.EUR) || !Number.isFinite(rates.USD)) throw new Error("MNB response is missing EUR or USD");
  return { date, eurHuf: rates.EUR, usdHuf: rates.USD, source: "MNB" };
}

async function requestMnbExchangeRates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(MNB_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${SOAP_ACTION}"`,
      },
      body: SOAP_BODY,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MNB request failed (${response.status})`);
    return {
      ...parseMnbCurrentExchangeRates(await response.text()),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMnbExchangeRates() {
  if (cache && Date.now() < cacheExpiresAt) return cache;
  if (!pendingRequest) {
    pendingRequest = requestMnbExchangeRates()
      .then(result => {
        cache = result;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return result;
      })
      .finally(() => {
        pendingRequest = null;
      });
  }
  try {
    return await pendingRequest;
  } catch (error) {
    if (cache) return { ...cache, stale: true };
    throw error;
  }
}
