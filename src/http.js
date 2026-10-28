// One reader for every API reply, because a reply is not always JSON.
//
// The hosted build publishes the front end only: there is no /api/* server
// behind it, so a missing route answers with the host's own page — plain text,
// `The page could not be found`, status 404. Parsing that with res.json()
// throws `Unexpected token 'T', "The page c"... is not valid JSON`, which is a
// parser's complaint rather than something a person can act on. So read the
// body once, as text, and turn every case into one sentence that says what
// actually happened.
export async function readJson(res, fallback = 'That request did not go through.') {
  const text = await res.text();
  const data = parse(text);
  if (!res.ok) {
    const err = new Error(data?.error || notJson(res, text) || fallback);
    err.status = res.status;
    throw err;
  }
  if (data === null) {
    const err = new Error(notJson(res, text) || 'The server sent a reply this page could not read.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function parse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // an HTML page or a host error — not ours to parse
  }
}

// When the body was not JSON, the status and the host's own wording are all we
// have to go on.
function notJson(res, text) {
  if (/the page could not be found|NOT_FOUND|cannot (GET|POST)/i.test(text))
    return 'This deployment is the front end only — its account and office server is not attached, so nothing can be saved or loaded here.';
  if (res.status === 401 || res.status === 403) return 'Please sign in again.';
  if (res.status === 404) return 'That is not available on this deployment.';
  if (res.status >= 500) return `The server had a problem (${res.status}). Try again in a moment.`;
  return '';
}
